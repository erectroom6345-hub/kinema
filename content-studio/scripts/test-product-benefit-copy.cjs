#!/usr/bin/env node
const assert = require("assert");
const {
  scrubMerchantNoise,
  buildBenefitDescription,
  buildReasonLine,
  audienceFor,
} = require("./lib/product-benefit-copy.cjs");
const { buildArticleCopy } = require("./lib/beauty-catalog-ingest.cjs");

assert.ok(
  !/ポイント5倍/.test(scrubMerchantNoise("保存容器 ポイント5倍 送料無料 密閉")),
);
assert.ok(
  audienceFor("beauty", "face", "クッションファンデ").includes("メイク"),
);

const living = buildBenefitDescription({
  genre: "living",
  category: "kitchen",
  name: "密閉保存容器",
  snippet: "楽天総合ランキング1位 ポイント5倍 密閉 プラスチック",
});
assert.ok(living.includes("向け"), living);
assert.ok(!/ランキング/.test(living), living);

const gadget = buildReasonLine({
  genre: "gadget",
  category: "power",
  name: "GaN充電器",
  snippet: "usb-c usb-a pd gan 65w 100w iPhone14 Galaxy",
});
assert.ok(gadget.length <= 60, gadget);
assert.ok(/充電|向け|人/.test(gadget), gadget);

const beauty = buildArticleCopy({
  brand: "hince",
  productName: "ニュー・ブラーティント",
  genre: "リップ",
});
assert.ok(beauty.articleBody.length > 80, beauty.articleBody);
assert.ok(/塗り|向け|使用感/.test(beauty.articleBody), beauty.articleBody);
assert.ok(!/香りが強め|やさしい香り|匂いが強め/.test(beauty.articleBody));
assert.ok(!/ブログで短く整理/.test(beauty.articleBody));

console.log("test-product-benefit-copy: OK");
console.log(" beauty sample:", beauty.articleBody.slice(0, 120));
console.log(" living sample:", living);
console.log(" gadget sample:", gadget);
