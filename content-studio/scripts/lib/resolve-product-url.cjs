/**
 * 選定後の通常商品ページURL解決（LinkSwitch 向け）。
 * Phase 1: 既存 usable URL → product-url-map.json
 * Phase 2: brand/name 検索（rakuten → web）→ article / catalog / map へ書き戻し
 */

const fs = require("fs");
const path = require("path");
const {
  buildSearchKeyword,
  searchProductPageUrl,
} = require("./product-url-search.cjs");
const { isVcLinkSwitchProductUrl } = require("./vc-linkswitch-url.cjs");

const root = path.join(__dirname, "..", "..");
const defaultMapPath = path.join(root, "input", "product-url-map.json");
const defaultProductsPath = path.join(root, "input", "products-beauty.json");

/**
 * LinkSwitch に載せる通常商品URLか。
 * モール（楽天/Amazon等）・example.com・トップのみは不可。
 */
function isUsableProductUrl(url, opts = {}) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (/YOURBLOG|REPLACE-|placeholder/i.test(raw)) return false;
  return isVcLinkSwitchProductUrl(raw, opts).ok;
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadUrlMap(mapPath = defaultMapPath) {
  const data = readJson(mapPath, {});
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    } else if (value && typeof value === "object" && typeof value.url === "string") {
      out[key] = value.url.trim();
    }
  }
  return out;
}

function resolveFromMap(productId, map) {
  const id = String(productId || "").trim();
  if (!id) return null;
  const hit = map[id];
  return typeof hit === "string" && hit.trim() ? hit.trim() : null;
}

/**
 * @param {{ productId?: string, brand?: string, productName?: string, currentUrl?: string }} input
 * @param {{ provider?: string, mapPath?: string, searchOpts?: object, skipSearch?: boolean }} [opts]
 * @returns {Promise<{ url: string|null, source: string, reason?: string, detail?: object }>}
 */
async function resolveProductPageUrl(input, opts = {}) {
  const provider = String(
    opts.provider || process.env.PRODUCT_URL_PROVIDER || "auto",
  )
    .trim()
    .toLowerCase();
  const mapPath = opts.mapPath || defaultMapPath;
  const current = String(input.currentUrl || "").trim();
  const steps = [];

  const brand = input.brand || "";
  if (isUsableProductUrl(current, { brand })) {
    return {
      url: current,
      source: "existing",
      detail: { steps: [{ step: "existing", ok: true, url: current }] },
    };
  }
  steps.push({
    step: "existing",
    ok: false,
    url: current || "(empty)",
    reason:
      isVcLinkSwitchProductUrl(current, { brand }).reason ||
      "usable ではない（空 / モール / 許可外ドメイン / 不正）",
  });

  const useMap = provider === "map" || provider === "auto" || provider === "search";
  if (useMap) {
    const map = loadUrlMap(mapPath);
    const fromMap = resolveFromMap(input.productId, map);
    if (fromMap && isUsableProductUrl(fromMap, { brand })) {
      steps.push({ step: "map", ok: true, url: fromMap });
      return { url: fromMap, source: "map", detail: { steps } };
    }
    steps.push({
      step: "map",
      ok: false,
      productId: input.productId || "",
      reason: fromMap
        ? `map URL が VC許可外: ${isVcLinkSwitchProductUrl(fromMap, { brand }).reason}`
        : "map に usable URL なし",
      mapUrl: fromMap || "",
      mapPath,
    });
  }

  const useSearch =
    !opts.skipSearch &&
    (provider === "auto" || provider === "search" || provider === "web");

  if (!useSearch) {
    return {
      url: null,
      source: "none",
      reason:
        `VC許可の通常商品URLがありません` +
        ` (id=${input.productId || "-"} brand=${input.brand || "-"} name=${input.productName || "-"})` +
        ` → map を埋めるか PRODUCT_URL_PROVIDER=auto で検索を有効にしてください`,
      detail: { provider, steps },
    };
  }

  const keyword = buildSearchKeyword(input.brand, input.productName);
  if (!keyword) {
    return {
      url: null,
      source: "none",
      reason: "brand / productName が空のため検索できない",
      detail: { provider, steps },
    };
  }

  const searchOpts = { ...(opts.searchOpts || {}), brand };
  if (provider === "web") searchOpts.chain = "web";

  const searched = await searchProductPageUrl(keyword, searchOpts);
  steps.push({
    step: "search",
    ok: Boolean(searched.ok && searched.url),
    source: searched.source,
    ...(searched.detail || {}),
  });

  if (searched.ok && searched.url && isUsableProductUrl(searched.url, { brand })) {
    return {
      url: searched.url,
      source: searched.source || "search",
      detail: { provider, keyword, brand, steps, itemName: searched.itemName || "" },
    };
  }

  return {
    url: null,
    source: "none",
    reason:
      `検索でも VC許可の通常商品URLを取得できなかった` +
      ` (id=${input.productId || "-"} brand=${input.brand || "-"} name=${input.productName || "-"}` +
      ` keyword=${keyword})`,
    detail: { provider, keyword, brand, steps, search: searched.detail || {} },
  };
}

/** products-beauty.json の同IDに productUrl を書き戻す */
function writeBackProductUrl(productId, url, productsPath = defaultProductsPath, opts = {}) {
  const id = String(productId || "").trim();
  const pageUrl = String(url || "").trim();
  if (!id || !isUsableProductUrl(pageUrl, opts)) return false;
  if (!fs.existsSync(productsPath)) return false;

  const products = readJson(productsPath, null);
  if (!products || typeof products !== "object") return false;

  let updated = false;
  for (const key of Object.keys(products)) {
    const list = products[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && item.id === id) {
        item.productUrl = pageUrl;
        updated = true;
      }
    }
  }
  if (updated) writeJson(productsPath, products);
  return updated;
}

/** product-url-map.json に productId → url を書き戻す（_comment は保持） */
function writeBackUrlMap(productId, url, mapPath = defaultMapPath, opts = {}) {
  const id = String(productId || "").trim();
  const pageUrl = String(url || "").trim();
  if (!id || !isUsableProductUrl(pageUrl, opts)) return false;

  const data = readJson(mapPath, {});
  const next = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  if (!next._comment) {
    next._comment =
      "productId → 通常の商品ページURL（LinkSwitch用）。VC個別アフィURLは入れない。example.com は不可。";
  }
  next[id] = pageUrl;
  writeJson(mapPath, next);
  return true;
}

module.exports = {
  isUsableProductUrl,
  loadUrlMap,
  resolveProductPageUrl,
  writeBackProductUrl,
  writeBackUrlMap,
  defaultMapPath,
  defaultProductsPath,
  buildSearchKeyword,
  isVcLinkSwitchProductUrl,
};
