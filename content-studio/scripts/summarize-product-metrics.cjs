#!/usr/bin/env node
/**
 * 商品別の投稿履歴を集計して表示する。
 *   node scripts/summarize-product-metrics.cjs
 *   node scripts/summarize-product-metrics.cjs --json
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const historyPath = path.join(root, "output", "metrics", "post-history.jsonl");

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadRecords() {
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs.readFileSync(historyPath, "utf8").split(/\n+/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return rows;
}

function main() {
  const rows = loadRecords();
  if (rows.length === 0) {
    console.log(`履歴なし: ${historyPath}`);
    console.log("run-beauty 実行後に output/metrics/post-history.jsonl へ溜まります。");
    return;
  }

  /** @type {Map<string, any>} */
  const byProduct = new Map();
  for (const row of rows) {
    const id = row.productId || "(unknown)";
    let agg = byProduct.get(id);
    if (!agg) {
      agg = {
        productId: id,
        total: 0,
        success: 0,
        failed: 0,
        partial: 0,
        other: 0,
        latestAt: null,
        latestStatus: null,
        latestUtmUrl: null,
        latestThreadsPostId: null,
        latestIgPostId: null,
      };
      byProduct.set(id, agg);
    }
    agg.total += 1;
    const st = String(row.status || "other");
    if (st === "success") agg.success += 1;
    else if (st === "failed") agg.failed += 1;
    else if (st === "partial") agg.partial += 1;
    else agg.other += 1;

    if (!agg.latestAt || String(row.at) > String(agg.latestAt)) {
      agg.latestAt = row.at || null;
      agg.latestStatus = row.status || null;
      agg.latestUtmUrl = row.utmUrl || null;
      agg.latestThreadsPostId = row.threadsPostId || null;
      agg.latestIgPostId = row.igPostId || null;
    }
  }

  const list = [...byProduct.values()].sort((a, b) => b.total - a.total);

  if (hasFlag("--json")) {
    console.log(JSON.stringify({ historyPath, totalRuns: rows.length, products: list }, null, 2));
    return;
  }

  console.log(`metrics: ${historyPath}`);
  console.log(`total runs: ${rows.length} / products: ${list.length}`);
  console.log("");
  const header = [
    "productId".padEnd(22),
    "total".padStart(5),
    "ok".padStart(4),
    "fail".padStart(5),
    "part".padStart(5),
    "latestAt".padEnd(25),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of list) {
    console.log(
      [
        String(p.productId).padEnd(22),
        String(p.total).padStart(5),
        String(p.success).padStart(4),
        String(p.failed).padStart(5),
        String(p.partial).padStart(5),
        String(p.latestAt || "-").padEnd(25),
      ].join("  "),
    );
  }
  console.log("");
  console.log("詳細JSON: node scripts/summarize-product-metrics.cjs --json");
}

main();
