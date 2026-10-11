/**
 * 美容カタログのハイブリッド利潤スコア（料率データ無し）。
 * セール緊急度 × 過去KPI × 未投稿/多様性 × recycle間隔
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_POLICY_PATH = path.join(ROOT, "policy", "beauty-profit.json");
const DEFAULT_HISTORY_PATH = path.join(
  ROOT,
  "output",
  "metrics",
  "post-history.jsonl",
);

const DEFAULT_WEIGHTS = {
  saleBucket: 40,
  saleLabel: 15,
  saleUrgencyMax: 50,
  brandReach: 0.15,
  brandSaved: 2,
  brandInteractions: 0.5,
  categoryReach: 0.05,
  categorySaved: 0.5,
  noveltyUnposted: 25,
  noveltyLowPost: 10,
  brandDiversityPenalty: -30,
  recycleDaysSince: 0.8,
  recycleSuccessBonus: 15,
};

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadProfitPolicy(filePath = DEFAULT_POLICY_PATH) {
  const raw = readJson(filePath, {});
  return {
    recentBrandWindow: Number(raw.recentBrandWindow) > 0 ? Number(raw.recentBrandWindow) : 3,
    recentPerfDays: Number(raw.recentPerfDays) > 0 ? Number(raw.recentPerfDays) : 60,
    nicheCategories: Array.isArray(raw.nicheCategories) ? raw.nicheCategories.map(String) : [],
    weights: { ...DEFAULT_WEIGHTS, ...(raw.weights || {}) },
    configPath: filePath,
  };
}

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseDay(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
}

function daysBetweenKeys(aKey, bKey) {
  const a = parseDay(aKey);
  const b = parseDay(bKey);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function avg(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * post-history から brand/category 実績と直近ブランド偏りを構築。
 * catalogById: Map|object id → product（brand/category 解決用）
 */
function buildProfitContext(opts = {}) {
  const policy = opts.policy || loadProfitPolicy(opts.policyPath);
  const historyPath = opts.historyPath || DEFAULT_HISTORY_PATH;
  const catalogById = opts.catalogById || new Map();
  const asMap =
    catalogById instanceof Map
      ? catalogById
      : new Map(Object.entries(catalogById || {}));

  const rows = readJsonl(historyPath)
    .filter((r) => String(r.productId || "").trim())
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  const sinceMs =
    Date.now() - Math.max(1, policy.recentPerfDays) * 86_400_000;

  /** @type {Map<string, {reach:number[], saved:number[], interactions:number[], posts:number}>} */
  const byBrand = new Map();
  /** @type {Map<string, {reach:number[], saved:number[], interactions:number[], posts:number}>} */
  const byCategory = new Map();
  /** @type {Map<string, number>} */
  const postCountById = new Map();
  /** @type {Map<string, {at:string, success:number}>} */
  const lastById = new Map();

  const bump = (map, key, metrics) => {
    const k = String(key || "").trim();
    if (!k) return;
    let row = map.get(k);
    if (!row) {
      row = { reach: [], saved: [], interactions: [], posts: 0 };
      map.set(k, row);
    }
    row.posts += 1;
    const m = metrics && typeof metrics === "object" ? metrics : {};
    if (typeof m.reach === "number") row.reach.push(m.reach);
    if (typeof m.saved === "number") row.saved.push(m.saved);
    if (typeof m.total_interactions === "number") {
      row.interactions.push(m.total_interactions);
    }
  };

  for (const row of rows) {
    const id = String(row.productId).trim();
    postCountById.set(id, (postCountById.get(id) || 0) + 1);
    const at = String(row.at || "");
    const prev = lastById.get(id);
    if (!prev || at > prev.at) {
      lastById.set(id, {
        at,
        success: String(row.status || "") === "success" ? 1 : prev?.success || 0,
      });
    } else if (String(row.status || "") === "success") {
      lastById.set(id, { ...prev, success: (prev.success || 0) + 1 });
    }

    const t = Date.parse(at);
    if (!Number.isFinite(t) || t < sinceMs) continue;

    const product = asMap.get(id);
    const brand = String(product?.brand || row.brand || "").trim();
    const category = String(product?.category || row.category || "").trim();
    bump(byBrand, brand, row.metrics);
    bump(byCategory, category, row.metrics);
  }

  const summarize = (row) =>
    row
      ? {
          posts: row.posts,
          reach: avg(row.reach),
          saved: avg(row.saved),
          interactions: avg(row.interactions),
        }
      : { posts: 0, reach: 0, saved: 0, interactions: 0 };

  const brandPerf = {};
  for (const [k, v] of byBrand) brandPerf[k] = summarize(v);
  const categoryPerf = {};
  for (const [k, v] of byCategory) categoryPerf[k] = summarize(v);

  const recentBrands = [];
  for (const row of rows) {
    if (recentBrands.length >= policy.recentBrandWindow) break;
    const id = String(row.productId).trim();
    const product = asMap.get(id);
    const brand = String(product?.brand || row.brand || "").trim();
    if (brand) recentBrands.push(brand);
  }

  return {
    policy,
    brandPerf,
    categoryPerf,
    postCountById,
    lastById,
    recentBrands,
    recentBrandSet: new Set(recentBrands),
  };
}

function saleUrgencyScore(item, targetDate, weights) {
  const start = String(item.saleStart || "").slice(0, 10);
  const end = String(item.saleEnd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return 0;
  }
  if (targetDate < start || targetDate > end) return 0;
  const left = daysBetweenKeys(targetDate, end);
  if (left == null) return 0;
  // 残りが少ないほど高い（0日=最大、14日超でほぼ0）
  const max = Number(weights.saleUrgencyMax) || 50;
  if (left <= 0) return max;
  if (left >= 14) return Math.round(max * 0.15);
  return Math.round(max * (1 - left / 14));
}

/**
 * @returns {{ score:number, breakdown:Record<string, number> }}
 */
function scoreProduct(item, ctx, opts = {}) {
  const policy = ctx.policy || loadProfitPolicy();
  const w = policy.weights || DEFAULT_WEIGHTS;
  const targetDate = opts.targetDate || tokyoDayKey();
  const mode = opts.mode === "recycle" ? "recycle" : "unposted";
  const bucket = String(opts.bucket || item.postType || "main");
  const brand = String(item.brand || "").trim();
  const category = String(item.category || "").trim();
  const id = String(item.id || "").trim();

  const breakdown = {
    saleBucket: bucket === "sale" ? w.saleBucket : 0,
    saleLabel: item.labels?.sale ? w.saleLabel : 0,
    saleUrgency: saleUrgencyScore(item, targetDate, w),
    brandReach: 0,
    brandSaved: 0,
    brandInteractions: 0,
    categoryReach: 0,
    categorySaved: 0,
    novelty: 0,
    brandDiversity: 0,
    recycleDays: 0,
    recycleSuccess: 0,
  };

  const bp = ctx.brandPerf?.[brand] || { reach: 0, saved: 0, interactions: 0 };
  const cp = ctx.categoryPerf?.[category] || { reach: 0, saved: 0, interactions: 0 };
  breakdown.brandReach = (bp.reach || 0) * w.brandReach;
  breakdown.brandSaved = (bp.saved || 0) * w.brandSaved;
  breakdown.brandInteractions = (bp.interactions || 0) * w.brandInteractions;
  breakdown.categoryReach = (cp.reach || 0) * w.categoryReach;
  breakdown.categorySaved = (cp.saved || 0) * w.categorySaved;

  const posts = ctx.postCountById?.get?.(id) || 0;
  if (mode === "unposted") {
    if (posts <= 0) breakdown.novelty = w.noveltyUnposted;
    else if (posts <= 2) breakdown.novelty = w.noveltyLowPost;
  } else {
    const last = ctx.lastById?.get?.(id);
    const lastDay = last?.at ? String(last.at).slice(0, 10) : "";
    const days = lastDay ? daysBetweenKeys(lastDay, targetDate) : 30;
    breakdown.recycleDays = Math.max(0, days || 0) * w.recycleDaysSince;
    if ((last?.success || 0) >= 1 || posts >= 1) {
      breakdown.recycleSuccess = w.recycleSuccessBonus;
    }
  }

  if (brand && ctx.recentBrandSet?.has(brand)) {
    breakdown.brandDiversity = w.brandDiversityPenalty;
  }

  const score =
    Math.round(
      Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0) * 100,
    ) / 100;

  return { score, breakdown };
}

/**
 * 候補を利潤スコア降順で並べ、先頭を返す。
 * @returns {{ item: object|null, score: number|null, breakdown: object|null, ranked: object[] }}
 */
function pickBestByProfit(candidates, ctx, opts = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) {
    return { item: null, score: null, breakdown: null, ranked: [] };
  }
  const ranked = list
    .map((item) => {
      const got = scoreProduct(item, ctx, opts);
      return {
        item,
        id: item.id,
        score: got.score,
        breakdown: got.breakdown,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  const top = ranked[0];
  return {
    item: top.item,
    score: top.score,
    breakdown: top.breakdown,
    ranked,
  };
}

function catalogMapFromProducts(products) {
  const map = new Map();
  for (const bucket of ["sale", "main", "niche", "routine"]) {
    for (const item of products?.[bucket] || []) {
      if (item?.id) map.set(String(item.id), item);
    }
  }
  return map;
}

/**
 * promote 用バケット決定（セール期間 / niche category / default）
 */
function resolvePromoteBucket(candidate, opts = {}) {
  const policy = opts.policy || loadProfitPolicy(opts.policyPath);
  const defaultBucket = String(opts.defaultBucket || "main");
  const today = opts.targetDate || tokyoDayKey();
  const windows = opts.saleWindows?.items || opts.saleWindows || {};
  const catalogId = String(
    candidate.catalogId || candidate.id || "",
  ).trim();
  const url = String(candidate.productUrl || "").trim();

  for (const [pid, win] of Object.entries(windows)) {
    if (!win || typeof win !== "object") continue;
    const start = String(win.start || win.saleStart || "").slice(0, 10);
    const end = String(win.end || win.saleEnd || "").slice(0, 10);
    if (!start || !end) continue;
    if (today < start || today > end) continue;
    const matchId = catalogId && pid === catalogId;
    const matchUrl =
      url &&
      (String(win.productUrl || "") === url ||
        String(win.url || "") === url);
    if (matchId || matchUrl) return "sale";
  }

  const category = String(candidate.category || "").trim();
  if (category && policy.nicheCategories.includes(category)) {
    return "niche";
  }
  return ["sale", "main", "niche", "routine"].includes(defaultBucket)
    ? defaultBucket
    : "main";
}

module.exports = {
  DEFAULT_POLICY_PATH,
  DEFAULT_WEIGHTS,
  loadProfitPolicy,
  buildProfitContext,
  scoreProduct,
  pickBestByProfit,
  catalogMapFromProducts,
  resolvePromoteBucket,
  tokyoDayKey,
  saleUrgencyScore,
};
