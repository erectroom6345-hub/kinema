/**
 * ValueCommerce LinkSwitch 前提の通常商品URL判定。
 *
 * 方針:
 * - 貼るのは「VC対応広告主の通常商品ページURL」（公式ブティック等）
 * - 楽天 / Amazon / Yahoo!ショッピング 等のモールURLは成功扱いにしない
 *   （VC資料上 Amazon 等も LinkSwitch 対応だが、本フローではモールを使わない）
 */

/** 明示除外: モール・マーケットプレイス・検索/SNS */
const DENIED_HOST_SUFFIXES = [
  "rakuten.co.jp",
  "rakuten.com",
  "amazon.co.jp",
  "amazon.com",
  "amazon.co.uk",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
  "lohaco.jp",
  "lohaco.com",
  "qoo10.jp",
  "qoo10.com",
  "wowma.jp",
  "auctions.yahoo.co.jp",
  "paypayfleamarket.yahoo.co.jp",
  "mercari.com",
  "mercari.jp",
  "shops.yahoo.co.jp",
  "ebay.com",
  "ebay.co.jp",
  "aliexpress.com",
  "shopify.com", // ストア本体ではなくプラットフォーム自体
];

/** 明示除外: 検索エンジン・SNS・メディア（商品ページではない） */
const DENIED_HOST_SUFFIXES_OTHER = [
  "google.com",
  "google.co.jp",
  "duckduckgo.com",
  "bing.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "wikipedia.org",
  "note.com",
  "example.com",
];

/**
 * VC LinkSwitch 向けに許可する広告主ドメイン（通常商品URL）。
 * 美容カタログのブランド公式ブティックを中心に固定。
 * 追加は ALLOWED_HOST_SUFFIXES / BRAND_DOMAIN_HINTS を編集する。
 */
const ALLOWED_HOST_SUFFIXES = [
  // DECORTÉ / コスメデコルテ公式
  "cosmedecorte.com",
  "decorte.com",
  // IPSA 公式
  "ipsa.co.jp",
  // FANCL 公式
  "fancl.co.jp",
  "fancl.jp",
  // SK-II 公式
  "sk-ii.co.jp",
  "sk-ii.com",
  // hince 公式
  "hince.jp",
  "hince.com",
];

/** brand → 優先ドメイン（検索の site: ヒント & スコア加点） */
const BRAND_DOMAIN_HINTS = {
  コスメデコルテ: ["decorte.com", "cosmedecorte.com"],
  decorté: ["decorte.com", "cosmedecorte.com"],
  decorte: ["decorte.com", "cosmedecorte.com"],
  イプサ: ["ipsa.co.jp"],
  ipsa: ["ipsa.co.jp"],
  fancl: ["fancl.co.jp", "fancl.jp"],
  "sk-ii": ["sk-ii.co.jp", "sk-ii.com"],
  skⅱ: ["sk-ii.co.jp", "sk-ii.com"],
  "sk−ii": ["sk-ii.co.jp", "sk-ii.com"],
  hince: ["hince.jp", "hince.com"],
};

/**
 * 公式サイト上の商品一覧シード（モールを経由せず通常URLを取る）
 * 必要に応じてカテゴリURLを追加する。
 */
const BRAND_LISTING_SEEDS = {
  コスメデコルテ: [
    "https://www.decorte.com/site/basemakeup/r/r3025/",
    "https://www.decorte.com/",
  ],
  decorté: ["https://www.decorte.com/site/basemakeup/r/r3025/", "https://www.decorte.com/"],
  decorte: ["https://www.decorte.com/site/basemakeup/r/r3025/", "https://www.decorte.com/"],
  イプサ: ["https://www.ipsa.co.jp/", "https://www.ipsa.co.jp/product/"],
  ipsa: ["https://www.ipsa.co.jp/", "https://www.ipsa.co.jp/product/"],
  fancl: ["https://www.fancl.co.jp/", "https://www.fancl.co.jp/beauty/"],
  "sk-ii": ["https://www.sk-ii.co.jp/", "https://www.sk-ii.com/"],
  hince: ["https://www.hince.jp/", "https://hince.jp/"],
};

function hostnameOf(url) {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatchesSuffix(host, suffix) {
  const h = String(host || "").toLowerCase();
  const s = String(suffix || "").toLowerCase();
  if (!h || !s) return false;
  return h === s || h.endsWith(`.${s}`);
}

function isDeniedHost(host) {
  const all = [...DENIED_HOST_SUFFIXES, ...DENIED_HOST_SUFFIXES_OTHER];
  return all.some((suffix) => hostMatchesSuffix(host, suffix));
}

function isAllowedHost(host, extraAllowed = []) {
  const allowed = [...ALLOWED_HOST_SUFFIXES, ...extraAllowed];
  return allowed.some((suffix) => hostMatchesSuffix(host, suffix));
}

function brandKeyLookup(map, brand) {
  const key = String(brand || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  for (const [name, value] of Object.entries(map)) {
    if (name.toLowerCase() === key) return value;
  }
  for (const [name, value] of Object.entries(map)) {
    if (key.includes(name.toLowerCase()) || name.toLowerCase().includes(key)) {
      return value;
    }
  }
  return null;
}

function brandDomainHints(brand) {
  const hit = brandKeyLookup(BRAND_DOMAIN_HINTS, brand);
  return hit ? [...hit] : [];
}

function brandListingSeeds(brand) {
  const hit = brandKeyLookup(BRAND_LISTING_SEEDS, brand);
  return hit ? [...hit] : [];
}

/**
 * LinkSwitch に載せる通常商品URLか。
 * - 許可ドメイン上
 * - モール等の除外ドメインではない
 * - トップページのみは不可（商品パスが必要）
 */
function isVcLinkSwitchProductUrl(url, opts = {}) {
  const raw = String(url || "").trim();
  if (!raw) {
    return { ok: false, reason: "empty" };
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "bad_protocol" };
  }

  const host = u.hostname.toLowerCase();
  if (isDeniedHost(host)) {
    return { ok: false, reason: "denied_domain", host };
  }

  const extra = Array.isArray(opts.extraAllowed) ? opts.extraAllowed : [];
  const brandDomains = brandDomainHints(opts.brand);
  if (!isAllowedHost(host, [...extra, ...brandDomains])) {
    return { ok: false, reason: "not_allowed_domain", host };
  }

  const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/") {
    return { ok: false, reason: "homepage_only", host };
  }
  // ブログ記事っぽいパスは除外
  if (/\/(entry|articles?|blog|news|posts?|archives?)\//i.test(path)) {
    return { ok: false, reason: "blog_like_path", host };
  }
  if (/\/20\d{2}\/\d{2}\/\d{2}\//i.test(path)) {
    return { ok: false, reason: "dated_article_path", host };
  }
  // 検索結果は除外
  if (/\/search(\/|$)/i.test(path)) {
    return { ok: false, reason: "search_path", host };
  }

  // 商品ページらしいパス（公式ブティックの /product/ /site/g/ 等）または十分な深さ
  const segs = path.split("/").filter(Boolean);
  const productLike =
    /\/(products?|item|sku|goods|detail|basemakeup|skincare|makeup)(\/|$)/i.test(
      path,
    ) || /\/site\/g\//i.test(path);
  if (!productLike && segs.length < 2) {
    return { ok: false, reason: "not_product_path", host, path };
  }

  return { ok: true, host, path };
}

function describePolicy() {
  return {
    allowedHostSuffixes: [...ALLOWED_HOST_SUFFIXES],
    deniedMallHostSuffixes: [...DENIED_HOST_SUFFIXES],
    deniedOtherHostSuffixes: [...DENIED_HOST_SUFFIXES_OTHER],
    brandDomainHints: { ...BRAND_DOMAIN_HINTS },
    brandListingSeeds: { ...BRAND_LISTING_SEEDS },
  };
}

module.exports = {
  DENIED_HOST_SUFFIXES,
  DENIED_HOST_SUFFIXES_OTHER,
  ALLOWED_HOST_SUFFIXES,
  BRAND_DOMAIN_HINTS,
  BRAND_LISTING_SEEDS,
  hostnameOf,
  hostMatchesSuffix,
  isDeniedHost,
  isAllowedHost,
  brandDomainHints,
  brandListingSeeds,
  isVcLinkSwitchProductUrl,
  describePolicy,
};
