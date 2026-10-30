/**
 * 備蓄期間の共通判定（food / gadget）。
 * policy の stockpilePeriod + 環境変数で ON/OFF。
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function envFlag(name) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function readOps(genre) {
  const file = path.join(root, "policy", `${genre}-ops.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {"food"|"gadget"} genre
 * @param {{ now?: Date, ops?: object }} [opts]
 */
function resolveStockpilePeriod(genre, opts = {}) {
  const ops = opts.ops || readOps(genre);
  const cfg = ops.stockpilePeriod || {};
  const prefix = String(genre || "").toUpperCase();
  const forced = envFlag(`${prefix}_STOCKPILE_MODE`);
  const start =
    String(process.env[`${prefix}_STOCKPILE_START`] || cfg.start || "").slice(0, 10);
  const end = String(process.env[`${prefix}_STOCKPILE_END`] || cfg.end || "").slice(
    0,
    10,
  );
  const today = tokyoDayKey(opts.now || new Date());
  const inWindow = Boolean(start && end && today >= start && today <= end);
  const enabled = cfg.enabled === true;
  const active =
    forced === true ? true : forced === false ? false : enabled && inWindow;

  const stockpilePageUrl = String(
    process.env[`${prefix}_STOCKPILE_PAGE_URL`] ||
      cfg.pageUrl ||
      process.env[`${prefix}_FIXED_PAGE_URL`] ||
      ops.fixedPageUrl ||
      "",
  ).trim();

  return {
    active,
    enabled,
    start,
    end,
    today,
    inWindow,
    pageUrl: stockpilePageUrl,
    snsDestination: String(cfg.snsDestination || "blog"),
  };
}

const FOOD_STOCKPILE_RE =
  /備蓄|非常食|保存食|防災食|ローリングストック|日持ち|常温保存|缶詰|レトルト|フリーズドライ|乾麺|長期保存|保存用/i;

const GADGET_STOCKPILE_RE =
  /備蓄|防災|非常用|携帯トイレ|簡易トイレ|防災ラジオ|手回し|懐中電灯|ランタン|LEDライト|モバイルバッテリー|停電|防災グッズ/i;

function isStockpileProduct(item, genre = "food") {
  if (!item) return false;
  if (item.labels?.stockpile === true) return true;
  const blob = [
    item.name,
    item.nameRaw,
    item.description,
    item.articleBody,
    ...(Array.isArray(item.features) ? item.features : []),
  ]
    .map((x) => String(x || ""))
    .join("\n");
  return genre === "gadget"
    ? GADGET_STOCKPILE_RE.test(blob)
    : FOOD_STOCKPILE_RE.test(blob);
}

module.exports = {
  tokyoDayKey,
  resolveStockpilePeriod,
  isStockpileProduct,
  FOOD_STOCKPILE_RE,
  GADGET_STOCKPILE_RE,
};
