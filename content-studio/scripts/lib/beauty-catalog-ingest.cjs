/**
 * 美容 Catalog Ingest:
 * 許可ブランド公式一覧をクロール → candidate queue → 品質ゲート → 適格のみカタログ投入
 */
const fs = require("fs");
const path = require("path");
const {
  brandListingSeeds,
  isVcLinkSwitchProductUrl,
} = require("./vc-linkswitch-url.cjs");
const {
  DEFAULT_QUEUE_PATH,
  catalogIdFromUrl,
  loadQueue,
  saveQueue,
  upsertCandidate,
  summarizeQueue,
  normalizeUrlKey,
} = require("./beauty-candidate-queue.cjs");
const { evaluateCandidate, BAD_PATH_RE } = require("./beauty-candidate-gate.cjs");
const { isProductionEligibleProduct } = require("./beauty-copy-guard.cjs");
const { resolvePromoteBucket } = require("./beauty-profit-score.cjs");
const { loadWindows } = require("./beauty-sale-windows.cjs");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_POLICY_PATH = path.join(ROOT, "policy", "beauty-ingest.json");
const DEFAULT_PRODUCTS_PATH = path.join(ROOT, "input", "products-beauty.json");

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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadIngestPolicy(filePath = DEFAULT_POLICY_PATH) {
  const raw = readJson(filePath, {});
  return {
    enabled: raw.enabled !== false,
    promoteReady: raw.promoteReady !== false,
    defaultBucket: String(raw.defaultBucket || "main"),
    maxPagesPerBrand: Number(raw.maxPagesPerBrand) || 2,
    maxDiscoverPerRun: Number(raw.maxDiscoverPerRun) || 40,
    maxEnrichPerRun: Number(raw.maxEnrichPerRun) || 24,
    maxPromotePerRun: Number(raw.maxPromotePerRun) || 12,
    fetchTimeoutMs: Number(raw.fetchTimeoutMs) || 12000,
    brands: Array.isArray(raw.brands) ? raw.brands : [],
  };
}

function flattenCatalog(products) {
  return [
    ...(products.sale || []),
    ...(products.main || []),
    ...(products.niche || []),
    ...(products.routine || []),
  ];
}

function catalogIndexes(products) {
  const urlKeys = new Set();
  const ids = new Set();
  for (const item of flattenCatalog(products)) {
    if (item?.id) ids.add(String(item.id));
    const url = String(item?.productUrl || item?.affiliateUrl || "").trim();
    const key = normalizeUrlKey(url);
    if (key) urlKeys.add(key);
  }
  return { urlKeys, ids };
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function cleanLinkText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 一覧HTMLから商品っぽい通常URLを抽出（キーワード不要）
 */
function extractListingProductLinks(html, baseUrl, brand) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = absoluteUrl(m[1], baseUrl);
    if (!href) continue;
    let path = "";
    try {
      path = new URL(href).pathname || "";
    } catch {
      continue;
    }
    if (BAD_PATH_RE.test(path)) continue;
    const verdict = isVcLinkSwitchProductUrl(href, { brand });
    if (!verdict.ok) continue;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const text = cleanLinkText(m[2]).slice(0, 120);
    out.push({
      productUrl: href.split("#")[0],
      productName: text,
      brand,
      source: "official-listing",
    });
  }
  return out;
}

async function defaultFetch(url, init) {
  if (typeof fetch !== "function") {
    throw new Error("fetch が使えません（Node 18+ が必要）");
  }
  return fetch(url, init);
}

function metaContent(html, property) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  const m = re.exec(html) || re2.exec(html);
  return m ? cleanLinkText(m[1]) : "";
}

function extractTitle(html) {
  const og = metaContent(html, "og:title");
  if (og) return og;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? cleanLinkText(m[1]).slice(0, 120) : "";
}

function extractImage(html, baseUrl) {
  const og = metaContent(html, "og:image");
  if (og) return absoluteUrl(og, baseUrl) || og;
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (!img) return "";
  return absoluteUrl(img[1], baseUrl) || "";
}

async function fetchHtml(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const timeoutMs = Number(opts.timeoutMs) || 12000;
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": "content-studio-beauty-ingest/1.0",
      Accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await res.text();
  return {
    ok: res.ok || html.length > 1000,
    status: res.status,
    finalUrl: res.url || url,
    html,
  };
}

async function discoverFromBrand(brandCfg, opts = {}) {
  const brand = String(brandCfg.brand || "").trim();
  const seeds = brandListingSeeds(brand).slice(
    0,
    Number(opts.maxPagesPerBrand) || 2,
  );
  const pageLogs = [];
  const found = [];
  if (!brand || seeds.length === 0) {
    return {
      brand,
      found,
      pageLogs: [{ error: "brandListingSeeds 未設定" }],
    };
  }

  for (const seed of seeds) {
    try {
      const page = await fetchHtml(seed, opts);
      pageLogs.push({
        seed,
        httpStatus: page.status,
        finalUrl: page.finalUrl,
        htmlLen: page.html.length,
      });
      if (!page.ok) continue;
      const links = extractListingProductLinks(page.html, page.finalUrl, brand);
      for (const link of links) {
        found.push({
          ...link,
          genre: brandCfg.genre || "",
          category: brandCfg.category || "",
          bucket: opts.defaultBucket || "main",
        });
      }
    } catch (e) {
      pageLogs.push({ seed, error: `network: ${e.message || e}` });
    }
  }
  return { brand, found, pageLogs };
}

async function enrichCandidate(candidate, opts = {}) {
  const url = String(candidate.productUrl || "").trim();
  if (!url) return candidate;
  try {
    const page = await fetchHtml(url, opts);
    if (!page.ok) return candidate;
    const title = extractTitle(page.html);
    const image = extractImage(page.html, page.finalUrl);
    const next = { ...candidate };
    if (title && (!next.productName || next.productName.length < 4)) {
      next.productName = title.replace(/\s*[|\-–].*$/, "").trim().slice(0, 120);
    } else if (title && title.length > next.productName.length) {
      // 既存名が弱いときだけ差し替え
      if (next.productName.length < 6) {
        next.productName = title.replace(/\s*[|\-–].*$/, "").trim().slice(0, 120);
      }
    }
    if (image && /^https?:\/\//i.test(image)) {
      next.imageUrl = image;
    }
    return next;
  } catch {
    return candidate;
  }
}

function buildArticleCopy(item) {
  const brand = item.brand || "";
  const name = item.productName || "このアイテム";
  return {
    articleTitle: `${brand}の${name}、毎日使いで気になった点`,
    articleBody:
      `${name}が気になっています。` +
      `${brand}らしい仕上がりや使い心地を、ブログで短く整理します。` +
      `詳しい条件や雰囲気はブログ記事で確認できます。`,
  };
}

function toCatalogItem(candidate, bucket) {
  const copy = buildArticleCopy(candidate);
  const id = catalogIdFromUrl(candidate.productUrl);
  return {
    id,
    brand: candidate.brand,
    category: candidate.category || "beauty",
    productName: candidate.productName,
    productUrl: candidate.productUrl,
    affiliateUrl: "",
    blogUrl: "",
    imageUrl: candidate.imageUrl || "",
    postType: bucket,
    genre: candidate.genre || "美容",
    articleTitle: copy.articleTitle,
    articleBody: copy.articleBody,
    labels: {
      sale: bucket === "sale",
      point: false,
      conditionalDeal: false,
      detailCheck: true,
    },
    source: "auto-ingest",
    ingestedAt: new Date().toISOString(),
  };
}

function promoteReadyToCatalog(products, queue, opts = {}) {
  const maxPromote = Number(opts.maxPromotePerRun) || 12;
  const defaultBucket = String(opts.defaultBucket || "main");
  const saleWindows = opts.saleWindows || loadWindows();
  const { urlKeys, ids } = catalogIndexes(products);
  const promoted = [];
  const promotedBuckets = {};
  let remaining = maxPromote;

  const nextProducts = {
    sale: [...(products.sale || [])],
    main: [...(products.main || [])],
    niche: [...(products.niche || [])],
    routine: [...(products.routine || [])],
  };

  for (const item of queue.items || []) {
    if (remaining <= 0) break;
    if (item.status !== "ready") continue;
    const catalogId = catalogIdFromUrl(item.productUrl);
    const urlKey = normalizeUrlKey(item.productUrl);
    if (ids.has(catalogId) || (urlKey && urlKeys.has(urlKey))) {
      item.status = "promoted";
      item.catalogId = catalogId;
      item.promotedAt = item.promotedAt || new Date().toISOString();
      continue;
    }
    const bucket = resolvePromoteBucket(
      { ...item, catalogId, id: catalogId },
      {
        defaultBucket,
        saleWindows,
        targetDate: opts.targetDate,
      },
    );
    if (!nextProducts[bucket]) nextProducts[bucket] = [];
    const row = toCatalogItem({ ...item, catalogId }, bucket);
    if (!isProductionEligibleProduct(row)) {
      item.status = "needsReview";
      item.gate = {
        ...(item.gate || {}),
        ok: false,
        status: "needsReview",
        reasons: [...(item.gate?.reasons || []), "promote_not_production_eligible"],
      };
      continue;
    }
    nextProducts[bucket].push(row);
    item.status = "promoted";
    item.catalogId = row.id;
    item.promotedBucket = bucket;
    item.promotedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    ids.add(row.id);
    if (urlKey) urlKeys.add(urlKey);
    promoted.push(row.id);
    promotedBuckets[bucket] = (promotedBuckets[bucket] || 0) + 1;
    remaining -= 1;
  }

  return { products: nextProducts, promoted, promotedBuckets, queue };
}

/**
 * メイン入口
 */
async function runBeautyCatalogIngest(opts = {}) {
  const policyPath = opts.policyPath || DEFAULT_POLICY_PATH;
  const productsPath = opts.productsPath || DEFAULT_PRODUCTS_PATH;
  const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
  const dryRun = opts.dryRun === true;
  const policy = loadIngestPolicy(policyPath);

  const enabledEnv = String(
    process.env.BEAUTY_INGEST_ENABLED ?? (policy.enabled ? "true" : "false"),
  ).toLowerCase();
  const enabled = !["0", "false", "off", "no"].includes(enabledEnv);
  if (!enabled && !opts.force) {
    return {
      skipped: true,
      reason: "disabled",
      summary: { discovered: 0, ready: 0, needsReview: 0, rejected: 0, promoted: 0 },
    };
  }

  const promoteEnv = String(
    process.env.BEAUTY_INGEST_PROMOTE ?? (policy.promoteReady ? "true" : "false"),
  ).toLowerCase();
  const promoteReady = !["0", "false", "off", "no"].includes(promoteEnv);

  const maxDiscover =
    Number(process.env.BEAUTY_INGEST_MAX_DISCOVER) || policy.maxDiscoverPerRun;
  const maxEnrich =
    Number(process.env.BEAUTY_INGEST_MAX_ENRICH) || policy.maxEnrichPerRun;
  const maxPromote =
    Number(process.env.BEAUTY_INGEST_MAX_PROMOTE) || policy.maxPromotePerRun;
  const timeoutMs =
    Number(process.env.BEAUTY_INGEST_TIMEOUT_MS) || policy.fetchTimeoutMs;

  let products = readJson(productsPath, { sale: [], main: [], niche: [], routine: [] });
  let queue = loadQueue(queuePath);
  const { urlKeys, ids } = catalogIndexes(products);

  const discoverLogs = [];
  let discovered = 0;
  const fresh = [];

  for (const brandCfg of policy.brands) {
    if (discovered >= maxDiscover) break;
    const got = await discoverFromBrand(brandCfg, {
      fetchImpl: opts.fetchImpl,
      timeoutMs,
      maxPagesPerBrand: policy.maxPagesPerBrand,
      defaultBucket: policy.defaultBucket,
    });
    discoverLogs.push({
      brand: got.brand,
      found: got.found.length,
      pages: got.pageLogs,
    });
    for (const link of got.found) {
      if (discovered >= maxDiscover) break;
      const key = normalizeUrlKey(link.productUrl);
      if (key && urlKeys.has(key)) continue;
      const { item, created } = upsertCandidate(queue, {
        ...link,
        status: "discovered",
        catalogId: catalogIdFromUrl(link.productUrl),
      });
      if (created) {
        discovered += 1;
        fresh.push(item);
      }
    }
  }

  // enrich: 新規 + 画像なしの needsReview/discovered
  const enrichTargets = (queue.items || [])
    .filter((x) => x.status === "discovered" || x.status === "needsReview")
    .filter((x) => !x.imageUrl || !x.productName || x.productName.length < 4)
    .slice(0, maxEnrich);

  let enriched = 0;
  for (const target of enrichTargets) {
    const next = await enrichCandidate(target, {
      fetchImpl: opts.fetchImpl,
      timeoutMs,
    });
    Object.assign(target, next, { updatedAt: new Date().toISOString() });
    enriched += 1;
  }

  // gate all non-terminal
  let ready = 0;
  let needsReview = 0;
  let rejected = 0;
  for (const item of queue.items || []) {
    if (item.status === "promoted") continue;
    const gate = evaluateCandidate(
      { ...item, catalogId: catalogIdFromUrl(item.productUrl) },
      { catalogUrlKeys: urlKeys, catalogIds: ids },
    );
    item.gate = gate;
    item.status = gate.status;
    item.updatedAt = new Date().toISOString();
    if (gate.status === "ready") ready += 1;
    else if (gate.status === "needsReview") needsReview += 1;
    else if (gate.status === "rejected") rejected += 1;
  }

  let promoted = [];
  let promotedBuckets = {};
  if (promoteReady) {
    const result = promoteReadyToCatalog(products, queue, {
      maxPromotePerRun: maxPromote,
      defaultBucket: policy.defaultBucket,
      saleWindows: opts.saleWindows || loadWindows(),
    });
    products = result.products;
    queue = result.queue;
    promoted = result.promoted;
    promotedBuckets = result.promotedBuckets || {};
  }

  if (!dryRun) {
    saveQueue(queue, queuePath);
    if (promoted.length > 0) {
      writeJson(productsPath, products);
    }
  }

  const queueSummary = summarizeQueue(queue);
  return {
    skipped: false,
    dryRun,
    discovered,
    enriched,
    ready,
    needsReview,
    rejected,
    promoted,
    promotedBuckets,
    promoteReady,
    discoverLogs,
    queueSummary,
    productsPath,
    queuePath,
  };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  DEFAULT_PRODUCTS_PATH,
  loadIngestPolicy,
  extractListingProductLinks,
  enrichCandidate,
  evaluateCandidate,
  promoteReadyToCatalog,
  toCatalogItem,
  runBeautyCatalogIngest,
  catalogIndexes,
  buildArticleCopy,
};
