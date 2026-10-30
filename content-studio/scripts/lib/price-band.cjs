/**
 * 価格帯: 床は硬く（ゴミ除外）、天井は需要・高単価カテゴリで緩和。
 * preferred 帯は選定のソフト加点のみ（ここでは扱わない）。
 */
const { estimatePriceYen, isPriceInBand } = require("./living-ops.cjs");

function readLabels(item) {
  return item?.labels && typeof item.labels === "object" ? item.labels : {};
}

function productBlob(item) {
  return [
    item?.name,
    item?.nameRaw,
    item?.productName,
    item?.description,
    item?.articleBody,
    ...(Array.isArray(item?.features) ? item.features : []),
  ]
    .map((x) => String(x || ""))
    .join("\n");
}

function matchAnyPattern(blob, patterns) {
  const list = Array.isArray(patterns) ? patterns : [];
  return list.some((p) => {
    const s = String(p || "").trim();
    if (!s) return false;
    try {
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob);
    } catch {
      return blob.toLowerCase().includes(s.toLowerCase());
    }
  });
}

/**
 * 高単価を許可する商品か（ソーラー蓄電・防災電源・需要テーマなど）
 */
function isHighTicketItem(item, ops = {}) {
  if (!item) return false;
  const labels = readLabels(item);
  if (labels.highTicket === true || labels.stockpile === true) return true;
  // 希少・実入荷枠は価格で落とさない（food/drink の limited|arrival）
  if (labels.limited === true || labels.arrival === true) return true;
  if (labels.demandTheme) return true;

  const ht = ops.productRules?.highTicket || {};
  const cats = Array.isArray(ht.categories)
    ? ht.categories.map((c) => String(c).toLowerCase())
    : [];
  const cat = String(item.category || "").trim().toLowerCase();
  if (cat && cats.includes(cat)) return true;

  const patterns = Array.isArray(ht.namePatterns) ? ht.namePatterns : [];
  if (patterns.length && matchAnyPattern(productBlob(item), patterns)) return true;
  return false;
}

/**
 * @returns {{ minYen: number, maxYen: number, highTicket: boolean }}
 */
function resolvePriceLimits(item, ops = {}) {
  const rules = ops.productRules || {};
  const minYen = Number(rules.priceMinYen);
  const baseMax = Number(rules.priceMaxYen);
  const high = isHighTicketItem(item, ops);
  const htMax = Number(rules.highTicket?.priceMaxYen ?? rules.priceMaxYenHighTicket);
  const maxYen = high && Number.isFinite(htMax) && htMax > 0
    ? Math.max(Number.isFinite(baseMax) ? baseMax : 0, htMax)
    : Number.isFinite(baseMax) && baseMax > 0
      ? baseMax
      : 15000;
  return {
    minYen: Number.isFinite(minYen) && minYen > 0 ? minYen : 300,
    maxYen: maxYen > 0 ? maxYen : 15000,
    highTicket: high,
  };
}

function itemPriceOk(item, ops = {}) {
  const { minYen, maxYen } = resolvePriceLimits(item, ops);
  return isPriceInBand(item?.priceRange, minYen, maxYen);
}

module.exports = {
  estimatePriceYen,
  isPriceInBand,
  isHighTicketItem,
  resolvePriceLimits,
  itemPriceOk,
};
