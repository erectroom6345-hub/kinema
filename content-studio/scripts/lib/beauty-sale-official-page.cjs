/**
 * 公式ページからセール期間を取得する provider。
 *
 * 方針:
 * - モール(Yahoo等)は使わない
 * - ブランド公式トップ / listing seed / event・campaign リンクを巡回
 * - 日本語の期間表記を抽出（本文優先、HTMLコメントはフォールバック）
 * - ブランド単位の有効ウィンドウを、sale バケット商品へ割り当て
 */
const fs = require("fs");
const path = require("path");
const {
  brandListingSeeds,
  brandDomainHints,
  isVcLinkSwitchProductUrl,
} = require("./vc-linkswitch-url.cjs");
const { tokyoDayKey, normalizeDay } = require("./beauty-sale-windows.cjs");

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

function pad(n) {
  return String(n).padStart(2, "0");
}

function ymd(y, m, d) {
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseDayParts(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function addDays(dayKey, delta) {
  const p = parseDayParts(dayKey);
  if (!p) return "";
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function decodeEntities(html) {
  return String(html || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function splitLiveAndComments(html) {
  const decoded = decodeEntities(html);
  const comments = [];
  const live = decoded.replace(/<!--([\s\S]*?)-->/g, (_, c) => {
    comments.push(c);
    return " ";
  });
  return { live, comments: comments.join("\n") };
}

/**
 * @returns {Array<{saleStart:string,saleEnd:string,raw:string,source:string,score:number}>}
 */
function extractWindowsFromText(text, opts = {}) {
  const today = opts.today || tokyoDayKey();
  const year = parseDayParts(today)?.y || new Date().getFullYear();
  const untilLookbackDays = Number(opts.untilLookbackDays) > 0 ? Number(opts.untilLookbackDays) : 45;
  const sourceTag = opts.sourceTag || "body";
  const out = [];

  const pushRange = (start, end, raw, bonus = 0) => {
    // 開始・終了どちらか欠損なら採用しない（終了だけ/開始だけの推測はしない）
    const s = normalizeDay(start);
    const e = normalizeDay(end);
    if (!s || !e) return;
    if (e < s) return;
    // 終了から1年超過去は無視
    if (e < addDays(today, -366)) return;
    let score = 10 + bonus;
    if (s <= today && today <= e) score += 50; // 今日を含む
    else if (today < s && s <= addDays(today, 60)) score += 20; // 近い将来
    else if (e < today) score -= 30; // 終了済み
    // 極端に長い期間（>120日）はコメント残骸の誤結合が多いので減点
    const span = Math.round(
      (parseDayParts(e).y - parseDayParts(s).y) * 365 +
        (parseDayParts(e).m - parseDayParts(s).m) * 30 +
        (parseDayParts(e).d - parseDayParts(s).d)
    );
    if (span > 120) score -= 25;
    if (span > 400) score -= 40;
    out.push({
      saleStart: s,
      saleEnd: e,
      raw: String(raw || "").replace(/\s+/g, " ").slice(0, 80),
      source: sourceTag,
      score,
    });
  };

  const inferYear = (month, day, mode = "plain") => {
    // plain: 今年固定（レンジ開始用）
    // until: 終了日。60日以上過去なら来年（「〜まで」の継続案件）
    let candidate = ymd(year, month, day);
    if (!candidate) return "";
    if (mode === "until" && candidate < addDays(today, -60)) {
      const next = ymd(year + 1, month, day);
      if (next) return next;
    }
    if (candidate > addDays(today, 400)) {
      const prev = ymd(year - 1, month, day);
      if (prev) return prev;
    }
    return candidate;
  };

  /** 月日レンジを同年で組み立て。終了月日が開始より前なら終了を翌年へ */
  const inferMonthDayRange = (m1, d1, m2, d2) => {
    const start = ymd(year, m1, d1);
    let end = ymd(year, m2, d2);
    if (!start || !end) return { start: "", end: "" };
    if (end < start) end = ymd(year + 1, m2, d2);
    // 両方とも1年以上過去なら翌年セットを試す
    if (end < addDays(today, -366)) {
      const s2 = ymd(year + 1, m1, d1);
      let e2 = ymd(year + 1, m2, d2);
      if (s2 && e2 && e2 < s2) e2 = ymd(year + 2, m2, d2);
      if (s2 && e2) return { start: s2, end: e2 };
    }
    return { start, end };
  };

  // 2026/10/1～2026/10/7 or 2026年10月1日～2026年10月7日
  for (const m of text.matchAll(
    /(\d{4})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*日?\s*[～〜~\-－]+\s*(?:(\d{4})\s*[\/\-年]\s*)?(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*日?/g
  )) {
    const y1 = +m[1];
    const y2 = m[4] ? +m[4] : y1;
    pushRange(ymd(y1, +m[2], +m[3]), ymd(y2, +m[5], +m[6]), m[0], 8);
  }

  // 【12/1～12/25】
  for (const m of text.matchAll(
    /【\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[～〜~\-－]+\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*】/g
  )) {
    const { start, end } = inferMonthDayRange(+m[1], +m[2], +m[3], +m[4]);
    pushRange(start, end, m[0], 6);
  }

  // 12/1～12/25（括弧なし）
  for (const m of text.matchAll(
    /(?<![0-9\/])(\d{1,2})\s*\/\s*(\d{1,2})\s*[～〜~\-－]+\s*(\d{1,2})\s*\/\s*(\d{1,2})(?![0-9\/])/g
  )) {
    const { start, end } = inferMonthDayRange(+m[1], +m[2], +m[3], +m[4]);
    pushRange(start, end, m[0], 3);
  }

  // 2月28日〜3月8日
  for (const m of text.matchAll(
    /(\d{1,2})月(\d{1,2})日\s*[～〜~\-－]+\s*(\d{1,2})月(\d{1,2})日/g
  )) {
    const { start, end } = inferMonthDayRange(+m[1], +m[2], +m[3], +m[4]);
    pushRange(start, end, m[0], 5);
  }

  // 【11/13まで】（前置に数字を許すと 11/13 → 月=1 日=13 になる）
  for (const m of text.matchAll(
    /【\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*まで[^】]{0,16}】/g
  )) {
    const end = inferYear(+m[1], +m[2], "until");
    if (!end) continue;
    const start = addDays(end, -untilLookbackDays);
    pushRange(start, end, m[0], 4);
  }
  // 【3月31日(月)まで】 / 9月23日まで
  // レンジ接続子（〜等）を挟む「2月28日〜3月8日まで」は until 単独とみなさない
  for (const m of text.matchAll(
    /(\d{4})?年?\s*(\d{1,2})月(\d{1,2})日(?:\([^)]{0,10}\))?(?:[^\n。～〜~\-－]{0,6})まで/g
  )) {
    const y = m[1] ? +m[1] : null;
    const end = y ? ymd(y, +m[2], +m[3]) : inferYear(+m[2], +m[3], "until");
    if (!end) continue;
    const start = addDays(end, -untilLookbackDays);
    pushRange(start, end, m[0], 4);
  }

  // JSON-LD-ish
  for (const m of text.matchAll(
    /"validFrom"\s*:\s*"([^"]+)"[\s\S]{0,120}?"validThrough"\s*:\s*"([^"]+)"/gi
  )) {
    pushRange(m[1].slice(0, 10), m[2].slice(0, 10), "validFrom/Through", 12);
  }

  return out;
}

function extractWindowsFromHtml(html, opts = {}) {
  const { live, comments } = splitLiveAndComments(html);
  const fromLive = extractWindowsFromText(live, {
    ...opts,
    sourceTag: "official-body",
  });
  const includeComments = opts.includeHtmlComments !== false;
  const fromComments = includeComments
    ? extractWindowsFromText(comments, {
        ...opts,
        sourceTag: "official-html-comment",
      }).map((w) => ({ ...w, score: w.score - 8 }))
    : [];
  return [...fromLive, ...fromComments];
}

async function defaultFetch(url, init) {
  if (typeof fetch !== "function") {
    throw new Error("fetch が使えません（Node 18+ が必要）");
  }
  return fetch(url, init);
}

async function fetchHtml(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const timeoutMs = Number(opts.timeoutMs || process.env.BEAUTY_SALE_FETCH_TIMEOUT_MS || 15000);
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent":
        process.env.BEAUTY_SALE_USER_AGENT ||
        "Mozilla/5.0 (compatible; content-studio-sale-official/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Response 互換、またはテスト用 plain object { ok, status, url, html }
  if (typeof res.text === "function") {
    const html = await res.text();
    return { ok: !!res.ok, status: res.status, url: res.url || url, html };
  }
  return {
    ok: !!res.ok,
    status: res.status ?? (res.ok ? 200 : 0),
    url: res.url || url,
    html: String(res.html || ""),
  };
}

function absolutize(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function discoverCampaignUrls(html, baseUrl, brandHints = []) {
  const out = [];
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const abs = absolutize(m[1], baseUrl);
    if (!abs) continue;
    let host = "";
    try {
      host = new URL(abs).hostname.toLowerCase();
    } catch {
      continue;
    }
    const allowed =
      !brandHints.length ||
      brandHints.some((d) => host === d || host.endsWith(`.${d}`));
    if (!allowed) continue;
    if (/\/(event|campaign|sale|topic|news|promotion|特集|キャンペーン)/i.test(abs)) {
      out.push(abs);
    }
  }
  return [...new Set(out)];
}

function pickBestWindow(windows, today) {
  if (!windows.length) return null;
  const ranked = [...windows].sort((a, b) => b.score - a.score);
  // まず今日を含むもの
  const active = ranked.find((w) => w.saleStart <= today && today <= w.saleEnd);
  if (active) return active;
  // 次に未来の最短開始
  const future = ranked
    .filter((w) => w.saleStart > today)
    .sort((a, b) => a.saleStart.localeCompare(b.saleStart));
  if (future[0]) return future[0];
  // 直近終了（参考保存）はスコアが高ければ残す
  return ranked[0];
}

function resolveSeedUrlsForBrand(brand, productsForBrand, opts = {}) {
  const seeds = [];
  const hints = brandDomainHints(brand);

  for (const item of productsForBrand) {
    const url = String(item.productUrl || item.affiliateUrl || "").trim();
    if (!url) continue;
    const verdict = isVcLinkSwitchProductUrl(url, { brand });
    if (verdict.ok) seeds.push(url);
  }

  for (const u of brandListingSeeds(brand) || []) seeds.push(u);

  // ブランド公式トップを補完
  for (const d of hints) {
    seeds.push(`https://www.${d}/`);
    seeds.push(`https://${d}/`);
  }

  // 追加シード（設定）
  for (const u of opts.extraSeeds || []) seeds.push(u);

  return [...new Set(seeds.filter(Boolean))];
}

/**
 * sale バケットをブランドごとに公式ページ巡回して期間を決める。
 */
async function fetchOfficialPageSaleWindows(opts = {}) {
  const productsPath = opts.productsPath || DEFAULT_PRODUCTS_PATH;
  const products = readJson(productsPath, {});
  const saleItemsRaw = Array.isArray(products.sale) ? products.sale : [];
  // テスト専用商品は公式ページ期間の供給対象外（同一ブランドの実商品URLへ誤紐づけしない）
  const saleItems = saleItemsRaw.filter(
    (item) =>
      item &&
      item.testOnly !== true &&
      item.productionEligible !== false &&
      !/テスト|blogUrlテスト|誘導テスト/i.test(
        `${item.productName || ""} ${item.articleTitle || ""}`,
      ),
  );
  const today = opts.today || tokyoDayKey();
  const maxPagesPerBrand = Number(opts.maxPagesPerBrand || 6);
  const includeHtmlComments = opts.includeHtmlComments !== false;
  const untilLookbackDays = Number(opts.untilLookbackDays || 45);

  if (!saleItems.length) {
    return {
      ok: true,
      items: {},
      note: "official-page: 本番向け sale 商品が空（testOnly 除外後）",
      diagnostics: [],
    };
  }

  const byBrand = new Map();
  for (const item of saleItems) {
    const brand = String(item.brand || "").trim() || "(unknown)";
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(item);
  }

  const items = {};
  const diagnostics = [];

  for (const [brand, brandProducts] of byBrand.entries()) {
    const hints = brandDomainHints(brand);
    const seeds = resolveSeedUrlsForBrand(brand, brandProducts, {
      extraSeeds: opts.extraSeeds,
    });
    const queue = [...seeds];
    const seen = new Set();
    const foundWindows = [];
    let pagesFetched = 0;
    const pageLogs = [];

    while (queue.length && pagesFetched < maxPagesPerBrand) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pagesFetched += 1;
      try {
        const page = await fetchHtml(url, opts);
        let finalHost = "";
        try {
          finalHost = new URL(page.url).hostname.toLowerCase();
        } catch {
          finalHost = "";
        }
        const hostOk =
          !hints.length ||
          hints.some(
            (d) =>
              finalHost === d ||
              finalHost.endsWith(`.${d}`)
          );
        // annhince.com が hince.com を含むような部分一致は許可しない
        pageLogs.push({
          url,
          status: page.status,
          ok: page.ok,
          final: page.url,
          hostOk,
        });
        if (!page.ok || !page.html) continue;
        // リダイレクト先がブランド外（例: hince.com → 別サイト）ならスキップ
        if (!hostOk) continue;

        const wins = extractWindowsFromHtml(page.html, {
          today,
          includeHtmlComments,
          untilLookbackDays,
        });
        for (const w of wins) {
          foundWindows.push({
            ...w,
            pageUrl: page.url,
          });
        }

        // キャンペーンURLを追加発見
        for (const next of discoverCampaignUrls(page.html, page.url, hints)) {
          if (!seen.has(next)) queue.push(next);
        }
      } catch (err) {
        pageLogs.push({
          url,
          ok: false,
          hostOk: false,
          error: err?.message || String(err),
        });
      }
    }

    const best = pickBestWindow(foundWindows, today);
    diagnostics.push({
      brand,
      productIds: brandProducts.map((p) => p.id),
      pagesFetched,
      windowsFound: foundWindows.length,
      best: best
        ? {
            saleStart: best.saleStart,
            saleEnd: best.saleEnd,
            raw: best.raw,
            source: best.source,
            pageUrl: best.pageUrl,
            score: best.score,
          }
        : null,
      pages: pageLogs,
    });

    if (!best) continue;

    for (const product of brandProducts) {
      items[product.id] = {
        saleStart: best.saleStart,
        saleEnd: best.saleEnd,
        source: `official-page:${best.source}`,
        pageUrl: best.pageUrl || "",
        raw: best.raw || "",
        brand,
        productName: product.productName || "",
      };
    }
  }

  const count = Object.keys(items).length;
  return {
    ok: count > 0,
    items,
    note:
      count > 0
        ? `official-page: ${count} 件の sale 商品に公式ページ由来の期間を供給`
        : "official-page: 公式ページから有効な期間を抽出できず（非セール日へフォールバック）",
    diagnostics,
  };
}

module.exports = {
  extractWindowsFromText,
  extractWindowsFromHtml,
  fetchOfficialPageSaleWindows,
  discoverCampaignUrls,
  pickBestWindow,
  resolveSeedUrlsForBrand,
};
