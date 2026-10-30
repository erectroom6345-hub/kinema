/**
 * gadget 運用設定の読み込み（policy/gadget-ops.json + env）
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const opsPath = path.join(root, "policy", "gadget-ops.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadGadgetOps() {
  const ops = readJson(opsPath, {});
  return {
    ...ops,
    fixedPageUrl: String(
      process.env.GADGET_FIXED_PAGE_URL || ops.fixedPageUrl || "",
    ).trim(),
  };
}

function normalizeCategory(
  raw,
  categories = ["power", "cable", "desk", "audio", "phone", "other"],
) {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (categories.includes(v)) return v;
  return "other";
}

/** "1,500〜3,000円" / "1500-3000" から代表価格(円)を推定 */
function estimatePriceYen(priceRange) {
  const raw = String(priceRange || "");
  const nums = [...raw.matchAll(/(\d[\d,]*)/g)].map((m) =>
    Number(String(m[1]).replace(/,/g, "")),
  );
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function isPriceInBand(priceRange, minYen, maxYen) {
  const yen = estimatePriceYen(priceRange);
  if (yen == null) return true; // 不明は通す（手動カタログ前提）
  return yen >= minYen && yen <= maxYen;
}

function categoryLabelJa(category) {
  switch (normalizeCategory(category)) {
    case "power":
      return "充電・電源";
    case "cable":
      return "ケーブル";
    case "desk":
      return "デスク";
    case "audio":
      return "オーディオ";
    case "phone":
      return "スマホ周辺";
    default:
      return "ガジェット";
  }
}

/** 読者向けまとめ記事タイトル（内部キー power 等は使わない） */
function roundupTitleJa(category, ops) {
  const cat = normalizeCategory(category, ops?.categories);
  const fromOps = ops?.blog?.roundupTitles?.[cat];
  if (fromOps) return String(fromOps);
  switch (cat) {
    case "power":
      return "充電・電源ガジェットまとめ";
    case "cable":
      return "ケーブル・配線まわりまとめ";
    case "desk":
      return "デスク周りのガジェットまとめ";
    case "audio":
      return "イヤホン・オーディオ小物まとめ";
    case "phone":
      return "スマホ周辺ガジェットまとめ";
    default:
      return "ガジェット小物まとめ";
  }
}

/** Asia/Tokyo の曜日キー mon..sun */
function tokyoWeekdayKey(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  });
  const map = {
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
    Sun: "sun",
  };
  return map[fmt.format(date)] || "mon";
}

function scheduledCategoryForToday(ops, date = new Date()) {
  const weekly = ops.categorySchedule?.weekly || {};
  const key = tokyoWeekdayKey(date);
  return normalizeCategory(weekly[key] || "desk", ops.categories);
}

function readLabels(item) {
  const labels = item?.labels && typeof item.labels === "object" ? item.labels : {};
  return {
    sale: Boolean(labels.sale),
    campaign: Boolean(labels.campaign),
    popular: Boolean(labels.popular),
    campaignEndAt: String(labels.campaignEndAt || item?.campaignEndAt || "").trim(),
    saleEndAt: String(labels.saleEndAt || item?.saleEndAt || "").trim(),
  };
}

function isEndAtPassed(endAt, now = new Date()) {
  const raw = String(endAt || "").trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  return t < now.getTime();
}

/** sale/campaign として割り込み可能か（期限切れは不可） */
function interruptKind(item, now = new Date()) {
  const labels = readLabels(item);
  if (labels.campaign) {
    if (isEndAtPassed(labels.campaignEndAt, now)) return null;
    return "campaign";
  }
  if (labels.sale) {
    if (isEndAtPassed(labels.saleEndAt, now)) return null;
    return "sale";
  }
  return null;
}

function isPopular(item) {
  return readLabels(item).popular;
}

/** Asia/Tokyo 週の月曜 00:00 からの経過で同一週判定 */
function tokyoWeekStartMs(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  // en-CA date: YYYY-MM-DD
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = parts.weekday; // Mon..Sun
  const dayIdx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
  const noonUtcGuess = Date.parse(`${ymd}T12:00:00+09:00`);
  return noonUtcGuess - dayIdx * 86_400_000 - 12 * 3600_000;
}

function isSameTokyoWeek(isoA, isoB = new Date().toISOString()) {
  const a = Date.parse(isoA || "");
  const b = Date.parse(isoB || "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return tokyoWeekStartMs(new Date(a)) === tokyoWeekStartMs(new Date(b));
}

module.exports = {
  opsPath,
  loadGadgetOps,
  normalizeCategory,
  estimatePriceYen,
  isPriceInBand,
  categoryLabelJa,
  roundupTitleJa,
  tokyoWeekdayKey,
  scheduledCategoryForToday,
  readLabels,
  isEndAtPassed,
  interruptKind,
  isPopular,
  tokyoWeekStartMs,
  isSameTokyoWeek,
  root,
};
