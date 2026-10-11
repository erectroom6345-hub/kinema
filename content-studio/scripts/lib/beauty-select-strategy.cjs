/**
 * 美容日次選定の日付条件戦略。
 *
 * ルール:
 *  - セール日 → sale が due
 *  - 非セール通常日 → main が due（他 due が無いとき）
 *  - niche: anchor から intervalDays ごと
 *  - routine: anchor から intervalDays ごと（既定60日 ≒ 2か月）
 *  - 重なり時の試行順: priorityOrder（既定 sale > niche > routine > main）
 *  - 最優先バケットに未投稿が無ければ同順でフォールバック
 */
const fs = require("fs");
const path = require("path");
const {
  buildProfitContext,
  catalogMapFromProducts,
  pickBestByProfit,
} = require("./beauty-profit-score.cjs");

const DEFAULT_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "..",
  "policy",
  "beauty-select.json"
);

const BUCKETS = ["sale", "main", "niche", "routine"];

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadSelectConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readJson(configPath, {});
  const priorityOrder = Array.isArray(raw.priorityOrder)
    ? raw.priorityOrder.filter((b) => BUCKETS.includes(b))
    : ["sale", "niche", "routine", "main"];
  for (const b of ["sale", "niche", "routine", "main"]) {
    if (!priorityOrder.includes(b)) priorityOrder.push(b);
  }
  return {
    timezone: raw.timezone || "Asia/Tokyo",
    priorityOrder,
    niche: {
      intervalDays: Number(raw.niche?.intervalDays) > 0 ? Number(raw.niche.intervalDays) : 14,
      anchorDate: String(raw.niche?.anchorDate || "2026-01-01").slice(0, 10),
    },
    routine: {
      intervalDays:
        Number(raw.routine?.intervalDays) > 0 ? Number(raw.routine.intervalDays) : 60,
      anchorDate: String(raw.routine?.anchorDate || "2026-01-01").slice(0, 10),
    },
    sale: {
      calendarDates: Array.isArray(raw.sale?.calendarDates)
        ? raw.sale.calendarDates.map((d) => String(d).slice(0, 10))
        : [],
      calendarRanges: Array.isArray(raw.sale?.calendarRanges)
        ? raw.sale.calendarRanges
        : [],
    },
    configPath,
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

function daysBetween(anchorKey, targetKey) {
  const a = parseDay(anchorKey);
  const t = parseDay(targetKey);
  if (!a || !t) return null;
  return Math.round((t.getTime() - a.getTime()) / 86_400_000);
}

function isCycleDue(targetDate, anchorDate, intervalDays) {
  const diff = daysBetween(anchorDate, targetDate);
  if (diff == null || diff < 0) return false;
  const n = Number(intervalDays);
  if (!Number.isFinite(n) || n <= 0) return false;
  return diff % n === 0;
}

function dateInRanges(dayKey, ranges) {
  for (const r of ranges || []) {
    const start = String(r.start || r.from || "").slice(0, 10);
    const end = String(r.end || r.to || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      continue;
    }
    if (dayKey >= start && dayKey <= end) return true;
  }
  return false;
}

/**
 * セール日判定（一次ソース優先）:
 *  1) 商品データ saleStart/saleEnd（beauty-sale-windows から自動供給される想定）
 *  2) policy calendar（補助ミラー。手動運用しない）
 *  強制フラグ forceSaleDay があればそれを優先
 */
function isSaleDay(targetDate, products, config, forceSaleDay) {
  if (forceSaleDay === true) return true;
  if (forceSaleDay === false) return false;

  const saleItems = products?.sale || [];
  for (const item of saleItems) {
    const start = String(item.saleStart || item.labels?.saleStart || "").slice(0, 10);
    const end = String(item.saleEnd || item.labels?.saleEnd || "").slice(0, 10);
    // 開始・終了どちらか欠損ならセール日扱いしない
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      continue;
    }
    if (targetDate >= start && targetDate <= end) return true;
  }

  // 補助: policy（sync が auto mirror する）
  if ((config.sale.calendarDates || []).includes(targetDate)) return true;
  if (dateInRanges(targetDate, config.sale.calendarRanges)) return true;

  return false;
}

function flattenProducts(products) {
  return {
    sale: products.sale || [],
    main: products.main || [],
    niche: products.niche || [],
    routine: products.routine || [],
  };
}

function filterSelectable(items, postedSet, todayIds, opts = {}) {
  const {
    isProductionEligibleProduct,
    isRecentDuplicateProduct,
    recent,
  } = opts;
  return (items || []).filter((item) => {
    if (!item?.id) return false;
    if (postedSet.has(item.id) || todayIds.has(item.id)) return false;
    if (typeof isProductionEligibleProduct === "function") {
      if (!isProductionEligibleProduct(item)) return false;
    }
    if (typeof isRecentDuplicateProduct === "function" && recent) {
      const dup = isRecentDuplicateProduct(item, recent);
      if (dup.duplicate) return false;
    }
    return true;
  });
}

function countUnpostedByBucket(products, postedSet, todayIds, filterOpts = {}) {
  const groups = flattenProducts(products);
  const out = {};
  for (const b of BUCKETS) {
    out[b] = filterSelectable(groups[b] || [], postedSet, todayIds, filterOpts).length;
  }
  return out;
}

function buildDayPlan(opts) {
  const {
    targetDate,
    products,
    config,
    forceSaleDay,
    forceNicheDue,
    forceRoutineDue,
  } = opts;

  const saleDay = isSaleDay(targetDate, products, config, forceSaleDay);
  const nicheDue =
    forceNicheDue === true
      ? true
      : forceNicheDue === false
        ? false
        : isCycleDue(targetDate, config.niche.anchorDate, config.niche.intervalDays);
  const routineDue =
    forceRoutineDue === true
      ? true
      : forceRoutineDue === false
        ? false
        : isCycleDue(
            targetDate,
            config.routine.anchorDate,
            config.routine.intervalDays
          );

  const dueSet = new Set();
  if (saleDay) dueSet.add("sale");
  if (nicheDue) dueSet.add("niche");
  if (routineDue) dueSet.add("routine");
  if (dueSet.size === 0) dueSet.add("main");

  const dueOrdered = config.priorityOrder.filter((b) => dueSet.has(b));
  const tryOrder = [
    ...dueOrdered,
    ...config.priorityOrder.filter((b) => !dueOrdered.includes(b)),
  ];

  return {
    targetDate,
    saleDay,
    nicheDue,
    routineDue,
    dueBuckets: dueOrdered,
    primaryBucket: dueOrdered[0] || "main",
    priorityOrder: config.priorityOrder.slice(),
    tryOrder,
  };
}

function chooseByStrategy(products, posted, opts = {}) {
  const config = opts.config || loadSelectConfig(opts.configPath);
  const targetDate = opts.targetDate || tokyoDayKey();
  const todayIds = opts.todayIds instanceof Set ? opts.todayIds : new Set();
  const postedList = Array.isArray(posted) ? posted : [];
  const postedSet = new Set(postedList);
  const groups = flattenProducts(products);
  const all = BUCKETS.flatMap((b) => groups[b] || []);

  const plan = buildDayPlan({
    targetDate,
    products,
    config,
    forceSaleDay: opts.forceSaleDay,
    forceNicheDue: opts.forceNicheDue,
    forceRoutineDue: opts.forceRoutineDue,
  });

  const filterOpts = {
    isProductionEligibleProduct: opts.isProductionEligibleProduct,
    isRecentDuplicateProduct: opts.isRecentDuplicateProduct,
    recent: opts.recent,
  };
  // 本番日次はテスト商品・直近重複を在庫から除外
  const useProdFilter = opts.productionFilter !== false;

  const unpostedCountByBucket = countUnpostedByBucket(
    products,
    postedSet,
    todayIds,
    useProdFilter ? filterOpts : {},
  );
  const totalUnposted = Object.values(unpostedCountByBucket).reduce((a, b) => a + b, 0);

  const profitCtx =
    opts.profitContext ||
    buildProfitContext({
      catalogById: catalogMapFromProducts(products),
      policyPath: opts.profitPolicyPath,
      historyPath: opts.historyPath,
    });

  const baseMeta = {
    ...plan,
    unpostedCountByBucket,
    unpostedCount: totalUnposted,
    catalogCount: all.length,
    recycleUsed: false,
    selectedBucket: null,
    fallbackUsed: false,
    selectedSource: null,
    reason: null,
    item: null,
    remainingUnposted: totalUnposted,
    profitScore: null,
    profitBreakdown: null,
    recentCooldown: opts.recent
      ? {
          coolDownDays: opts.recent.coolDownDays,
          recentIds: [...opts.recent.ids],
          recentUrlCount: opts.recent.urlKeys.size,
        }
      : null,
  };

  if (all.length === 0) {
    return { ...baseMeta, reason: "catalog_empty" };
  }
  if (totalUnposted === 0) {
    const unpostedIgnoringToday = useProdFilter
      ? filterSelectable(all, postedSet, new Set(), filterOpts)
      : all.filter((p) => !postedSet.has(p.id));
    if (unpostedIgnoringToday.length > 0) {
      return {
        ...baseMeta,
        reason: "same_day_already_posted",
        unpostedCount: unpostedIgnoringToday.length,
      };
    }
    return { ...baseMeta, reason: "unposted_empty" };
  }

  for (let i = 0; i < plan.tryOrder.length; i += 1) {
    const bucket = plan.tryOrder[i];
    const candidates = useProdFilter
      ? filterSelectable(groups[bucket] || [], postedSet, todayIds, filterOpts)
      : (groups[bucket] || []).filter(
          (item) => item?.id && !postedSet.has(item.id) && !todayIds.has(item.id),
        );
    if (!candidates.length) continue;

    const picked = pickBestByProfit(candidates, profitCtx, {
      targetDate,
      bucket,
      mode: "unposted",
    });
    const item = picked.item || candidates[0];
    const fallbackUsed = bucket !== plan.primaryBucket;
    return {
      ...baseMeta,
      item,
      selectedSource: "unposted",
      selectedBucket: bucket,
      fallbackUsed,
      reason: fallbackUsed ? "strategy_fallback" : "strategy_primary",
      remainingUnposted: totalUnposted - 1,
      unpostedCount: totalUnposted,
      profitScore: picked.score,
      profitBreakdown: picked.breakdown,
    };
  }

  return { ...baseMeta, reason: "same_day_already_posted" };
}

function formatStrategyLog(meta) {
  const lines = [
    `[select:strategy] targetDate=${meta.targetDate}`,
    `[select:strategy] saleDay=${meta.saleDay} nicheDue=${meta.nicheDue} routineDue=${meta.routineDue}`,
    `[select:strategy] priorityOrder=${(meta.priorityOrder || []).join(">")}`,
    `[select:strategy] tryOrder=${(meta.tryOrder || []).join(">")}`,
    `[select:strategy] primaryBucket=${meta.primaryBucket}`,
    `[select:strategy] selectedBucket=${meta.selectedBucket || "(none)"}`,
    `[select:strategy] selectedId=${meta.item?.id || "(none)"}`,
    `[select:strategy] fallbackUsed=${meta.fallbackUsed === true}`,
    `[select:strategy] recycleUsed=${meta.recycleUsed === true}`,
    `[select:strategy] unpostedCountByBucket=${JSON.stringify(meta.unpostedCountByBucket || {})}`,
  ];
  if (meta.profitScore != null) {
    lines.push(`[select:strategy] profitScore=${meta.profitScore}`);
  }
  return lines.join("\n");
}

/** 翌朝9時向けに「明日」の予定をログする */
function previewTomorrowPlan(products, opts = {}) {
  const config = opts.config || loadSelectConfig(opts.configPath);
  const today = parseDay(tokyoDayKey());
  if (!today) return null;
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  const targetDate = `${y}-${m}-${d}`;
  return buildDayPlan({
    targetDate,
    products,
    config,
    forceSaleDay: undefined,
    forceNicheDue: undefined,
    forceRoutineDue: undefined,
  });
}

module.exports = {
  BUCKETS,
  DEFAULT_CONFIG_PATH,
  loadSelectConfig,
  tokyoDayKey,
  parseDay,
  daysBetween,
  isCycleDue,
  isSaleDay,
  buildDayPlan,
  chooseByStrategy,
  formatStrategyLog,
  countUnpostedByBucket,
  filterSelectable,
  flattenProducts,
  previewTomorrowPlan,
};
