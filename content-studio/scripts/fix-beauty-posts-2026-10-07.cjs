#!/usr/bin/env node
/**
 * 2026-10-07 の誤投稿（テスト文言）を修正する。
 *
 * Instagram / Threads Graph API は公開後の caption 更新非対応のため削除を試行。
 *
 * Usage:
 *   node scripts/fix-beauty-posts-2026-10-07.cjs --dry-run
 *   node scripts/fix-beauty-posts-2026-10-07.cjs --apply
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IG_POST_ID = "18129274501824170";
const THREADS_POST_ID = "17920969581443605";
const BLOGGER_POST_ID = "2602596015933498597";

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] == null || process.env[m[1]] === "") {
      process.env[m[1]] = v;
    }
  }
}

async function graphDelete(url) {
  const res = await fetch(url, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function printManualSteps(igDeleted, threadsDeleted) {
  console.log("");
  console.log("======== 手動手順（API で削除できなかった場合） ========");
  if (!igDeleted) {
    console.log("【Instagram】");
    console.log("  1. Instagram アプリ / ブラウザで該当投稿を開く");
    console.log(`  2. 投稿ID目安: ${IG_POST_ID}`);
    console.log("  3. 「削除」を実行（caption 編集ではテスト文言が残るため削除推奨）");
  }
  if (!threadsDeleted) {
    console.log("【Threads】");
    console.log("  1. Threads アプリで該当投稿を開く");
    console.log(`  2. 投稿ID目安: ${THREADS_POST_ID}`);
    console.log("  3. 「削除」を実行");
  }
  console.log("【Blogger】");
  console.log(`  1. https://beauty-diary-30s.blogspot.com/2026/10/blogurlbloggerurl.html`);
  console.log(`  2. postId=${BLOGGER_POST_ID} を非公開 or 削除`);
  console.log("  3. タイトルに blogUrlテスト が残っていないことを確認");
  console.log("");
  console.log("【正しい文面で再投稿する場合】");
  console.log("  1. products-beauty.json に本番用の新商品を追加（testOnly 禁止・実URL必須）");
  console.log("  2. node scripts/selectBeautyProduct.cjs --dry-run");
  console.log("  3. bash run-beauty.sh");
  console.log("  ※ 本日は same-day guard で止まる場合あり。そのときは明日の定時へ回す");
  console.log("========================================================");
}

async function main() {
  loadEnv();
  const dryRun = !hasFlag("--apply");

  console.log("=== 2026-10-07 美容誤投稿の修正 ===");
  console.log(`mode=${dryRun ? "dry-run" : "apply"}`);
  console.log(`IG=${IG_POST_ID}`);
  console.log(`Threads=${THREADS_POST_ID}`);
  console.log(`Blogger=${BLOGGER_POST_ID}`);
  console.log("");
  console.log("注: Instagram / Threads は API で caption 更新不可 → 削除が必要");
  console.log("");

  if (dryRun) {
    console.log("[dry-run] 実施予定: IG DELETE / Threads DELETE / Blogger は手動");
    printManualSteps(false, false);
    return;
  }

  const igToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  const threadsToken = (process.env.THREADS_ACCESS_TOKEN || "").trim();
  const igVer = (process.env.INSTAGRAM_GRAPH_VERSION || "v23.0").trim();
  const thVer = (process.env.THREADS_API_VERSION || "v1.0").trim();

  let igDeleted = false;
  let threadsDeleted = false;

  if (igToken) {
    console.log(`Instagram DELETE (graph.facebook.com/${igVer})...`);
    const ig = await graphDelete(
      `https://graph.facebook.com/${igVer}/${encodeURIComponent(IG_POST_ID)}?access_token=${encodeURIComponent(igToken)}`,
    );
    console.log(JSON.stringify({ ig }, null, 2));
    igDeleted = ig.ok === true;
  } else {
    console.error("INSTAGRAM_ACCESS_TOKEN なし");
  }

  if (threadsToken) {
    console.log(`Threads DELETE (graph.threads.net/${thVer})...`);
    const th = await graphDelete(
      `https://graph.threads.net/${thVer}/${encodeURIComponent(THREADS_POST_ID)}?access_token=${encodeURIComponent(threadsToken)}`,
    );
    console.log(JSON.stringify({ threads: th }, null, 2));
    threadsDeleted = th.ok === true;
  } else {
    console.warn("THREADS_ACCESS_TOKEN なし");
  }

  printManualSteps(igDeleted, threadsDeleted);

  // 正しい短文サンプル（再投稿時の参考）
  console.log("再投稿時の文面サンプル（美容テンプレ）:");
  console.log("--- IG ---");
  console.log(
    "hinceの「トゥルーディメンションラディアンスバーム」、仕上がりの雰囲気がよくてチェックしています。\nセール中にチェックしたい韓国コスメ\n\n詳しくは、プロフィールのリンクからご覧ください",
  );
  console.log("--- Threads ---");
  console.log(
    "hinceの「トゥルーディメンションラディアンスバーム」、ツヤ感が気になってメモ。\n気になる点だけ短く書いてます。\n#スキンケア\nhttps://beauty-diary-30s.blogspot.com/...(utm)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
