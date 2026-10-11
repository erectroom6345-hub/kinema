#!/usr/bin/env node
/**
 * ハイブリッド利潤スコアの単体確認
 */
const assert = require("assert");
const {
  scoreProduct,
  pickBestByProfit,
  resolvePromoteBucket,
  loadProfitPolicy,
} = require("./lib/beauty-profit-score.cjs");

function pass(name) {
  console.log(`PASS ${name}`);
}

const policy = loadProfitPolicy();
const emptyCtx = {
  policy,
  brandPerf: {
    hince: { posts: 3, reach: 100, saved: 5, interactions: 12 },
    FANCL: { posts: 1, reach: 10, saved: 0, interactions: 1 },
  },
  categoryPerf: {
    korean_cosmetics: { posts: 3, reach: 80, saved: 4, interactions: 10 },
    supplement: { posts: 1, reach: 10, saved: 0, interactions: 1 },
  },
  postCountById: new Map(),
  lastById: new Map(),
  recentBrands: ["FANCL"],
  recentBrandSet: new Set(["FANCL"]),
};

const saleItem = {
  id: "beauty-sale-hot",
  brand: "hince",
  category: "korean_cosmetics",
  postType: "sale",
  labels: { sale: true },
  saleStart: "2026-10-01",
  saleEnd: "2026-10-13",
};
const mainItem = {
  id: "beauty-main-cold",
  brand: "FANCL",
  category: "supplement",
  postType: "main",
  labels: {},
};

{
  const a = scoreProduct(saleItem, emptyCtx, {
    targetDate: "2026-10-11",
    bucket: "sale",
    mode: "unposted",
  });
  const b = scoreProduct(mainItem, emptyCtx, {
    targetDate: "2026-10-11",
    bucket: "main",
    mode: "unposted",
  });
  assert.ok(a.score > b.score, `sale(${a.score}) should beat cold main(${b.score})`);
  pass(`sale urgency ranks higher (${a.score} > ${b.score})`);
}

{
  const picked = pickBestByProfit([mainItem, saleItem], emptyCtx, {
    targetDate: "2026-10-11",
    bucket: "sale",
    mode: "unposted",
  });
  assert.strictEqual(picked.item.id, "beauty-sale-hot");
  pass(`pickBestByProfit selects sale winner score=${picked.score}`);
}

{
  const bucket = resolvePromoteBucket(
    { category: "special_care", catalogId: "x" },
    { defaultBucket: "main", saleWindows: { items: {} }, policy },
  );
  assert.strictEqual(bucket, "niche");
  pass("special_care → niche bucket");
}

{
  const bucket = resolvePromoteBucket(
    {
      category: "korean_cosmetics",
      catalogId: "beauty-sale-001",
      productUrl: "https://example.com/p",
    },
    {
      defaultBucket: "main",
      targetDate: "2026-10-11",
      saleWindows: {
        items: {
          "beauty-sale-001": { start: "2026-10-01", end: "2026-10-20" },
        },
      },
      policy,
    },
  );
  assert.strictEqual(bucket, "sale");
  pass("active sale window → sale bucket");
}

{
  const recycleCtx = {
    ...emptyCtx,
    postCountById: new Map([
      ["old-good", 2],
      ["recent-weak", 1],
    ]),
    lastById: new Map([
      ["old-good", { at: "2026-08-01T00:00:00.000Z", success: 2 }],
      ["recent-weak", { at: "2026-10-10T00:00:00.000Z", success: 0 }],
    ]),
    recentBrandSet: new Set(),
  };
  const oldGood = {
    id: "old-good",
    brand: "hince",
    category: "korean_cosmetics",
    postType: "main",
  };
  const recentWeak = {
    id: "recent-weak",
    brand: "FANCL",
    category: "supplement",
    postType: "main",
  };
  const picked = pickBestByProfit([recentWeak, oldGood], recycleCtx, {
    targetDate: "2026-10-11",
    mode: "recycle",
    bucket: "main",
  });
  assert.strictEqual(picked.item.id, "old-good");
  pass(`recycle prefers rested success id=${picked.item.id} score=${picked.score}`);
}

console.log("\nall beauty-profit-score tests PASS");
