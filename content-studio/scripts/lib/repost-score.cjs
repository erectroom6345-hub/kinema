/**
 * 再投稿候補のスコア・適否判定。
 * 将来 clicks / insights を足すときは scoreBreakdown に項目を追加する。
 */
const DEFAULTS = {
  minDaysSincePost: 7,
  recentWindow: 3,
  weight: {
    daysSince: 1,
    success: 10,
    fail: -5,
    partial: -2,
    hasSuccessBonus: 20,
    failHeavyPenalty: -15,
    clicks: 3,
    impressions: 0.01,
  },
};

function daysBetween(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 86_400_000;
}

function sumMetrics(rows, key) {
  let n = 0;
  for (const row of rows) {
    const v = row?.metrics?.[key];
    if (typeof v === "number" && Number.isFinite(v)) n += v;
  }
  return n;
}

/**
 * @param {object[]} rows post-history.jsonl のレコード（新しい順でなくてよい）
 */
function aggregateByProduct(rows) {
  /** @type {Map<string, any>} */
  const map = new Map();
  const sorted = [...rows].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));

  for (const row of sorted) {
    const id = (row.productId || "").trim();
    if (!id || id === "(unknown)") continue;
    let agg = map.get(id);
    if (!agg) {
      agg = {
        productId: id,
        successCount: 0,
        failCount: 0,
        partialCount: 0,
        otherCount: 0,
        lastPostedAt: null,
        lastStatus: null,
        blockCount: 0,
        warnCount: 0,
        clicks: 0,
        impressions: 0,
        rows: [],
      };
      map.set(id, agg);
    }
    agg.rows.push(row);
    const st = String(row.status || "other");
    if (st === "success") agg.successCount += 1;
    else if (st === "failed") agg.failCount += 1;
    else if (st === "partial") agg.partialCount += 1;
    else agg.otherCount += 1;

    const policy = row.policyCheck;
    if (policy && policy.result === "block") agg.blockCount += 1;
    if (policy && policy.result === "warn") agg.warnCount += 1;

    agg.lastPostedAt = row.at || agg.lastPostedAt;
    agg.lastStatus = row.status || agg.lastStatus;
  }

  for (const agg of map.values()) {
    agg.clicks = sumMetrics(agg.rows, "clicks");
    agg.impressions = sumMetrics(agg.rows, "impressions");
  }
  return map;
}

/** 直近 N 件の productId（新しい順） */
function recentProductIds(rows, window = DEFAULTS.recentWindow) {
  const sorted = [...rows]
    .filter((r) => (r.productId || "").trim())
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return sorted.slice(0, window).map((r) => String(r.productId).trim());
}

function buildScore(agg, opts = {}) {
  const w = { ...DEFAULTS.weight, ...(opts.weight || {}) };
  const now = opts.now || Date.now();
  const daysSince = daysBetween(agg.lastPostedAt, now);
  const days = daysSince == null ? 999 : daysSince;

  const breakdown = {
    daysSince: days * w.daysSince,
    success: agg.successCount * w.success,
    fail: agg.failCount * w.fail,
    partial: agg.partialCount * w.partial,
    hasSuccessBonus: agg.successCount >= 1 ? w.hasSuccessBonus : 0,
    failHeavyPenalty:
      agg.failCount > agg.successCount ? w.failHeavyPenalty : 0,
    clicks: (agg.clicks || 0) * w.clicks,
    impressions: (agg.impressions || 0) * w.impressions,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    score: Math.round(score * 100) / 100,
    breakdown,
    daysSince: daysSince == null ? null : Math.round(daysSince * 10) / 10,
  };
}

/**
 * @returns {{ candidates: object[], excluded: object[], selected: object|null, meta: object }}
 */
function evaluateRepostCandidates(rows, opts = {}) {
  const minDays = opts.minDaysSincePost ?? DEFAULTS.minDaysSincePost;
  const recentWindow = opts.recentWindow ?? DEFAULTS.recentWindow;
  const now = opts.now || Date.now();
  const catalogIds = new Set(opts.catalogIds || []);

  const byProduct = aggregateByProduct(rows);
  const recent = recentProductIds(rows, recentWindow);
  const recentSet = new Set(recent);

  const evaluated = [];
  for (const agg of byProduct.values()) {
    if (catalogIds.size > 0 && !catalogIds.has(agg.productId)) {
      // カタログ外は候補外（削除済み商品など）
      continue;
    }
    const { score, breakdown, daysSince } = buildScore(agg, { now, weight: opts.weight });
    const reasons = [];
    let eligible = true;

    if (agg.blockCount > 0) {
      eligible = false;
      reasons.push(`policy_block(${agg.blockCount})`);
    }
    if (agg.successCount < 1) {
      eligible = false;
      reasons.push("no_success_history");
    }
    if (daysSince != null && daysSince < minDays) {
      eligible = false;
      reasons.push(`posted_within_${minDays}d(${daysSince}d)`);
    }
    if (recentSet.has(agg.productId)) {
      eligible = false;
      reasons.push(`in_recent_${recentWindow}`);
    }
    if (agg.failCount > agg.successCount && agg.successCount >= 1) {
      // 除外はしないが理由に残す（スコアは既に下げている）
      reasons.push("fail_heavy_lower_priority");
    }
    if (eligible) {
      reasons.push("eligible");
      if (daysSince != null) reasons.push(`oldest_bias(${daysSince}d)`);
      if (agg.successCount >= 1) reasons.push(`success_x${agg.successCount}`);
    }

    evaluated.push({
      productId: agg.productId,
      lastPostedAt: agg.lastPostedAt,
      successCount: agg.successCount,
      failCount: agg.failCount,
      partialCount: agg.partialCount,
      lastStatus: agg.lastStatus,
      blockCount: agg.blockCount,
      daysSince,
      eligible,
      reasons,
      score,
      scoreBreakdown: breakdown,
      metrics: {
        clicks: agg.clicks || 0,
        impressions: agg.impressions || 0,
      },
    });
  }

  const candidates = evaluated
    .filter((c) => c.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.lastPostedAt || "").localeCompare(String(b.lastPostedAt || ""));
    });
  const excluded = evaluated
    .filter((c) => !c.eligible)
    .sort((a, b) => b.score - a.score);

  return {
    candidates,
    excluded,
    selected: candidates[0] || null,
    meta: {
      evaluatedAt: new Date(now).toISOString(),
      minDaysSincePost: minDays,
      recentWindow,
      recentProductIds: recent,
      totalProducts: evaluated.length,
      historyRows: rows.length,
    },
  };
}

module.exports = {
  DEFAULTS,
  daysBetween,
  aggregateByProduct,
  recentProductIds,
  buildScore,
  evaluateRepostCandidates,
};
