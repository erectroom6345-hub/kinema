/**
 * Yahooショッピング由来の sale 軽量確認。
 *
 * 方針:
 * - 毎日は確認しない
 * - トリガー日のみ: 5日 / 15日 / 25日 / 月末
 * - 日付固定だけでは sale にしない（対象ページの有効性確認が必須）
 * - ページ不在・条件不一致 → 非セール（yahooSaleDetected=false）
 */
const fs = require("fs");
const path = require("path");
const { tokyoDayKey, normalizeDay } = require("./beauty-sale-windows.cjs");

const DEFAULT_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "..",
  "policy",
  "beauty-yahoo-sale.json"
);
const DEFAULT_PRODUCTS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "input",
  "products-beauty.json"
);

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseDayParts(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function lastDayOfMonth(dayKey) {
  const p = parseDayParts(dayKey);
  if (!p) return 31;
  // UTC noon で翌月0日 = 当月末
  const dt = new Date(Date.UTC(p.y, p.m, 0, 12, 0, 0));
  return dt.getUTCDate();
}

/**
 * @returns {{ triggered: boolean, reason: string, kind: 'fiveDay'|'monthEnd'|null }}
 */
function isYahooCheckTriggerDay(dayKey = tokyoDayKey(), config = {}) {
  const p = parseDayParts(dayKey);
  if (!p) {
    return { triggered: false, reason: "invalid-date", kind: null };
  }
  const days = Array.isArray(config.triggerDaysOfMonth)
    ? config.triggerDaysOfMonth.map(Number)
    : [5, 15, 25];
  const includeMonthEnd = config.includeMonthEnd !== false;
  const eom = lastDayOfMonth(dayKey);

  if (days.includes(p.d)) {
    return { triggered: true, reason: `day-of-month=${p.d}`, kind: "fiveDay" };
  }
  if (includeMonthEnd && p.d === eom) {
    // 5/15/25 と月末が同一日（例: 2/25 が月末でない、5/31）のとき fiveDay 優先済み
    return { triggered: true, reason: `month-end=${eom}`, kind: "monthEnd" };
  }
  return {
    triggered: false,
    reason: `not-trigger(day=${p.d}, eom=${eom})`,
    kind: null,
  };
}

function todayMentionPatterns(dayKey) {
  const p = parseDayParts(dayKey);
  if (!p) return [];
  const y = p.y;
  const m = p.m;
  const d = p.d;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return [
    `${y}年${m}月${d}日`,
    `${y}年${mm}月${dd}日`,
    `${y}/${m}/${d}`,
    `${y}/${mm}/${dd}`,
    `${y}-${mm}-${dd}`,
    `${m}月${d}日`,
    `${mm}/${dd}`,
    `${m}/${d}`,
  ];
}

function loadYahooConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readJson(configPath, {});
  return {
    triggerDaysOfMonth: Array.isArray(raw.triggerDaysOfMonth)
      ? raw.triggerDaysOfMonth
      : [5, 15, 25],
    includeMonthEnd: raw.includeMonthEnd !== false,
    timeoutMs: Number(raw.timeoutMs || process.env.BEAUTY_SALE_YAHOO_TIMEOUT_MS || 12000),
    pages: raw.pages && typeof raw.pages === "object" ? raw.pages : {},
  };
}

async function defaultFetch(url, init) {
  if (typeof fetch !== "function") {
    throw new Error("fetch が使えません（Node 18+ が必要）");
  }
  return fetch(url, init);
}

async function fetchPage(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const timeoutMs = Number(opts.timeoutMs || 12000);
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent":
        process.env.BEAUTY_SALE_YAHOO_USER_AGENT ||
        "Mozilla/5.0 (compatible; content-studio-sale-yahoo/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (typeof res.text === "function") {
    const html = await res.text();
    return {
      ok: !!res.ok,
      status: res.status,
      url: res.url || url,
      html,
    };
  }
  return {
    ok: !!res.ok,
    status: res.status ?? (res.ok ? 200 : 0),
    url: res.url || url,
    html: String(res.html || ""),
  };
}

/**
 * 1ページの軽量有効性チェック。
 * @returns {{ ok: boolean, reason: string }}
 */
function evaluateYahooPage(html, pageCfg, dayKey) {
  const text = String(html || "");
  if (!text.trim()) {
    return { ok: false, reason: "empty-body" };
  }

  const requireKeywords = Array.isArray(pageCfg.requireKeywords)
    ? pageCfg.requireKeywords
    : [];
  for (const kw of requireKeywords) {
    if (!text.includes(kw)) {
      return { ok: false, reason: `missing-keyword:${kw}` };
    }
  }

  const rejectKeywords = Array.isArray(pageCfg.rejectKeywords)
    ? pageCfg.rejectKeywords
    : [];
  // reject は「本日言及が無いときだけ」効かせる（期間外バナーが残るページ向け）
  const requireToday = pageCfg.requireTodayMention !== false;
  const mentions = todayMentionPatterns(dayKey);
  const todayMentioned = mentions.some((m) => text.includes(m));

  if (requireToday && !todayMentioned) {
    return { ok: false, reason: "today-not-mentioned" };
  }

  if (!todayMentioned) {
    for (const kw of rejectKeywords) {
      if (kw && text.includes(kw)) {
        return { ok: false, reason: `reject-keyword:${kw}` };
      }
    }
  }

  return {
    ok: true,
    reason: todayMentioned ? "today-mentioned" : "keywords-ok",
  };
}

function buildYahooItemsForSaleProducts(dayKey, meta, productsPath = DEFAULT_PRODUCTS_PATH) {
  const products = readJson(productsPath, {});
  const sale = Array.isArray(products.sale) ? products.sale : [];
  const day = normalizeDay(dayKey);
  const items = {};
  if (!day) return items;
  for (const product of sale) {
    const id = product?.id;
    if (!id) continue;
    items[id] = {
      saleStart: day,
      saleEnd: day,
      source: `yahoo:${meta.pageId || "check"}`,
      pageUrl: meta.pageUrl || "",
      raw: meta.raw || `yahoo-check:${meta.reason || "ok"}`,
      brand: product.brand || "",
      productName: product.productName || "",
      yahooTrigger: meta.triggerReason || "",
    };
  }
  return items;
}

/**
 * Yahoo provider 本体。
 */
async function fetchYahooSaleWindows(opts = {}) {
  const today = normalizeDay(opts.today) || tokyoDayKey();
  const config = opts.config || loadYahooConfig(opts.configPath);
  const trigger = isYahooCheckTriggerDay(today, config);

  const base = {
    ok: false,
    items: {},
    note: "",
    diagnostics: [],
    yahooCheckSkipped: !trigger.triggered,
    yahooCheckTriggered: trigger.triggered,
    yahooSaleDetected: false,
    triggerReason: trigger.reason,
    triggerKind: trigger.kind,
    day: today,
  };

  if (!trigger.triggered) {
    return {
      ...base,
      ok: true,
      note: `yahoo: スキップ（トリガー日以外: ${trigger.reason}）`,
    };
  }

  const pageList =
    (trigger.kind === "monthEnd"
      ? config.pages.monthEnd
      : config.pages.fiveDay) || [];

  if (!pageList.length) {
    return {
      ...base,
      note: `yahoo: トリガー日だが確認ページ未設定 kind=${trigger.kind}`,
      diagnostics: [{ error: "no-pages-configured", kind: trigger.kind }],
    };
  }

  const pageLogs = [];
  let detected = null;

  for (const pageCfg of pageList) {
    const url = String(pageCfg.url || "").trim();
    if (!url) continue;
    try {
      const page = await fetchPage(url, {
        fetchImpl: opts.fetchImpl,
        timeoutMs: config.timeoutMs,
      });
      const evalResult =
        page.ok && page.html
          ? evaluateYahooPage(page.html, pageCfg, today)
          : { ok: false, reason: `http-${page.status || 0}` };
      pageLogs.push({
        id: pageCfg.id || url,
        url,
        final: page.url,
        status: page.status,
        ok: page.ok,
        evalOk: evalResult.ok,
        reason: evalResult.reason,
      });
      if (evalResult.ok && !detected) {
        detected = {
          pageId: pageCfg.id || "page",
          pageUrl: page.url || url,
          reason: evalResult.reason,
          triggerReason: trigger.reason,
        };
      }
    } catch (err) {
      pageLogs.push({
        id: pageCfg.id || url,
        url,
        ok: false,
        evalOk: false,
        hostOk: false,
        reason: "fetch-error",
        error: err?.message || String(err),
      });
    }
  }

  base.diagnostics = [{ kind: trigger.kind, pages: pageLogs }];

  if (!detected) {
    return {
      ...base,
      ok: false,
      yahooSaleDetected: false,
      note: `yahoo: トリガー日だが有効セールを確認できず → 非セール kind=${trigger.kind}`,
    };
  }

  const items = buildYahooItemsForSaleProducts(today, detected, opts.productsPath);
  return {
    ...base,
    ok: Object.keys(items).length > 0,
    items,
    yahooSaleDetected: Object.keys(items).length > 0,
    note: `yahoo: セール有効を確認 ${detected.pageId} (${detected.reason}) → ${Object.keys(items).length}件`,
  };
}

function stripYahooSourcedItems(items) {
  const out = {};
  for (const [id, w] of Object.entries(items || {})) {
    if (String(w?.source || "").startsWith("yahoo")) continue;
    out[id] = w;
  }
  return out;
}

function mergeOfficialAndYahoo(officialItems, yahooResult) {
  // 公式期間を土台に、Yahoo由来の stale は除去。検出時のみ当日窓を足す。
  let merged = stripYahooSourcedItems(officialItems);
  if (yahooResult?.yahooSaleDetected && yahooResult.items) {
    for (const [id, w] of Object.entries(yahooResult.items)) {
      const existing = merged[id];
      if (
        existing &&
        normalizeDay(existing.saleStart) &&
        normalizeDay(existing.saleEnd)
      ) {
        // 公式に有効期間があるなら公式を優先（Yahoo は検出ログのみ）
        continue;
      }
      merged[id] = w;
    }
  }
  return merged;
}

module.exports = {
  isYahooCheckTriggerDay,
  todayMentionPatterns,
  evaluateYahooPage,
  loadYahooConfig,
  fetchYahooSaleWindows,
  stripYahooSourcedItems,
  mergeOfficialAndYahoo,
  lastDayOfMonth,
};
