/**
 * drink 運用設定の読み込み（policy/drink-ops.json + env）
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const opsPath = path.join(root, "policy", "drink-ops.json");

const DEFAULT_CATEGORIES = ["sake", "shochu", "fruit", "seasonal", "other"];

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadDrinkOps() {
  const ops = readJson(opsPath, {});
  return {
    ...ops,
    categories: Array.isArray(ops.categories) ? ops.categories : DEFAULT_CATEGORIES,
    fixedPageUrl: String(
      process.env.DRINK_FIXED_PAGE_URL || ops.fixedPageUrl || "",
    ).trim(),
  };
}

function normalizeCategory(raw, categories = DEFAULT_CATEGORIES) {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (categories.includes(v)) return v;
  return "other";
}

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
  if (yen == null) return true;
  return yen >= minYen && yen <= maxYen;
}

function categoryLabelJa(category) {
  switch (normalizeCategory(category)) {
    case "sake":
      return "日本酒";
    case "shochu":
      return "焼酎・泡盛";
    case "fruit":
      return "梅酒・リキュール";
    case "seasonal":
      return "季節酒";
    default:
      return "お酒";
  }
}

function roundupTitleJa(category, ops) {
  const cat = normalizeCategory(category, ops?.categories);
  const fromOps = ops?.blog?.roundupTitles?.[cat];
  if (fromOps) return String(fromOps);
  switch (cat) {
    case "sake":
      return "日本酒まとめ";
    case "shochu":
      return "焼酎・泡盛まとめ";
    case "fruit":
      return "梅酒・リキュールまとめ";
    case "seasonal":
      return "季節酒・限定醸造まとめ";
    default:
      return "銘酒メモまとめ";
  }
}

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
  return normalizeCategory(weekly[key] || "sake", ops.categories);
}

function readLabels(item) {
  const labels = item?.labels && typeof item.labels === "object" ? item.labels : {};
  return {
    sale: Boolean(labels.sale),
    campaign: Boolean(labels.campaign),
    popular: Boolean(labels.popular),
    limited: Boolean(labels.limited),
    arrival: Boolean(labels.arrival),
    campaignEndAt: String(labels.campaignEndAt || item?.campaignEndAt || "").trim(),
    saleEndAt: String(labels.saleEndAt || item?.saleEndAt || "").trim(),
    limitedEndAt: String(labels.limitedEndAt || item?.limitedEndAt || "").trim(),
  };
}

function isEndAtPassed(endAt, now = new Date()) {
  const raw = String(endAt || "").trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  return t < now.getTime();
}

function interruptKind(item, now = new Date()) {
  const labels = readLabels(item);
  if (labels.arrival) return "arrival";
  if (labels.limited) {
    if (isEndAtPassed(labels.limitedEndAt, now)) return null;
    return "limited";
  }
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
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = parts.weekday;
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
  loadDrinkOps,
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
  DEFAULT_CATEGORIES,
};
