/**
 * 美容候補の品質ゲート（本番不足の自動判定）。
 * ready = 自動カタログ投入可 / needsReview = 人手確認 / rejected = 不採用
 */
const {
  isVcLinkSwitchProductUrl,
} = require("./vc-linkswitch-url.cjs");
const {
  findBannedHits,
  normalizeUrlKey,
} = require("./beauty-copy-guard.cjs");
const { normalizeUrlKey: queueNormalize } = require("./beauty-candidate-queue.cjs");

const BAD_PATH_RE =
  /\/(my|wishlist|cart|login|account|customer|register|checkout|faq|support|contact|stores?|shop-list|sitemap)(\/|$)/i;

/** 商品SKUが無いキャンペーン/イベント導線は自動投入しない */
const CAMPAIGN_PATH_RE = /\/(event|campaign|special|feature|collection)(\/|$)/i;
const PRODUCT_CODE_RE =
  /\/(HC\d+|[A-Z]{2,}\d{3,}|site\/g\/|products?\/|item\/|sku\/)/i;

const WEAK_NAME_RE =
  /^(詳細|詳しくはこちら|こちら|もっと見る|詳細を見る|view more|see more|buy now|カート|購入|購入する|ログイン|会員|TOP|トップ|home|check|チェック)$/i;

function normalizeKey(url) {
  return normalizeUrlKey(url) || queueNormalize(url);
}

/**
 * @param {object} candidate
 * @param {object} opts
 * @param {Set<string>} [opts.catalogUrlKeys]
 * @param {Set<string>} [opts.catalogIds]
 * @returns {{ ok:boolean, status:'ready'|'needsReview'|'rejected', reasons:string[], checks:Record<string,boolean> }}
 */
function evaluateCandidate(candidate, opts = {}) {
  const brand = String(candidate.brand || "").trim();
  const name = String(candidate.productName || "").trim();
  const url = String(candidate.productUrl || "").trim();
  const imageUrl = String(candidate.imageUrl || "").trim();
  const reasons = [];
  const checks = {
    hasUrl: false,
    vcUrlOk: false,
    pathOk: false,
    nameOk: false,
    bannedClean: false,
    notInCatalog: false,
    hasImage: false,
  };

  if (!url) {
    reasons.push("missing_url");
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.hasUrl = true;

  let path = "";
  try {
    path = new URL(url).pathname || "";
  } catch {
    reasons.push("invalid_url");
    return { ok: false, status: "rejected", reasons, checks };
  }

  if (BAD_PATH_RE.test(path)) {
    reasons.push("bad_path");
    return { ok: false, status: "rejected", reasons, checks };
  }
  if (CAMPAIGN_PATH_RE.test(path) && !PRODUCT_CODE_RE.test(path)) {
    reasons.push("campaign_page_without_sku");
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.pathOk = true;

  const verdict = isVcLinkSwitchProductUrl(url, { brand });
  if (!verdict.ok) {
    reasons.push(`vc_url:${verdict.reason || "fail"}`);
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.vcUrlOk = true;

  const banned = findBannedHits([name, url, brand].join("\n"));
  if (banned.length) {
    reasons.push(`banned:${banned.join("|")}`);
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.bannedClean = true;

  if (
    !name ||
    name.length < 2 ||
    WEAK_NAME_RE.test(name) ||
    /詳しくはこちら|もっと見る|詳細を見る/i.test(name)
  ) {
    reasons.push("weak_or_missing_name");
  } else {
    checks.nameOk = true;
  }

  const urlKey = normalizeKey(url);
  const catalogUrlKeys = opts.catalogUrlKeys || new Set();
  const catalogIds = opts.catalogIds || new Set();
  const catalogId = String(candidate.catalogId || "").trim();
  if (
    (urlKey && catalogUrlKeys.has(urlKey)) ||
    (catalogId && catalogIds.has(catalogId))
  ) {
    reasons.push("already_in_catalog");
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.notInCatalog = true;

  if (imageUrl && /^https?:\/\//i.test(imageUrl) && !/example\.com/i.test(imageUrl)) {
    checks.hasImage = true;
  } else {
    reasons.push("missing_image");
  }

  // 自動投入: 名前+画像+URL が揃っていること
  if (checks.nameOk && checks.hasImage) {
    return { ok: true, status: "ready", reasons: [], checks };
  }

  // 名前はあるが画像なし → レビュー待ち（自動投入しない）
  if (checks.nameOk && !checks.hasImage) {
    return { ok: false, status: "needsReview", reasons, checks };
  }

  // 名前が弱い → レビュー待ち
  return { ok: false, status: "needsReview", reasons, checks };
}

module.exports = {
  BAD_PATH_RE,
  evaluateCandidate,
  normalizeKey,
};
