/**
 * 美容本番投稿の禁止語・テスト商品・直近重複ガード。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

/** 本番投稿に混ぜたら即 block */
const BANNED_PATTERNS = [
  "blogUrlテスト",
  "blogurlテスト",
  "翌朝自動生成のBlogger",
  "Blogger記事URLを入れる",
  "Blogger個別記事URL",
  "Instagram誘導テスト",
  "誘導テスト用",
  "テスト用",
  "テスト文言",
  "YOURBLOG",
  "REPLACE-",
  "example.com",
];

const BANNED_RE = /テスト用|blogUrl\s*テスト|誘導テスト|翌朝自動生成|記事URLを入れる/i;

function normalizeUrlKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return s.split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

function findBannedHits(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const hits = [];
  const lower = raw.toLowerCase();
  for (const p of BANNED_PATTERNS) {
    if (lower.includes(p.toLowerCase()) || raw.includes(p)) hits.push(p);
  }
  if (BANNED_RE.test(raw)) hits.push("(regex:テスト系)");
  return [...new Set(hits)];
}

function isProductionEligibleProduct(item) {
  if (!item || !item.id) return false;
  if (item.testOnly === true) return false;
  if (item.productionEligible === false) return false;
  if (item.env === "test" || item.mode === "test") return false;
  const blob = [
    item.id,
    item.productName,
    item.name,
    item.articleTitle,
    item.articleBody,
    item.productUrl,
    item.affiliateUrl,
  ]
    .map((x) => String(x || ""))
    .join("\n");
  if (findBannedHits(blob).length) return false;
  const url = String(item.productUrl || item.affiliateUrl || "").trim();
  if (!url) return false;
  if (/example\.com/i.test(url) || /YOURBLOG/i.test(url)) return false;
  return true;
}

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function daysAgoTokyo(n, from = new Date()) {
  const base = new Date(from.getTime());
  base.setTime(base.getTime() - n * 24 * 60 * 60 * 1000);
  return tokyoDayKey(base);
}

/**
 * 直近 N 日の beauty 投稿から productId / URL キーを集める。
 */
function loadRecentBeautyPosts(opts = {}) {
  const coolDownDays = Number(opts.coolDownDays ?? process.env.BEAUTY_RECENT_COOLDOWN_DAYS ?? 7) || 7;
  const today = tokyoDayKey();
  const oldest = daysAgoTokyo(coolDownDays - 1);
  const ids = new Set();
  const urlKeys = new Set();
  const rows = [];

  const pushRow = (row) => {
    if (!row || !row.productId) return;
    const genre = String(row.genre || row.channel || "");
    if (genre && !/beauty/i.test(genre)) return;
    const status = String(row.status || "");
    if (status && status !== "success" && status !== "partial") return;
    const when = row.at || row.finishedAt || row.startedAt || "";
    if (!when) return;
    let day;
    try {
      day = tokyoDayKey(new Date(when));
    } catch {
      return;
    }
    if (day < oldest || day > today) return;
    const id = String(row.productId);
    ids.add(id);
    const url =
      row.productUrl ||
      row.affiliateUrl ||
      row.resolvedProductUrl ||
      "";
    const uk = normalizeUrlKey(url);
    if (uk) urlKeys.add(uk);
    rows.push({ day, productId: id, urlKey: uk, blogUrl: row.blogUrl || "" });
  };

  const historyPath = path.join(ROOT, "output", "metrics", "post-history.jsonl");
  try {
    if (fs.existsSync(historyPath)) {
      for (const line of fs.readFileSync(historyPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          pushRow(JSON.parse(line));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  const runDir = path.join(ROOT, "output", "run-history");
  try {
    if (fs.existsSync(runDir)) {
      for (const name of fs.readdirSync(runDir)) {
        if (!name.endsWith(".json") || name.startsWith("living-")) continue;
        try {
          pushRow(JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8")));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return { coolDownDays, ids, urlKeys, rows, oldest, today };
}

function isRecentDuplicateProduct(item, recent = loadRecentBeautyPosts()) {
  if (!item?.id) return { duplicate: false };
  if (recent.ids.has(item.id)) {
    return { duplicate: true, reason: `recent-productId:${item.id}` };
  }
  const url = normalizeUrlKey(item.productUrl || item.affiliateUrl || "");
  if (url && recent.urlKeys.has(url)) {
    return { duplicate: true, reason: `recent-url:${url}` };
  }
  return { duplicate: false };
}

/**
 * 本番投稿前テキスト検査。hits があれば block 相当。
 */
function assertProductionCopyClean(texts, label = "copy") {
  const joined = (Array.isArray(texts) ? texts : [texts])
    .map((t) => (typeof t === "string" ? t : t?.text || ""))
    .join("\n");
  const hits = findBannedHits(joined);
  if (hits.length) {
    const err = new Error(
      `[beauty-copy-guard] ${label}: テスト/禁止文言を検出: ${hits.join(", ")}`,
    );
    err.code = "BEAUTY_TEST_COPY_BLOCK";
    err.hits = hits;
    throw err;
  }
  return true;
}

module.exports = {
  BANNED_PATTERNS,
  findBannedHits,
  isProductionEligibleProduct,
  loadRecentBeautyPosts,
  isRecentDuplicateProduct,
  assertProductionCopyClean,
  normalizeUrlKey,
  tokyoDayKey,
};
