#!/usr/bin/env node
/**
 * 美容カタログの本番在庫ファネルを表示する。
 *
 *   node scripts/audit-beauty-inventory.cjs
 */
const fs = require("fs");
const path = require("path");
const {
  isProductionEligibleProduct,
  findBannedHits,
  loadRecentBeautyPosts,
  isRecentDuplicateProduct,
} = require("./lib/beauty-copy-guard.cjs");

const ROOT = path.join(__dirname, "..");
const products = JSON.parse(
  fs.readFileSync(path.join(ROOT, "input", "products-beauty.json"), "utf8"),
);
const posted = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "posted-beauty.json"), "utf8"),
);
const postedSet = new Set(Array.isArray(posted) ? posted : []);
const recent = loadRecentBeautyPosts();
const all = [
  ...(products.sale || []),
  ...(products.main || []),
  ...(products.niche || []),
  ...(products.routine || []),
];

function hasRealUrl(item) {
  const url = String(item.productUrl || item.affiliateUrl || "").trim();
  if (!url) return false;
  if (/example\.com/i.test(url) || /YOURBLOG/i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const rows = all.map((item) => {
  const blob = [item.id, item.productName, item.articleTitle, item.articleBody, item.productUrl]
    .map((x) => String(x || ""))
    .join("\n");
  const banned = findBannedHits(blob);
  const testOnly = item.testOnly === true || item.productionEligible === false;
  const realUrl = hasRealUrl(item);
  const afterTest = !testOnly;
  const afterBanned = afterTest && banned.length === 0;
  const afterUrl = afterBanned && realUrl;
  const dup = isRecentDuplicateProduct(item, recent);
  const afterRecent = afterUrl && !dup.duplicate;
  const unposted = !postedSet.has(item.id);
  const finalOk =
    afterRecent && unposted && isProductionEligibleProduct(item);
  return {
    id: item.id,
    name: item.productName,
    testOnly,
    banned: banned.join("|"),
    realUrl,
    recentDup: dup.duplicate ? dup.reason : "",
    posted: postedSet.has(item.id),
    finalOk,
  };
});

const count = (pred) => rows.filter(pred).length;
const summary = {
  catalogTotal: rows.length,
  withRealUrl: count((r) => r.realUrl),
  afterTestOnlyExclude: count((r) => !r.testOnly),
  afterBannedExclude: count((r) => !r.testOnly && !r.banned),
  afterRecent7dExclude: count(
    (r) => !r.testOnly && !r.banned && r.realUrl && !r.recentDup,
  ),
  finalProductionSelectableUnposted: count((r) => r.finalOk),
  emptyFallback: process.env.BEAUTY_EMPTY_FALLBACK || "recycle",
  postedIds: [...postedSet],
  recentIds: [...recent.ids],
  selectableIds: rows.filter((r) => r.finalOk).map((r) => r.id),
  blocked: rows
    .filter((r) => !r.finalOk)
    .map((r) => ({
      id: r.id,
      why: [
        r.testOnly ? "testOnly" : null,
        r.banned ? `banned:${r.banned}` : null,
        !r.realUrl ? "no-real-url" : null,
        r.recentDup || null,
        r.posted ? "posted" : null,
      ].filter(Boolean),
    })),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.finalProductionSelectableUnposted === 0) {
  console.warn(
    "WARN: 本番未投稿候補=0。明日は BEAUTY_EMPTY_FALLBACK=recycle（既定）で最古の本番適格投稿を再利用します。",
  );
}
