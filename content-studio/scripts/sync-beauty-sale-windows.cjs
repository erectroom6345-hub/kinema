#!/usr/bin/env node
/**
 * セール期間の自動供給入口。
 *
 * 一次ソース: data/beauty-sale-windows.json
 *  → products-beauty.json (saleStart/saleEnd)
 * 補助ミラー: policy/beauty-select.json calendarRanges
 *
 * Providers:
 *   official-page … 公式ページから期間抽出（本番既定）+ Yahoo軽量確認（トリガー日のみ）
 *   yahoo         … Yahooのみ（5/15/25/月末トリガー。日付だけでは確定しない）
 *   catalog       … 既存カタログの saleStart/saleEnd を取り込む（開発用）
 *   none          … 外部取得なし（空ストア＝非セール日フォールバック）
 *
 * Usage:
 *   node scripts/sync-beauty-sale-windows.cjs --dry-run
 *   node scripts/sync-beauty-sale-windows.cjs --provider=official-page
 *   BEAUTY_SALE_PROVIDER=official-page node scripts/sync-beauty-sale-windows.cjs
 */
const {
  loadWindows,
  saveWindows,
  applyWindowsToProducts,
  mirrorWindowsToPolicy,
  ingestFromCatalog,
  tokyoDayKey,
  normalizeDay,
  saveSyncStatus,
  clearSaleWindowsForFallback,
} = require("./lib/beauty-sale-windows.cjs");
const {
  fetchOfficialPageSaleWindows,
} = require("./lib/beauty-sale-official-page.cjs");
const {
  fetchYahooSaleWindows,
  mergeOfficialAndYahoo,
  stripYahooSourcedItems,
} = require("./lib/beauty-sale-yahoo.cjs");

function parseArgs(argv) {
  const out = {
    dryRun: false,
    provider:
      String(process.env.BEAUTY_SALE_PROVIDER || "official-page").trim() ||
      "official-page",
    help: false,
    keepStale: false,
    today: null,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--keep-stale") out.keepStale = true;
    else if (arg.startsWith("--provider=")) out.provider = arg.slice("--provider=".length);
    else if (arg.startsWith("--date=")) out.today = arg.slice("--date=".length).slice(0, 10);
  }
  return out;
}

function yahooCheckEnabled() {
  const v = String(process.env.BEAUTY_SALE_YAHOO_CHECK || "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

function normalizeProviderItems(rawItems) {
  const items = {};
  for (const [id, w] of Object.entries(rawItems || {})) {
    const start = normalizeDay(w?.saleStart);
    const end = normalizeDay(w?.saleEnd);
    if (!start || !end) continue;
    items[id] = {
      ...w,
      saleStart: start,
      saleEnd: end,
      syncedAt: new Date().toISOString(),
    };
  }
  return items;
}

function emptyYahooFlags(day) {
  return {
    yahooCheckSkipped: true,
    yahooCheckTriggered: false,
    yahooSaleDetected: false,
    day,
    note: "yahoo: disabled",
  };
}

function logYahooFlags(yahoo) {
  const skipped = yahoo?.yahooCheckSkipped === true;
  const triggered = yahoo?.yahooCheckTriggered === true;
  const detected = yahoo?.yahooSaleDetected === true;
  console.log(
    `[sale-sync:yahoo] yahooCheckSkipped=${skipped}` +
      ` yahooCheckTriggered=${triggered}` +
      ` yahooSaleDetected=${detected}` +
      (yahoo?.triggerReason ? ` reason=${yahoo.triggerReason}` : "")
  );
  if (yahoo?.note) console.log(`[sale-sync:yahoo] ${yahoo.note}`);
  for (const d of yahoo?.diagnostics || []) {
    for (const p of d.pages || []) {
      console.log(
        `[sale-sync:yahoo:page] id=${p.id || "?"} status=${p.status ?? "?"}` +
          ` evalOk=${p.evalOk === true} reason=${p.reason || p.error || "?"}`
      );
    }
  }
}

async function fetchFromProvider(provider, opts = {}) {
  const name = String(provider || "official-page").toLowerCase();
  const today = opts.today || tokyoDayKey();

  if (name === "none" || name === "off" || name === "disabled") {
    return {
      ok: true,
      items: {},
      note: "provider=none: 外部セール期間取得をスキップ",
      diagnostics: [],
      yahoo: emptyYahooFlags(today),
    };
  }

  if (name === "catalog") {
    const items = ingestFromCatalog();
    return {
      ok: Object.keys(items).length > 0,
      items,
      note: `provider=catalog: カタログ既存期間を ${Object.keys(items).length} 件取り込み`,
      diagnostics: [],
      yahoo: emptyYahooFlags(today),
    };
  }

  if (name === "yahoo" || name === "yahoo-shopping") {
    const yahoo = await fetchYahooSaleWindows({ today });
    // 非トリガー日のスキップは失敗ではない（供給0 = 非セールへ倒すだけ）
    if (yahoo.yahooCheckSkipped) {
      return {
        ok: true,
        items: {},
        note: yahoo.note,
        diagnostics: yahoo.diagnostics || [],
        yahoo,
      };
    }
    return {
      ok: yahoo.yahooSaleDetected === true && Object.keys(yahoo.items || {}).length > 0,
      items: yahoo.yahooSaleDetected ? yahoo.items : {},
      note: yahoo.note,
      diagnostics: yahoo.diagnostics || [],
      yahoo,
    };
  }

  if (name === "official" || name === "official-page") {
    const official = await fetchOfficialPageSaleWindows({
      today,
      includeHtmlComments:
        String(process.env.BEAUTY_SALE_INCLUDE_HTML_COMMENTS || "true").toLowerCase() !==
        "false",
      untilLookbackDays: Number(process.env.BEAUTY_SALE_UNTIL_LOOKBACK_DAYS || 45),
      maxPagesPerBrand: Number(process.env.BEAUTY_SALE_MAX_PAGES_PER_BRAND || 6),
    });

    let yahoo = emptyYahooFlags(today);
    let items = normalizeProviderItems(official.items || {});

    if (yahooCheckEnabled()) {
      yahoo = await fetchYahooSaleWindows({ today });
      // トリガー外/未検出の Yahoo 由来 stale を落とし、検出時のみ当日窓を足す
      items = mergeOfficialAndYahoo(items, yahoo);
    } else {
      items = stripYahooSourcedItems(items);
      yahoo = { ...emptyYahooFlags(today), note: "yahoo: BEAUTY_SALE_YAHOO_CHECK=false" };
    }

    return {
      ok: Object.keys(items).length > 0,
      items,
      note: `${official.note}; ${yahoo.note}`,
      diagnostics: [
        ...(official.diagnostics || []),
        ...(yahoo.diagnostics || []),
      ],
      yahoo,
      officialOk: official.ok,
    };
  }

  return {
    ok: false,
    items: {},
    note: `未知の provider=${provider}`,
    diagnostics: [],
    yahoo: emptyYahooFlags(today),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/sync-beauty-sale-windows.cjs [--dry-run] [--provider=official-page|yahoo|catalog|none] [--date=YYYY-MM-DD]

一次ソース: data/beauty-sale-windows.json → input/products-beauty.json
補助: policy/beauty-select.json (auto mirror)
本番既定 provider: official-page
Yahoo: トリガー日(5/15/25/月末)のみ軽量確認。日付固定だけでは sale にしない
  BEAUTY_SALE_YAHOO_CHECK=true|false（既定 true。official-page と併用）`);
    process.exit(0);
  }

  const provider = args.provider || "official-page";
  const today = normalizeDay(args.today) || tokyoDayKey();
  console.log(
    `[sale-sync] provider=${provider} dryRun=${args.dryRun} day=${today}`
  );

  let fetched;
  try {
    fetched = await fetchFromProvider(provider, { today });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[sale-sync] ERROR: provider fetch failed:", msg);
    logYahooFlags({
      yahooCheckSkipped: false,
      yahooCheckTriggered: true,
      yahooSaleDetected: false,
      triggerReason: "fetch-exception",
      note: msg,
    });
    if (!args.dryRun) {
      clearSaleWindowsForFallback({
        provider,
        syncStatus: "failed",
        note: `provider fetch error: ${msg}`,
      });
      console.warn(
        "[sale-sync] FALLBACK: 例外のため windows=0 にクリア（日次は非セール日で続行可）"
      );
    } else {
      saveSyncStatus({
        syncStatus: "failed",
        provider,
        windowsCount: 0,
        day: today,
        note: `dry-run fetch error: ${msg}`,
        yahooCheckSkipped: false,
        yahooCheckTriggered: true,
        yahooSaleDetected: false,
      });
    }
    if (String(process.env.BEAUTY_SALE_SYNC_STRICT || "").toLowerCase() === "true") {
      process.exit(2);
    }
    console.log(`[sale-sync] provider=${provider} windowsCount=0 syncStatus=failed`);
    process.exit(0);
  }

  console.log(`[sale-sync] ${fetched.note}`);
  logYahooFlags(fetched.yahoo);

  if (Array.isArray(fetched.diagnostics) && fetched.diagnostics.length) {
    for (const d of fetched.diagnostics) {
      if (d.brand) {
        console.log(
          `[sale-sync:diag] brand=${d.brand} pages=${d.pagesFetched}` +
            ` windowsFound=${d.windowsFound}` +
            ` best=${
              d.best
                ? `${d.best.saleStart}..${d.best.saleEnd} via ${d.best.source}`
                : "(none)"
            }`
        );
        if (d.best?.pageUrl) console.log(`[sale-sync:diag] pageUrl=${d.best.pageUrl}`);
        if (d.best?.raw) console.log(`[sale-sync:diag] raw=${d.best.raw}`);
      }
    }
  }

  const normalizedItems = normalizeProviderItems(fetched.items || {});
  const prev = loadWindows();
  let mergedItems;
  if (args.keepStale || provider === "catalog") {
    mergedItems = stripYahooSourcedItems({ ...prev.items });
    for (const [id, w] of Object.entries(normalizedItems)) {
      mergedItems[id] = { ...mergedItems[id], ...w };
    }
  } else if (Object.keys(normalizedItems).length) {
    mergedItems = { ...normalizedItems };
  } else {
    mergedItems = {};
  }

  const activeCount = Object.keys(mergedItems).length;
  const yahoo = fetched.yahoo || emptyYahooFlags(today);
  const syncStatus =
    provider === "none" ||
    (provider === "yahoo" && yahoo.yahooCheckSkipped === true)
      ? "skipped"
      : activeCount > 0
        ? "ok"
        : fetched.ok
          ? "empty"
          : "failed";

  console.log(
    `[sale-sync] provider=${provider} windowsCount=${activeCount} syncStatus=${syncStatus}` +
      ` yahooCheckSkipped=${yahoo.yahooCheckSkipped === true}` +
      ` yahooCheckTriggered=${yahoo.yahooCheckTriggered === true}` +
      ` yahooSaleDetected=${yahoo.yahooSaleDetected === true}`
  );

  if (!fetched.ok && provider !== "none") {
    console.error(
      "[sale-sync] WARN: provider が有効な期間を供給できませんでした（フォールバック=非セール日）"
    );
  }

  // Yahoo トリガー日に未検出で、公式も空なら明確に非セール
  if (
    yahoo.yahooCheckTriggered &&
    !yahoo.yahooSaleDetected &&
    activeCount === 0
  ) {
    console.warn(
      "[sale-sync] FALLBACK: Yahoo未検出かつ windows=0 → 日次は main 系へ"
    );
  }

  const nextStore = {
    updatedAt: today,
    provider,
    items: mergedItems,
  };

  const statusPayload = {
    syncStatus,
    provider,
    windowsCount: activeCount,
    day: today,
    note: fetched.note,
    yahooCheckSkipped: yahoo.yahooCheckSkipped === true,
    yahooCheckTriggered: yahoo.yahooCheckTriggered === true,
    yahooSaleDetected: yahoo.yahooSaleDetected === true,
  };

  if (args.dryRun) {
    saveSyncStatus(statusPayload);
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          provider,
          ok: fetched.ok,
          syncStatus,
          windowsCount: activeCount,
          items: mergedItems,
          note: fetched.note,
          yahooCheckSkipped: statusPayload.yahooCheckSkipped,
          yahooCheckTriggered: statusPayload.yahooCheckTriggered,
          yahooSaleDetected: statusPayload.yahooSaleDetected,
          diagnostics: fetched.diagnostics || [],
        },
        null,
        2
      )
    );
    if (
      !fetched.ok &&
      provider !== "none" &&
      String(process.env.BEAUTY_SALE_SYNC_STRICT || "").toLowerCase() === "true"
    ) {
      process.exit(2);
    }
    process.exit(0);
  }

  saveWindows(nextStore);
  const applied = applyWindowsToProducts(nextStore);
  const mirrored = mirrorWindowsToPolicy(nextStore);
  saveSyncStatus(statusPayload);

  console.log(
    `[sale-sync] wrote windows; productsUpdated=${applied.changed}/${applied.totalSale}` +
      ` policyRanges=${mirrored.mirroredRanges}`
  );

  if (!activeCount) {
    console.warn(
      "[sale-sync] FALLBACK: セール期間0件 → 日次選定は非セール日（sale を選ばない）"
    );
  }

  if (
    !fetched.ok &&
    provider !== "none" &&
    String(process.env.BEAUTY_SALE_SYNC_STRICT || "").toLowerCase() === "true"
  ) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[sale-sync] ERROR:", err?.message || err);
  try {
    clearSaleWindowsForFallback({
      provider: String(process.env.BEAUTY_SALE_PROVIDER || "official-page"),
      syncStatus: "failed",
      note: err?.message || String(err),
    });
    console.warn(
      "[sale-sync] FALLBACK: 例外のため windows=0 にクリア（日次は非セール日で続行可）"
    );
  } catch (clearErr) {
    console.error("[sale-sync] clear fallback failed:", clearErr?.message || clearErr);
  }
  if (String(process.env.BEAUTY_SALE_SYNC_STRICT || "").toLowerCase() === "true") {
    process.exit(1);
  }
  process.exit(0);
});
