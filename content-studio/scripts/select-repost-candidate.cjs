#!/usr/bin/env node
/**
 * 再投稿候補スケジューラ（独立実行。run-beauty には常時組み込まない）
 *
 *   node scripts/select-repost-candidate.cjs --repost-dry-run
 *   node scripts/select-repost-candidate.cjs --repost-apply
 *   node scripts/select-repost-candidate.cjs --repost-dry-run --demo   # サンプル履歴で確認
 *
 * apply は output/repost/next-repost.json のみ更新（article.json は触らない）。
 * 次回投稿で使うとき:
 *   node scripts/selectBeautyProduct.cjs --use-repost-next
 */
const fs = require("fs");
const path = require("path");
const { evaluateRepostCandidates, DEFAULTS } = require("./lib/repost-score.cjs");

const root = path.join(__dirname, "..");
const historyPath = path.join(root, "output", "metrics", "post-history.jsonl");
const repostDir = path.join(root, "output", "repost");

function hasFlag(name) {
  return process.argv.includes(name);
}

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "";
}

function pipelineGenre() {
  const g = (arg("--genre") || process.env.CONTENT_PIPELINE_GENRE || "beauty")
    .trim()
    .toLowerCase();
  return g === "living" ? "living" : "beauty";
}

function productsPathFor(genre) {
  return path.join(
    root,
    "input",
    genre === "living" ? "products-living.json" : "products-beauty.json",
  );
}

function candidatesPathFor(genre) {
  return path.join(
    repostDir,
    genre === "living" ? "candidates-living.json" : "candidates.json",
  );
}

function nextPathFor(genre) {
  return path.join(
    repostDir,
    genre === "living" ? "next-repost-living.json" : "next-repost.json",
  );
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadHistory(genre) {
  if (!fs.existsSync(historyPath)) return [];
  const rows = fs
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
  // genre / channel で beauty と living を分離（旧レコードは beauty 扱い）
  return rows.filter((r) => {
    const g = String(r.genre || "").toLowerCase();
    const ch = String(r.channel || "").toLowerCase();
    const pid = String(r.productId || "");
    if (genre === "living") {
      return g === "living" || ch.startsWith("living") || pid.startsWith("living-");
    }
    return !(g === "living" || ch.startsWith("living") || pid.startsWith("living-"));
  });
}

function catalogIds(genre) {
  const products = readJson(productsPathFor(genre), {});
  const ids = [];
  for (const key of ["sale", "main", "niche", "routine"]) {
    for (const item of products[key] || []) {
      if (item?.id || item?.productId) ids.push(item.id || item.productId);
    }
  }
  return ids;
}

/** 動作確認用の合成履歴（本番ファイルは書き換えない） */
function demoHistory(genre) {
  const now = Date.now();
  const d = (daysAgo) => new Date(now - daysAgo * 86_400_000).toISOString();
  if (genre === "living") {
    return [
      {
        at: d(20),
        productId: "living-main-001",
        genre: "living",
        channel: "living-pipeline",
        status: "success",
        policyCheck: { result: "ok" },
        metrics: { clicks: 10, impressions: 300 },
      },
      {
        at: d(5),
        productId: "living-main-001",
        genre: "living",
        channel: "living-pipeline",
        status: "success",
        policyCheck: { result: "ok" },
        metrics: { clicks: 4, impressions: 120 },
      },
    ];
  }
  return [
    {
      at: d(20),
      productId: "beauty-main-001",
      status: "success",
      policyCheck: { result: "ok" },
      metrics: { clicks: 12, impressions: 400 },
    },
    {
      at: d(18),
      productId: "beauty-sale-001",
      status: "success",
      policyCheck: { result: "ok" },
      metrics: { clicks: 2, impressions: 100 },
    },
    {
      at: d(15),
      productId: "beauty-blocked-001",
      status: "failed",
      policyCheck: { result: "block" },
    },
    {
      at: d(12),
      productId: "beauty-fail-001",
      status: "failed",
      policyCheck: { result: "ok" },
    },
    {
      at: d(11),
      productId: "beauty-fail-001",
      status: "failed",
      policyCheck: { result: "ok" },
    },
    {
      at: d(10),
      productId: "beauty-main-001",
      status: "success",
      policyCheck: { result: "warn" },
      metrics: { clicks: 8, impressions: 300 },
    },
    {
      at: d(2),
      productId: "beauty-sale-002",
      status: "success",
      policyCheck: { result: "ok" },
    },
    {
      at: d(1),
      productId: "beauty-niche-001",
      status: "success",
      policyCheck: { result: "ok" },
    },
    {
      at: d(0.5),
      productId: "beauty-routine-001",
      status: "partial",
      policyCheck: { result: "ok" },
    },
  ];
}

function printTable(result) {
  console.log("---- 再投稿候補 ----");
  console.log(
    `evaluatedAt=${result.meta.evaluatedAt} history=${result.meta.historyRows}` +
      ` products=${result.meta.totalProducts}` +
      ` minDays=${result.meta.minDaysSincePost}` +
      ` recentWindow=${result.meta.recentWindow}`,
  );
  console.log(`recent: ${(result.meta.recentProductIds || []).join(", ") || "(none)"}`);
  console.log("");

  if (result.candidates.length === 0) {
    console.log("eligible 候補なし");
  } else {
    console.log("CANDIDATES (eligible)");
    for (const c of result.candidates) {
      console.log(
        `  ✓ ${c.productId}  score=${c.score}  last=${c.lastPostedAt || "-"}` +
          `  ok=${c.successCount} fail=${c.failCount}  reasons=${c.reasons.join(",")}`,
      );
    }
  }
  console.log("");
  if (result.excluded.length) {
    console.log("EXCLUDED");
    for (const c of result.excluded.slice(0, 12)) {
      console.log(
        `  ✗ ${c.productId}  score=${c.score}  last=${c.lastPostedAt || "-"}` +
          `  reasons=${c.reasons.join(",")}`,
      );
    }
    if (result.excluded.length > 12) {
      console.log(`  ... +${result.excluded.length - 12} more`);
    }
  }
  console.log("");
  if (result.selected) {
    console.log(
      `TOP: ${result.selected.productId} (score=${result.selected.score})`,
    );
  } else {
    console.log("TOP: (none)");
  }
}

function main() {
  const dryRun = hasFlag("--repost-dry-run") || hasFlag("--dry-run");
  const apply = hasFlag("--repost-apply") || hasFlag("--apply");
  const demo = hasFlag("--demo");
  const genre = pipelineGenre();
  const productsPath = productsPathFor(genre);
  const candidatesPath = candidatesPathFor(genre);
  const nextPath = nextPathFor(genre);

  if (!dryRun && !apply) {
    console.log("使い方:");
    console.log("  node scripts/select-repost-candidate.cjs --repost-dry-run");
    console.log("  node scripts/select-repost-candidate.cjs --repost-apply");
    console.log("  node scripts/select-repost-candidate.cjs --repost-dry-run --demo");
    console.log("  node scripts/select-repost-candidate.cjs --repost-dry-run --genre=living");
    console.log("  # 人気再投稿の適用（日次 run-beauty には混ぜない）");
    console.log("  node scripts/selectBeautyProduct.cjs --use-repost-next");
    console.log("  # 在庫切れローテは別入口:");
    console.log("  bash run-beauty-recycle.sh");
    console.log("  node scripts/selectLivingProduct.cjs --use-repost-next");
    process.exit(1);
  }
  if (dryRun && apply) {
    console.error("--repost-dry-run と --repost-apply は同時指定できません");
    process.exit(1);
  }

  const minDays = Number(arg("--min-days") || DEFAULTS.minDaysSincePost);
  const recentWindow = Number(arg("--recent-window") || DEFAULTS.recentWindow);

  let rows = demo ? demoHistory(genre) : loadHistory(genre);
  if (!demo && rows.length === 0) {
    console.warn(`履歴なし: ${historyPath} (genre=${genre})`);
    console.warn("確認用: node scripts/select-repost-candidate.cjs --repost-dry-run --demo --genre=" + genre);
  }

  const ids = catalogIds(genre);
  // demo の架空 ID も評価対象に含める
  const catalog = demo
    ? [...new Set([...ids, ...rows.map((r) => r.productId).filter(Boolean)])]
    : ids;

  console.log(`genre=${genre} products=${productsPath}`);

  const result = evaluateRepostCandidates(rows, {
    minDaysSincePost: Number.isFinite(minDays) ? minDays : DEFAULTS.minDaysSincePost,
    recentWindow: Number.isFinite(recentWindow) ? recentWindow : DEFAULTS.recentWindow,
    catalogIds: catalog,
  });

  fs.mkdirSync(repostDir, { recursive: true });
  const payload = {
    mode: apply ? "apply" : "dry-run",
    demo,
    genre,
    historyPath: demo ? "(demo)" : historyPath,
    ...result,
  };
  fs.writeFileSync(candidatesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  printTable(result);
  console.log(`保存: ${candidatesPath}`);

  if (apply) {
    if (!result.selected) {
      console.error("apply 失敗: eligible 候補がありません");
      const { spawnSync } = require("child_process");
      spawnSync(
        process.execPath,
        [
          path.join(__dirname, "send-notify.cjs"),
          "--level=warn",
          "--eventType=repost_candidates_empty",
          "--step=repost-apply",
          `--reason=eligible 候補0件 genre=${genre}`,
          `--logPath=${candidatesPath}`,
        ],
        { cwd: root, encoding: "utf8" },
      );
      process.exit(2);
    }
    const next = {
      appliedAt: new Date().toISOString(),
      productId: result.selected.productId,
      score: result.selected.score,
      reasons: result.selected.reasons,
      lastPostedAt: result.selected.lastPostedAt,
      successCount: result.selected.successCount,
      failCount: result.selected.failCount,
      lastStatus: result.selected.lastStatus,
      consumed: false,
      source: "repost-scheduler",
      genre,
    };
    fs.writeFileSync(nextPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`apply: ${nextPath}`);
    console.log(
      genre === "living"
        ? `次回: node scripts/selectLivingProduct.cjs --use-repost-next`
        : `次回: node scripts/selectBeautyProduct.cjs --use-repost-next`,
    );
    const { spawnSync } = require("child_process");
    spawnSync(
      process.execPath,
      [
        path.join(__dirname, "send-notify.cjs"),
        "--level=info",
        "--eventType=repost_top_candidate",
        `--productId=${next.productId}`,
        "--step=repost-apply",
        `--reason=score=${next.score} genre=${genre}`,
        `--logPath=${nextPath}`,
      ],
      { cwd: root, encoding: "utf8" },
    );
  }
}

main();
