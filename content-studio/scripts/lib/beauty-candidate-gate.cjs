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
const CAMPAIGN_PATH_RE = /\/(event|campaign|special|feature|collection|freepage)(\/|$)/i;
const PRODUCT_CODE_RE =
  /\/(HC\d+|[A-Z]{2,}\d{3,}|site\/g\/|products?\/|item\/|sku\/)/i;

/** デコルテ等のカテゴリハブ（/site/r/r101050/）は SKU ではない */
const CATEGORY_HUB_PATH_RE = /\/site\/r\/r?\d+\/?$/i;

/** 定期便LP（個別商品コード無し） */
const SUBSCRIPTION_LANDING_PATH_RE = /\/site\/p\/teiki_[^/]+/i;

/** hince 本商品（HC / HCSET コード付き） */
const HINCE_SKU_PATH_RE = /\/c\/(?:category|event)\/[^?]+\/(HC\d+|HCSET\d+)\/?$/i;

/** デコルテ本商品（goods: /site/g/gXXXX/） */
const DECORTE_SKU_PATH_RE = /\/site\/g\/g[A-Z0-9]+\/?$/i;

/** 汎用の商品パス（他ブランド向け） */
const GENERIC_SKU_PATH_RE =
  /\/(products?|item|sku|goods|detail)\/[^/]+/i;

const WEAK_NAME_RE =
  /^(詳細|詳しくはこちら|こちら|もっと見る|詳細を見る|view more|see more|buy now|カート|購入|購入する|ログイン|会員|TOP|トップ|home|check|チェック|全て見る|すべて見る)$/i;

/** 公式ブティックTOP・店舗導線の名前 */
const STOREFRONT_NAME_RE =
  /公式オンライン|オンラインブティック|公式サイト|オフィシャルサイト|公式通販|公式オンラインブティック/i;

/** 法務・会員・問い合わせ・ノイズ文言 */
const NON_PRODUCT_NAME_RE =
  /特定商取引|プライバシー|個人情報保護|利用規約|ご利用ガイド|会社概要|お問い合わせ|お問合せ|お買い上げごと|ポイント還元|会員ランク|ギフトラッピング|ラッピング無料|セット商品ご購入|-->|--&gt;|copyright/i;

/** カテゴリ名だけの弱い商品名（SKU名ではない） */
const GENERIC_CATEGORY_NAME_RE =
  /^(クレンジング|クリーム|デイクリーム|ナイトクリーム|フェイスマスク|マスク|マッサージ|UVケア|日焼け止め|スキンケア用アクセサリー|美白ケア|透明感(?:・くすみケア)?|くすみケア|毛穴ケア|角質ケア|引き締めケア|アイケア|不安定肌ケア|インナービューティ|エイジングケア(?:（.+）)?|ベースメイク|スキンケア|メイクアップ|化粧水|乳液|美容液|美容オイル|洗顔|ソープ|FACE|LIP|EYE|BODY|HAIR|MAKEUP|SKINCARE|BASE|POINT|CARE|FRAGRANCE)$/i;

/** 極端に短い英字カテゴリ（FACE / FRAGRANCE 等） */
const SHORT_LATIN_CATEGORY_RE = /^[A-Za-z]{2,12}$/;

function normalizeKey(url) {
  return normalizeUrlKey(url) || queueNormalize(url);
}

/** HTMLエンティティを雑に戻してから名前判定する */
function decodeProductName(raw) {
  return String(raw || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&eacute;/gi, "é")
    .replace(/&Eacute;/gi, "É")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * listing 抽出・自動投入用: 本商品SKU URLか。
 * VC許可ドメインであってもカテゴリハブ等は false。
 */
function isIngestableProductUrl(url, opts = {}) {
  const raw = String(url || "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  let host = "";
  let path = "";
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname || "";
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (BAD_PATH_RE.test(path)) return { ok: false, reason: "bad_path" };
  if (CATEGORY_HUB_PATH_RE.test(path)) return { ok: false, reason: "category_hub_path" };
  if (SUBSCRIPTION_LANDING_PATH_RE.test(path)) {
    return { ok: false, reason: "subscription_landing_without_sku" };
  }
  if (CAMPAIGN_PATH_RE.test(path) && !PRODUCT_CODE_RE.test(path) && !HINCE_SKU_PATH_RE.test(path)) {
    return { ok: false, reason: "campaign_page_without_sku" };
  }

  if (/(^|\.)hince\.jp$/i.test(host)) {
    if (HINCE_SKU_PATH_RE.test(path)) return { ok: true, reason: "hince_sku", host, path };
    return { ok: false, reason: "hince_not_sku_path", host, path };
  }

  if (/(^|\.)(decorte|cosmedecorte)\.com$/i.test(host)) {
    if (DECORTE_SKU_PATH_RE.test(path)) return { ok: true, reason: "decorte_sku", host, path };
    return { ok: false, reason: "decorte_not_sku_path", host, path };
  }

  if (/(^|\.)ipsa\.co\.jp$/i.test(host)) {
    if (/\/product\//i.test(path) && path.split("/").filter(Boolean).length >= 2) {
      return { ok: true, reason: "ipsa_product", host, path };
    }
    return { ok: false, reason: "ipsa_not_product_path", host, path };
  }

  if (GENERIC_SKU_PATH_RE.test(path) || PRODUCT_CODE_RE.test(path)) {
    return { ok: true, reason: "generic_sku", host, path };
  }
  return { ok: false, reason: "not_sku_path", host, path };
}

/**
 * ノイズ候補（カテゴリハブ / 店舗TOP / 定期便LP / 汎用名）か。
 * @returns {string|null} reason or null
 */
function detectNoiseReason(candidate) {
  const name = decodeProductName(candidate.productName || candidate.name || "");
  let path = "";
  try {
    path = new URL(String(candidate.productUrl || "").trim()).pathname || "";
  } catch {
    path = "";
  }

  if (CATEGORY_HUB_PATH_RE.test(path)) return "category_hub_path";
  if (SUBSCRIPTION_LANDING_PATH_RE.test(path) && !PRODUCT_CODE_RE.test(path)) {
    return "subscription_landing_without_sku";
  }
  if (STOREFRONT_NAME_RE.test(name)) return "storefront_name";
  if (NON_PRODUCT_NAME_RE.test(name)) return "non_product_name";
  if (GENERIC_CATEGORY_NAME_RE.test(name)) return "generic_category_name";
  if (SHORT_LATIN_CATEGORY_RE.test(name) && !/\d/.test(name)) {
    return "generic_category_name";
  }
  if (/DECORT[ÉE].*公式/i.test(name) || /コスメデコルテ.*公式オンライン/i.test(name)) {
    return "storefront_name";
  }
  return null;
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
  const name = decodeProductName(candidate.productName || candidate.name || "");
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
    notNoise: false,
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
  if (CATEGORY_HUB_PATH_RE.test(path)) {
    reasons.push("category_hub_path");
    return { ok: false, status: "rejected", reasons, checks };
  }
  if (SUBSCRIPTION_LANDING_PATH_RE.test(path) && !PRODUCT_CODE_RE.test(path)) {
    reasons.push("subscription_landing_without_sku");
    return { ok: false, status: "rejected", reasons, checks };
  }

  const sku = isIngestableProductUrl(url, { brand });
  if (!sku.ok) {
    reasons.push(`not_sku:${sku.reason || "fail"}`);
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.pathOk = true;

  const noise = detectNoiseReason({ ...candidate, productName: name, productUrl: url });
  if (noise) {
    reasons.push(noise);
    return { ok: false, status: "rejected", reasons, checks };
  }
  checks.notNoise = true;

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
  CATEGORY_HUB_PATH_RE,
  SUBSCRIPTION_LANDING_PATH_RE,
  HINCE_SKU_PATH_RE,
  DECORTE_SKU_PATH_RE,
  STOREFRONT_NAME_RE,
  NON_PRODUCT_NAME_RE,
  GENERIC_CATEGORY_NAME_RE,
  isIngestableProductUrl,
  detectNoiseReason,
  decodeProductName,
  evaluateCandidate,
  normalizeKey,
};
