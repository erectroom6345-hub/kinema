#!/usr/bin/env node
/**
 * Blogger 導線 UTM の確認用。
 *
 *   node scripts/test-utm.cjs
 *   node scripts/test-utm.cjs --url='https://example.com/p/abc?ref=1' --productId=beauty-main-001
 */
const {
  buildBeautyTrackUrl,
  buildTrackUrl,
  describeUtm,
  appendUtmParams,
} = require("./lib/utm.cjs");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  return "";
}

const blogUrl =
  arg("--url") ||
  "https://beauty-diary-30s.blogspot.com/2026/10/30.html?ref=keep";
const productId = arg("--productId") || "beauty-main-001";

function show(channel, before) {
  const after = buildBeautyTrackUrl({
    blogUrl: before,
    productId,
    source: channel,
  });
  console.log(`---- ${channel} ----`);
  console.log(`productId: ${productId}`);
  console.log(`channel: ${channel}`);
  console.log(`生成前URL: ${before}`);
  console.log(`生成後URL: ${after}`);
  console.log(`付与utm: ${JSON.stringify(describeUtm(after))}`);
  console.log("");
  return after;
}

  console.log("UTM sample");
console.log("==========");
show("threads", blogUrl);
show("instagram", blogUrl);

const livingPid = arg("--livingProductId") || "living-main-001";
const livingUrl = buildTrackUrl({
  blogUrl,
  productId: livingPid,
  source: "threads",
  genre: "living",
});
console.log("---- living threads ----");
console.log(`productId: ${livingPid}`);
console.log(`生成後URL: ${livingUrl}`);
console.log(`付与utm: ${JSON.stringify(describeUtm(livingUrl))}`);
console.log("");

const existing = "https://example.com/p?utm_source=keep&x=1";
const kept = appendUtmParams(existing, {
  utm_source: "threads",
  utm_medium: "social",
  utm_campaign: "beauty_demo",
  utm_content: "threads_20261004",
});
console.log("---- 既存 utm_source を上書きしない ----");
console.log(`生成前URL: ${existing}`);
console.log(`生成後URL: ${kept}`);
console.log(`付与utm: ${JSON.stringify(describeUtm(kept))}`);
console.log("");
console.log("期待: utm_source=keep のまま、medium/campaign/content が追加される");
