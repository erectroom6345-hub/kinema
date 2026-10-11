#!/usr/bin/env node
/**
 * living 伸び判定（48h後・1回）。
 *
 *   node scripts/check-living-growth.cjs --dry-run
 *   node scripts/check-living-growth.cjs --apply
 *   node scripts/check-living-growth.cjs --demo
 *
 * 合格したものは output/living/hit-queue.json へ追加。
 * メトリクスは output/metrics/living-sns-posts.jsonl を参照。
 * likes が無い行は判定保留（後で append-post-metrics / 手動更新）。
 */
const fs = require("fs");
const path = require("path");
const { loadLivingOps, root } = require("./lib/living-ops.cjs");

const historyPath = path.join(root, "output", "metrics", "living-sns-posts.jsonl");
const queuePath = path.join(root, "output", "living", "hit-queue.json");
const reportPath = path.join(root, "output", "living", "last-growth-check.json");

function hasFlag(name) {
  return process.argv.includes(name);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function loadHistory() {
  if (!fs.existsSync(historyPath)) return [];
  return fs
    .readFileSync(historyPath, "utf8")
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

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function demoRows() {
  const now = Date.now();
  const h = (hoursAgo, likes, replies = 0, quotes = 0) => ({
    at: new Date(now - hoursAgo * 3600_000).toISOString(),
    productId: `living-demo-${hoursAgo}`,
    category: "kitchen",
    platform: "threads",
    likes,
    replies,
    quotes,
    checked: false,
  });
  return [
    h(10, 3, 0, 0), // too fresh
    h(50, 20, 1, 0), // hit by likes vs median
    h(55, 2, 0, 0), // miss
    h(60, 4, 3, 1), // hit by replies+quotes
    h(70, 8, 0, 0),
    h(80, 6, 0, 0),
    h(90, 5, 0, 0),
  ];
}

function evaluate(rows, ops) {
  const windowHours = ops.growth?.windowHours ?? 48;
  const recentWindow = ops.growth?.recentWindow ?? 20;
  const mult = ops.growth?.likeMedianMultiplier ?? 2;
  const minRQ = ops.growth?.minRepliesPlusQuotes ?? 3;
  const now = Date.now();

  const withLikes = rows
    .filter((r) => typeof r.likes === "number")
    .slice(-recentWindow);
  const likeMedian = median(withLikes.map((r) => r.likes));

  const due = [];
  const pending = [];
  const skipped = [];

  for (const row of rows) {
    if (row.checked || row.hitQueued) {
      skipped.push({ ...row, reason: "already_checked" });
      continue;
    }
    const at = Date.parse(row.at || "");
    if (!Number.isFinite(at)) {
      skipped.push({ ...row, reason: "bad_at" });
      continue;
    }
    const ageH = (now - at) / 3600_000;
    if (ageH < windowHours) {
      pending.push({ ...row, reason: `too_fresh_${ageH.toFixed(1)}h` });
      continue;
    }
    if (typeof row.likes !== "number" && row.replies == null && row.quotes == null) {
      pending.push({ ...row, reason: "metrics_missing" });
      continue;
    }

    const likes = Number(row.likes || 0);
    const rq = Number(row.replies || 0) + Number(row.quotes || 0);
    const hitByLikes = likeMedian > 0 ? likes >= likeMedian * mult : likes >= 10;
    const hitByReplies = rq >= minRQ;
    const hit = hitByLikes || hitByReplies;
    due.push({
      ...row,
      likeMedian,
      hit,
      reasons: [
        hitByLikes ? `likes=${likes}>=median(${likeMedian})*${mult}` : null,
        hitByReplies ? `replies+quotes=${rq}>=${minRQ}` : null,
        !hit ? "below_threshold" : null,
      ].filter(Boolean),
    });
  }

  return { due, pending, skipped, likeMedian, windowHours };
}

function main() {
  const apply = hasFlag("--apply");
  const demo = hasFlag("--demo");
  const ops = loadLivingOps();
  const rows = demo ? demoRows() : loadHistory();
  const result = evaluate(rows, ops);
  const hits = result.due.filter((r) => r.hit);

  console.log("---- living growth check ----");
  console.log(
    `rows=${rows.length} due=${result.due.length} hits=${hits.length}` +
      ` pending=${result.pending.length} medianLikes=${result.likeMedian}` +
      ` window=${result.windowHours}h demo=${demo}`,
  );
  for (const h of hits) {
    console.log(
      `  HIT ${h.productId} likes=${h.likes ?? "-"} rq=${Number(h.replies || 0) + Number(h.quotes || 0)}` +
        ` reasons=${h.reasons.join(",")}`,
    );
  }
  for (const m of result.due.filter((r) => !r.hit)) {
    console.log(`  miss ${m.productId} reasons=${m.reasons.join(",")}`);
  }

  const report = {
    at: new Date().toISOString(),
    demo,
    apply,
    ...result,
    hits,
  };
  writeJson(reportPath, report);

  if (!apply) {
    console.log(`dry-run: ${reportPath}`);
    console.log("apply で hit-queue に追加します");
    return;
  }

  const queue = readJson(queuePath, { items: [] });
  const existing = new Set((queue.items || []).map((i) => i.productId));
  for (const h of hits) {
    if (existing.has(h.productId)) continue;
    queue.items.push({
      productId: h.productId,
      category: h.category || "other",
      queuedAt: new Date().toISOString(),
      source: "growth-check",
      likes: h.likes ?? null,
      replies: h.replies ?? null,
      quotes: h.quotes ?? null,
      reasons: h.reasons,
      consumed: false,
    });
  }
  writeJson(queuePath, queue);

  // mark checked in history (rewrite file)
  if (!demo && fs.existsSync(historyPath)) {
    const hitIds = new Set(result.due.map((r) => `${r.productId}|${r.at}`));
    const next = loadHistory().map((r) => {
      const key = `${r.productId}|${r.at}`;
      if (!hitIds.has(key)) return r;
      return {
        ...r,
        checked: true,
        checkedAt: new Date().toISOString(),
        hit: hits.some((h) => h.productId === r.productId && h.at === r.at),
        hitQueued: hits.some((h) => h.productId === r.productId && h.at === r.at),
      };
    });
    fs.writeFileSync(
      historyPath,
      next.map((r) => JSON.stringify(r)).join("\n") + (next.length ? "\n" : ""),
      "utf8",
    );
  }

  console.log(`hit-queue: ${queuePath} items=${queue.items.length}`);
}

main();
