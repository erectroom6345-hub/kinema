/**
 * 美容セール期間の一次ソース管理。
 *
 * 一次: data/beauty-sale-windows.json → products-beauty.json の saleStart/saleEnd
 * 補助: policy/beauty-select.json の calendar（ミラー。手動運用しない）
 *
 * 現状の商品取得パイプラインは URL/画像のみで、セール期間 API は未接続。
 * Provider を差し込んで items を埋める想定。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_WINDOWS_PATH = path.join(ROOT, "data", "beauty-sale-windows.json");
const DEFAULT_PRODUCTS_PATH = path.join(ROOT, "input", "products-beauty.json");
const DEFAULT_POLICY_PATH = path.join(ROOT, "policy", "beauty-select.json");
const DEFAULT_SYNC_STATUS_PATH = path.join(
  ROOT,
  "data",
  "beauty-sale-sync-status.json"
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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function normalizeDay(raw) {
  const s = String(raw || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function loadWindows(windowsPath = DEFAULT_WINDOWS_PATH) {
  const raw = readJson(windowsPath, {});
  return {
    updatedAt: raw.updatedAt || null,
    provider: raw.provider || null,
    items: raw.items && typeof raw.items === "object" ? raw.items : {},
  };
}

function saveWindows(store, windowsPath = DEFAULT_WINDOWS_PATH) {
  writeJson(windowsPath, {
    _comment:
      "一次ソース用のセール期間ストア。sync-beauty-sale-windows.cjs が自動更新する。手動編集しない。",
    updatedAt: store.updatedAt || tokyoDayKey(),
    provider: store.provider || null,
    items: store.items || {},
  });
}

/**
 * windows → products-beauty.json の sale バケットへ saleStart/saleEnd を書き戻す。
 * store に無い商品は期間をクリア（取得失敗時の非セール日フォールバック用）。
 */
function applyWindowsToProducts(store, productsPath = DEFAULT_PRODUCTS_PATH) {
  const products = readJson(productsPath, {});
  const sale = Array.isArray(products.sale) ? products.sale : [];
  const items = store.items && typeof store.items === "object" ? store.items : {};
  let changed = 0;
  const nextSale = sale.map((item) => {
    const id = item?.id;
    if (!id) return item;

    if (!items[id]) {
      if (item.saleStart || item.saleEnd) {
        changed += 1;
        const next = { ...item };
        delete next.saleStart;
        delete next.saleEnd;
        return next;
      }
      return item;
    }

    const w = items[id];
    const start = normalizeDay(w.saleStart);
    const end = normalizeDay(w.saleEnd || w.saleStart);
    if (!start) {
      if (item.saleStart || item.saleEnd) {
        changed += 1;
        const next = { ...item };
        delete next.saleStart;
        delete next.saleEnd;
        return next;
      }
      return item;
    }
    const next = { ...item, saleStart: start, saleEnd: end || start };
    if (item.saleStart !== next.saleStart || item.saleEnd !== next.saleEnd) {
      changed += 1;
    }
    return next;
  });
  if (changed > 0) {
    writeJson(productsPath, { ...products, sale: nextSale });
  }
  return { changed, totalSale: nextSale.length };
}

/**
 * 有効な商品期間を policy calendarRanges へミラー（補助。手動運用しない）
 */
function mirrorWindowsToPolicy(store, policyPath = DEFAULT_POLICY_PATH, today = tokyoDayKey()) {
  const policy = readJson(policyPath, {});
  const ranges = [];
  for (const [productId, w] of Object.entries(store.items || {})) {
    const start = normalizeDay(w.saleStart);
    const end = normalizeDay(w.saleEnd || w.saleStart);
    if (!start) continue;
    // 終了済みはミラーしない
    if (end && end < today) continue;
    ranges.push({
      start,
      end: end || start,
      source: "auto:beauty-sale-windows",
      productId,
    });
  }
  const next = {
    ...policy,
    sale: {
      ...(policy.sale || {}),
      _comment:
        "補助ミラー。一次ソースは data/beauty-sale-windows.json → products-beauty.json。手動で埋めない。",
      calendarDates: Array.isArray(policy.sale?.calendarDates)
        ? policy.sale.calendarDates
        : [],
      calendarRanges: ranges,
      _autoMirroredAt: new Date().toISOString(),
    },
  };
  writeJson(policyPath, next);
  return { mirroredRanges: ranges.length };
}

/**
 * カタログ上の既存 saleStart/saleEnd を windows へ取り込む（パススルー）
 */
function ingestFromCatalog(productsPath = DEFAULT_PRODUCTS_PATH) {
  const products = readJson(productsPath, {});
  const items = {};
  for (const item of products.sale || []) {
    const id = item?.id;
    if (!id) continue;
    const start = normalizeDay(item.saleStart || item.labels?.saleStart);
    const end = normalizeDay(item.saleEnd || item.labels?.saleEnd);
    // 開始・終了欠損は取り込まない
    if (!start || !end) continue;
    items[id] = {
      saleStart: start,
      saleEnd: end,
      source: "catalog",
      productName: item.productName || "",
    };
  }
  return items;
}

/**
 * 明朝ログ用の sync 状態（run-beauty / select が読む）
 */
function saveSyncStatus(status, statusPath = DEFAULT_SYNC_STATUS_PATH) {
  const windowsCount = Number(status.windowsCount) || 0;
  const payload = {
    syncStatus: status.syncStatus || "unknown",
    provider: status.provider || null,
    windowsCount,
    day: status.day || tokyoDayKey(),
    note: status.note || "",
    yahooCheckSkipped: status.yahooCheckSkipped === true,
    yahooCheckTriggered: status.yahooCheckTriggered === true,
    yahooSaleDetected: status.yahooSaleDetected === true,
    updatedAt: status.updatedAt || new Date().toISOString(),
  };
  writeJson(statusPath, payload);
  return payload;
}

function loadSyncStatus(statusPath = DEFAULT_SYNC_STATUS_PATH) {
  const raw = readJson(statusPath, null);
  if (!raw || typeof raw !== "object") {
    return {
      syncStatus: "missing",
      provider: null,
      windowsCount: 0,
      day: null,
      note: "",
      yahooCheckSkipped: null,
      yahooCheckTriggered: null,
      yahooSaleDetected: null,
      updatedAt: null,
    };
  }
  return {
    syncStatus: raw.syncStatus || "unknown",
    provider: raw.provider || null,
    windowsCount: Number(raw.windowsCount) || 0,
    day: raw.day || null,
    note: raw.note || "",
    yahooCheckSkipped:
      raw.yahooCheckSkipped == null ? null : raw.yahooCheckSkipped === true,
    yahooCheckTriggered:
      raw.yahooCheckTriggered == null ? null : raw.yahooCheckTriggered === true,
    yahooSaleDetected:
      raw.yahooSaleDetected == null ? null : raw.yahooSaleDetected === true,
    updatedAt: raw.updatedAt || null,
  };
}

/** 取得失敗・例外時: 一次ストアと商品期間を空にして非セール日へ倒す */
function clearSaleWindowsForFallback(opts = {}) {
  const provider = opts.provider || "none";
  const note = opts.note || "fallback clear: windows=0";
  const nextStore = {
    updatedAt: tokyoDayKey(),
    provider,
    items: {},
  };
  saveWindows(nextStore, opts.windowsPath);
  const applied = applyWindowsToProducts(nextStore, opts.productsPath);
  const mirrored = mirrorWindowsToPolicy(nextStore, opts.policyPath);
  const status = saveSyncStatus(
    {
      syncStatus: opts.syncStatus || "failed",
      provider,
      windowsCount: 0,
      day: tokyoDayKey(),
      note,
    },
    opts.statusPath
  );
  return { applied, mirrored, status };
}

module.exports = {
  ROOT,
  DEFAULT_WINDOWS_PATH,
  DEFAULT_PRODUCTS_PATH,
  DEFAULT_POLICY_PATH,
  DEFAULT_SYNC_STATUS_PATH,
  tokyoDayKey,
  normalizeDay,
  loadWindows,
  saveWindows,
  applyWindowsToProducts,
  mirrorWindowsToPolicy,
  ingestFromCatalog,
  saveSyncStatus,
  loadSyncStatus,
  clearSaleWindowsForFallback,
};
