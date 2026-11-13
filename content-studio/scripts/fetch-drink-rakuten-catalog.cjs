#!/usr/bin/env node
/**
 * drink カタログ自動取得（楽天市場商品検索API → products-drink.json の main[]）
 *
 *   node scripts/fetch-drink-rakuten-catalog.cjs
 *   node scripts/fetch-drink-rakuten-catalog.cjs --dry-run
 *   DRINK_RAKUTEN_INGEST_ENABLED=false … スキップ（exit 0）
 *
 * 既存 select / run-drink は products-drink.json を読むだけなので、
 * 前段でこのスクリプトが main を差し替えれば完全自動ルートになる。
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  searchIchibaItems,
  loadRakutenEnv,
} = require("./lib/rakuten-ichiba.cjs");
const {
  loadDrinkOps,
  categoryLabelJa,
  normalizeCategory,
} = require("./lib/drink-ops.cjs");
const {
  cleanDrinkProductName,
  cleanDrinkSnippet,
} = require("./lib/drink-product-name.cjs");
const { stampIngestedAt } = require("./lib/product-sharpen.cjs");

const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const productsPath = path.join(root, "input", "products-drink.json");
const policyPath = path.join(root, "policy", "drink-rakuten-ingest.json");

function hasFlag(name) {
  return process.argv.includes(name);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function enabled() {
  const v = String(process.env.DRINK_RAKUTEN_INGEST_ENABLED || "true")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function formatPriceYen(price) {
  const n = Math.round(Number(price));
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString("ja-JP")}円`;
}

function slugFromItemCode(itemCode, fallbackIndex) {
  const raw = String(itemCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (raw) return `drink-${raw}`.slice(0, 80);
  return `drink-auto-${fallbackIndex}`;
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescription(item, category, displayName) {
  const { buildBenefitDescription } = require("./lib/product-benefit-copy.cjs");
  const snippet =
    cleanDrinkSnippet(stripHtml(item.catchcopy || ""), 100) ||
    cleanDrinkSnippet(stripHtml(item.itemCaption || ""), 100);
  return buildBenefitDescription({
    genre: "drink",
    category,
    name: displayName,
    snippet,
    maxLen: 140,
  });
}

function buildFeatures(item) {
  const feats = [];
  const catchcopy = cleanDrinkSnippet(stripHtml(item.catchcopy || ""), 36);
  if (catchcopy) feats.push(catchcopy);
  feats.push(`税込目安 ${formatPriceYen(item.itemPrice)}`);
  // ショップは末尾（caption の「根拠」に出さない）
  if (item.shopName) feats.push(`ショップ: ${item.shopName}`);
  while (feats.length < 2) feats.push("食卓や手土産の一杯向き");
  return feats.slice(0, 3);
}

function endAtIso(endTime, fallbackDays) {
  if (endTime) {
    // "YYYY-MM-DD HH:MM" (JST想定) → ISO
    const m = String(endTime).match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/,
    );
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
      const t = Date.parse(iso);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
  }
  const days = Math.max(1, Number(fallbackDays) || 3);
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function toDrinkProduct(item, category, index, opts = {}) {
  const id = slugFromItemCode(item.itemCode, index);
  const priceRange = formatPriceYen(item.itemPrice);
  const nameRaw = String(item.itemName || "").trim();
  const name = cleanDrinkProductName(nameRaw, { maxLen: 28 });
  const description = buildDescription(item, category, name);
  const postType = opts.postType || "main";
  const labelKind = opts.labelKind || null; // sale | campaign | limited
  const labels = {};
  if (labelKind === "campaign") {
    labels.campaign = true;
    labels.campaignEndAt = endAtIso(item.endTime, opts.saleEndAtDays);
  } else if (labelKind === "limited") {
    labels.limited = true;
    labels.limitedEndAt = endAtIso(item.endTime, opts.saleEndAtDays);
  } else if (labelKind === "sale") {
    labels.sale = true;
    labels.saleEndAt = endAtIso(item.endTime, opts.saleEndAtDays);
  }
  if (opts.sharpenSearch) labels.sharpenSearch = true;
  if (item.pointRate && item.pointRate >= 5) {
    labels.popular = true;
  }
  const features = buildFeatures(item);
  if (item.pointRate) {
    features.unshift(`ポイント${item.pointRate}倍`);
  }
  return stampIngestedAt({
    id,
    productId: id,
    name,
    nameRaw,
    category: normalizeCategory(category),
    description,
    priceRange,
    features: features.slice(0, 3),
    rakutenUrl: item.itemUrl,
    imageUrl: item.imageUrl,
    shopName: item.shopName || "",
    postType,
    genre: "drink",
    source: "rakuten_ichiba",
    itemCode: item.itemCode || "",
    pointRate: item.pointRate,
    labels,
    articleTitle: name,
    articleBody: description,
    ingestedAt: opts.priorIngestedAt || "",
  });
}

function isSampleUrl(url) {
  return /sample-shop/i.test(String(url || ""));
}

function rejectByName(item, patterns) {
  const hay = `${item.itemName || ""} ${item.catchcopy || ""}`;
  for (const p of patterns) {
    const s = String(p || "").trim();
    if (s && hay.includes(s)) return s;
  }
  return "";
}

async function fetchCatalog({ dryRun = false } = {}) {
  if (!enabled()) {
    return { skipped: true, reason: "DRINK_RAKUTEN_INGEST_ENABLED=false" };
  }

  const env = loadRakutenEnv();
  if (!env.applicationId || !env.accessKey || !env.affiliateId) {
    const missing = [
      !env.applicationId && "RAKUTEN_APPLICATION_ID",
      !env.accessKey && "RAKUTEN_ACCESS_KEY",
      !env.affiliateId && "RAKUTEN_AFFILIATE_ID",
    ].filter(Boolean);
    throw new Error(
      `楽天API env 不足: ${missing.join(", ")}（完全自動取得には必須）`,
    );
  }

  const ops = loadDrinkOps();
  const policy = readJson(policyPath, {});
  const searches = Array.isArray(policy.searches) ? policy.searches : [];
  if (!searches.length) {
    throw new Error(`policy に searches がありません: ${policyPath}`);
  }

  const minPrice =
    Number(process.env.DRINK_RAKUTEN_MIN_PRICE) ||
    policy.minPrice ||
    ops.productRules?.priceMinYen ||
    500;
  const maxPrice =
    Number(process.env.DRINK_RAKUTEN_MAX_PRICE) ||
    policy.maxPrice ||
    ops.productRules?.priceMaxYen ||
    5000;
  const sleepMs = Number(policy.sleepMsBetweenRequests) || 400;
  const replaceMain =
    String(
      process.env.DRINK_RAKUTEN_INGEST_REPLACE_MAIN ||
        (policy.replaceMain === false ? "false" : "true"),
    )
      .trim()
      .toLowerCase() !== "false";

  const existingEarly = readJson(productsPath, {
    main: [],
    sale: [],
    niche: [],
    routine: [],
  });
  const priorIngestedByCode = new Map();
  for (const bucket of ["main", "sale", "niche", "routine"]) {
    for (const p of existingEarly[bucket] || []) {
      const code = String(p?.itemCode || "").trim();
      const at = String(p?.ingestedAt || p?.labels?.ingestedAt || "").trim();
      if (code && at && !priorIngestedByCode.has(code)) {
        priorIngestedByCode.set(code, at);
      }
    }
  }

  const seenCodes = new Set();
  const seenUrls = new Set();
  const main = [];
  const logs = [];
  const ngKeyword = String(policy.ngKeyword || "").trim();
  const rejectNamePatterns = Array.isArray(policy.rejectNamePatterns)
    ? policy.rejectNamePatterns
    : [];

  for (const search of searches) {
    const category = normalizeCategory(search.category);
    const keyword = String(search.keyword || "").trim();
    const hits = Math.min(
      30,
      Math.max(1, Number(search.hits) || policy.hitsPerCategory || 4),
    );
    if (!keyword) continue;

    const result = await searchIchibaItems({
      keyword,
      hits,
      minPrice,
      maxPrice,
      ngKeyword: ngKeyword || undefined,
    });
    let added = 0;
    let rejected = 0;
    for (const item of result.items) {
      if (item.itemCode && seenCodes.has(item.itemCode)) continue;
      if (seenUrls.has(item.itemUrl)) continue;
      if (isSampleUrl(item.itemUrl)) continue;
      const rejectReason = rejectByName(item, rejectNamePatterns);
      if (rejectReason) {
        rejected += 1;
        continue;
      }
      if (item.itemCode) seenCodes.add(item.itemCode);
      seenUrls.add(item.itemUrl);
      main.push(
        toDrinkProduct(item, category, main.length + 1, {
          sharpenSearch: search.sharpenSearch === true,
          priorIngestedAt: priorIngestedByCode.get(String(item.itemCode || "")) || "",
        }),
      );
      added += 1;
    }
    logs.push({
      category,
      keyword,
      apiCount: result.count,
      fetched: result.items.length,
      added,
      rejected,
    });
    if (sleepMs > 0) await sleep(sleepMs);
  }

  if (!main.length) {
    throw new Error("楽天APIから drink main に投入できる商品が0件でした");
  }

  // セール/キャンペーン割り込み枠（ポイント倍率など）
  const sale = [];
  const saleSearches = Array.isArray(policy.saleSearches)
    ? policy.saleSearches
    : [];
  const saleEndAtDays = Number(policy.saleEndAtDays) || 3;
  for (const search of saleSearches) {
    const category = normalizeCategory(search.category);
    const keyword = String(search.keyword || "").trim();
    const hits = Math.min(30, Math.max(1, Number(search.hits) || 2));
    if (!keyword) continue;
    const labelKind =
      String(search.label || "").trim() === "campaign" ? "campaign" : "sale";
    const result = await searchIchibaItems({
      keyword,
      hits,
      minPrice,
      maxPrice,
      ngKeyword: ngKeyword || undefined,
      pointRateFlag: search.pointRateFlag != null ? Number(search.pointRateFlag) : 1,
      pointRate: search.pointRate != null ? Number(search.pointRate) : undefined,
      sort: "-affiliateRate",
    });
    let added = 0;
    let rejected = 0;
    for (const item of result.items) {
      if (item.itemCode && seenCodes.has(item.itemCode)) continue;
      if (seenUrls.has(item.itemUrl)) continue;
      if (isSampleUrl(item.itemUrl)) continue;
      const rejectReason = rejectByName(item, rejectNamePatterns);
      if (rejectReason) {
        rejected += 1;
        continue;
      }
      if (item.itemCode) seenCodes.add(item.itemCode);
      seenUrls.add(item.itemUrl);
      sale.push(
        toDrinkProduct(item, category, sale.length + 1, {
          postType: "sale",
          labelKind,
          saleEndAtDays,
        }),
      );
      added += 1;
    }
    logs.push({
      category,
      keyword: `[sale/${labelKind}] ${keyword}`,
      apiCount: result.count,
      fetched: result.items.length,
      added,
      rejected,
    });
    if (sleepMs > 0) await sleep(sleepMs);
  }

  const sampleLeft = main.filter((p) => isSampleUrl(p.rakutenUrl));
  if (sampleLeft.length) {
    throw new Error(
      `sample-shop URL が残っています (${sampleLeft.length}件) — 書き込み中止`,
    );
  }

  const existing = existingEarly;
  const next = {
    main: replaceMain ? main : [...main, ...(existing.main || [])],
    sale,
    niche: Array.isArray(existing.niche) ? existing.niche : [],
    routine: Array.isArray(existing.routine) ? existing.routine : [],
    _meta: {
      source: "rakuten_ichiba",
      fetchedAt: new Date().toISOString(),
      replaceMain,
      countMain: replaceMain
        ? main.length
        : main.length + (existing.main || []).length,
      countSale: sale.length,
    },
  };

  if (!dryRun) {
    writeJson(productsPath, next);
  }

  return {
    skipped: false,
    dryRun,
    replaceMain,
    written: !dryRun,
    path: productsPath,
    mainCount: next.main.length,
    saleCount: next.sale.length,
    sampleShopInMain: next.main.filter((p) => isSampleUrl(p.rakutenUrl))
      .length,
    sampleShopInSale: next.sale.filter((p) => isSampleUrl(p.rakutenUrl))
      .length,
    logs,
    preview: next.main.slice(0, 3).map((p) => ({
      id: p.id,
      category: p.category,
      name: p.name,
      priceRange: p.priceRange,
      rakutenUrl: p.rakutenUrl,
      shopName: p.shopName,
    })),
  };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const result = await fetchCatalog({ dryRun });

  if (result.skipped) {
    console.log(`[drink-rakuten] skipped reason=${result.reason}`);
    process.exit(0);
  }

  console.log(
    `[drink-rakuten] dryRun=${result.dryRun}` +
      ` replaceMain=${result.replaceMain}` +
      ` main=${result.mainCount}` +
      ` sale=${result.saleCount}` +
      ` sampleShopMain=${result.sampleShopInMain}` +
      ` sampleShopSale=${result.sampleShopInSale}` +
      ` written=${result.written}` +
      (result._meta?.countSale != null
        ? ""
        : ""),
  );
  for (const log of result.logs) {
    console.log(
      `[drink-rakuten:cat] category=${log.category}` +
        ` keyword=${JSON.stringify(log.keyword)}` +
        ` apiCount=${log.apiCount} fetched=${log.fetched}` +
        ` added=${log.added} rejected=${log.rejected || 0}`,
    );
  }
  for (const p of result.preview) {
    console.log(
      `[drink-rakuten:preview] ${p.id} [${p.category}] ${p.priceRange} ${p.rakutenUrl}`,
    );
  }

  if (result.sampleShopInMain > 0 || result.sampleShopInSale > 0) {
    console.error("[drink-rakuten] FAIL sample-shop が残っています");
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(
    `[drink-rakuten] FAIL ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});

module.exports = { fetchCatalog, toDrinkProduct, isSampleUrl };
