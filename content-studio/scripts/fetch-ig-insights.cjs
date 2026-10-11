#!/usr/bin/env node
/**
 * 直近投稿の Instagram insights を取得し metrics に保存する。
 *
 *   node scripts/fetch-ig-insights.cjs
 *   node scripts/fetch-ig-insights.cjs --recent=14 --dry-run
 *
 * 対象: post-history.jsonl / last-run-summary の igPostId
 * 保存: output/metrics/ig-insights.jsonl と post-history の metrics 更新
 * 永久失敗ID: output/metrics/ig-insights-dead.json（以降スキップ）
 */
const fs = require("fs");
const path = require("path");
const {
  fetchMediaInsights,
  isPermanentInsightsError,
  PRIMARY_METRICS,
} = require("./lib/ig-insights.cjs");

const root = path.join(__dirname, "..");
const metricsDir = path.join(root, "output", "metrics");
const historyPath = path.join(metricsDir, "post-history.jsonl");
const insightsPath = path.join(metricsDir, "ig-insights.jsonl");
const deadPath = path.join(metricsDir, "ig-insights-dead.json");
const envPath = path.join(root, ".env");

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadEnvFile() {
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore */
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function loadDeadMap() {
  try {
    if (!fs.existsSync(deadPath)) return {};
    const raw = JSON.parse(fs.readFileSync(deadPath, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveDeadMap(dead) {
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(deadPath, `${JSON.stringify(dead, null, 2)}\n`, "utf8");
}

/** 過去の永久FAILを dead に取り込み（初回ブートストラップ） */
function bootstrapDeadFromInsights(dead) {
  let added = 0;
  for (const row of readJsonl(insightsPath)) {
    const id = String(row.igPostId || "").trim();
    if (!id || row.ok || dead[id]) continue;
    const err = String(row.error || "");
    if (!isPermanentInsightsError(err)) continue;
    dead[id] = {
      at: row.at || new Date().toISOString(),
      error: err.slice(0, 240),
      productId: row.productId || null,
      source: "bootstrap",
    };
    added += 1;
  }
  return added;
}

function daysAgoIso(n) {
  const d = new Date();
  d.setTime(d.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function collectTargets(recentDays, dead) {
  const since = daysAgoIso(recentDays);
  const rows = readJsonl(historyPath);
  /** @type {Map<string, { igPostId:string, productId:string|null, at:string|null }>} */
  const map = new Map();
  for (const row of rows) {
    const id = String(row.igPostId || "").trim();
    if (!id) continue;
    if (dead[id] || row.insightsDead) continue;
    const at = String(row.at || "");
    if (at && at < since) continue;
    if (!map.has(id)) {
      map.set(id, {
        igPostId: id,
        productId: row.productId || null,
        at: row.at || null,
      });
    }
  }
  // 直近サマリも追加
  try {
    const summary = JSON.parse(
      fs.readFileSync(path.join(root, "output", "last-run-summary.json"), "utf8"),
    );
    const id = String(summary.igPostId || "").trim();
    if (id && !map.has(id) && !dead[id]) {
      map.set(id, {
        igPostId: id,
        productId: summary.productId || null,
        at: summary.finishedAt || summary.startedAt || null,
      });
    }
  } catch {
    /* ignore */
  }
  const genre = String(process.env.CONTENT_PIPELINE_GENRE || "beauty")
    .trim()
    .toLowerCase();
  return [...map.values()].filter((t) => {
    const pid = String(t.productId || "");
    if (genre === "living") return pid.startsWith("living-");
    // beauty token で living 投稿を叩くと permission ノイズになるので除外
    return !pid.startsWith("living-");
  });
}

function mergeHistoryMetrics(byIgId) {
  if (!fs.existsSync(historyPath)) return 0;
  const rows = readJsonl(historyPath);
  let updated = 0;
  const next = rows.map((row) => {
    const id = String(row.igPostId || "").trim();
    const hit = id ? byIgId.get(id) : null;
    if (!hit || !hit.ok) return row;
    const metrics = {
      ...(row.metrics && typeof row.metrics === "object" ? row.metrics : {}),
      ...hit.metrics,
      insightsAt: hit.at,
    };
    updated += 1;
    return { ...row, metrics };
  });
  writeJsonl(historyPath, next);
  return updated;
}

async function main() {
  loadEnvFile();
  const dryRun = hasFlag("--dry-run");
  const recentDays = Math.max(1, Number(arg("--recent", "14")) || 14);
  const token = String(process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!token) {
    console.error("[ig-insights] INSTAGRAM_ACCESS_TOKEN がありません");
    process.exit(0);
  }

  const dead = loadDeadMap();
  const bootstrapped = bootstrapDeadFromInsights(dead);
  if (bootstrapped > 0 && !dryRun) {
    saveDeadMap(dead);
    if (fs.existsSync(historyPath)) {
      const rows = readJsonl(historyPath);
      let marked = 0;
      const next = rows.map((row) => {
        const id = String(row.igPostId || "").trim();
        if (!id || !dead[id] || row.insightsDead) return row;
        marked += 1;
        return {
          ...row,
          insightsDead: true,
          insightsDeadAt: dead[id]?.at || new Date().toISOString(),
        };
      });
      if (marked) writeJsonl(historyPath, next);
      console.log(
        `[ig-insights] dead bootstrap +${bootstrapped} historyMarked=${marked} → ${deadPath}`,
      );
    } else {
      console.log(`[ig-insights] dead bootstrap +${bootstrapped} → ${deadPath}`);
    }
  }

  const targets = collectTargets(recentDays, dead);
  const deadSkipped = Object.keys(dead).length;
  console.log(
    `[ig-insights] targets=${targets.length} recentDays=${recentDays}` +
      ` deadSkipped=${deadSkipped} dryRun=${dryRun}`,
  );
  if (!targets.length) {
    console.log("[ig-insights] 対象投稿なし（igPostId 付き履歴を待つ / dead除外後）");
    process.exit(0);
  }

  const byIgId = new Map();
  const appendRows = [];
  const newlyDead = new Set();
  for (const t of targets) {
    if (dryRun) {
      console.log(`[ig-insights:dry] ${t.igPostId} product=${t.productId || "-"}`);
      continue;
    }
    const got = await fetchMediaInsights(t.igPostId, token);
    const row = {
      at: new Date().toISOString(),
      igPostId: t.igPostId,
      productId: t.productId,
      ok: got.ok,
      error: got.error || null,
      metrics: got.metrics || {},
      requested: got.requested || PRIMARY_METRICS,
      permanent: Boolean(got.permanent),
    };
    appendRows.push(row);
    byIgId.set(t.igPostId, row);
    if (!got.ok && got.permanent) {
      dead[t.igPostId] = {
        at: row.at,
        error: String(got.error || "").slice(0, 240),
        productId: t.productId || null,
        source: "fetch",
      };
      newlyDead.add(t.igPostId);
    }
    const m = got.metrics || {};
    console.log(
      `[ig-insights] ${got.ok ? "OK" : got.permanent ? "DEAD" : "FAIL"} id=${t.igPostId}` +
        ` product=${t.productId || "-"}` +
        ` reach=${m.reach ?? "-"}` +
        ` saved=${m.saved ?? "-"}` +
        ` profile_visits=${m.profile_visits ?? "-"}` +
        ` total_interactions=${m.total_interactions ?? "-"}` +
        (got.error ? ` err=${got.error}` : ""),
    );
    // 軽いレート制限避け
    await new Promise((r) => setTimeout(r, 300));
  }

  if (dryRun) process.exit(0);

  fs.mkdirSync(metricsDir, { recursive: true });
  for (const row of appendRows) {
    fs.appendFileSync(insightsPath, `${JSON.stringify(row)}\n`, "utf8");
  }
  if (newlyDead.size) {
    saveDeadMap(dead);
    // history に insightsDead 印
    if (fs.existsSync(historyPath)) {
      const rows = readJsonl(historyPath);
      let marked = 0;
      const next = rows.map((row) => {
        const id = String(row.igPostId || "").trim();
        if (!id || !newlyDead.has(id) || row.insightsDead) return row;
        marked += 1;
        return {
          ...row,
          insightsDead: true,
          insightsDeadAt: dead[id]?.at || new Date().toISOString(),
        };
      });
      if (marked) writeJsonl(historyPath, next);
      console.log(`[ig-insights] marked dead in history=${marked}`);
    }
  }
  const merged = mergeHistoryMetrics(byIgId);
  console.log(
    `[ig-insights] wrote=${appendRows.length}` +
      ` historyMerged=${merged}` +
      ` newlyDead=${newlyDead.size}` +
      ` path=${insightsPath}`,
  );
}

main().catch((err) => {
  console.error("[ig-insights] FAIL", err instanceof Error ? err.message : err);
  process.exit(0);
});
