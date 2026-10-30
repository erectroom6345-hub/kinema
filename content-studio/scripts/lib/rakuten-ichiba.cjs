/**
 * 楽天市場 商品検索API（IchibaItem/Search）最小クライアント。
 * affiliateId を付けると itemUrl がアフィリエイトURLになる。
 *
 * 仕様: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
 */
const API_BASE =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

function originFromUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.origin;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function loadRakutenEnv() {
  const applicationId = String(
    process.env.RAKUTEN_APPLICATION_ID || "",
  ).trim();
  const accessKey = String(process.env.RAKUTEN_ACCESS_KEY || "").trim();
  const affiliateId = String(process.env.RAKUTEN_AFFILIATE_ID || "").trim();
  // 2026 API は Origin 必須（エラー名は REFERRER_MISSING だが実質 Origin）
  // 楽天アプリの「許可されたウェブサイト」と一致させる
  const origin =
    String(process.env.RAKUTEN_ORIGIN || "").trim() ||
    originFromUrl(process.env.LIVING_FIXED_PAGE_URL) ||
    "";
  return { applicationId, accessKey, affiliateId, origin };
}

function assertRakutenEnv(env = loadRakutenEnv()) {
  const missing = [];
  if (!env.applicationId) missing.push("RAKUTEN_APPLICATION_ID");
  if (!env.accessKey) missing.push("RAKUTEN_ACCESS_KEY");
  if (!env.affiliateId) missing.push("RAKUTEN_AFFILIATE_ID");
  if (!env.origin) missing.push("RAKUTEN_ORIGIN（または LIVING_FIXED_PAGE_URL）");
  if (missing.length) {
    throw new Error(
      `楽天API env 不足: ${missing.join(", ")}（.env に設定してください）`,
    );
  }
  return env;
}

/**
 * @param {object} opts
 * @param {string} opts.keyword
 * @param {number} [opts.hits]
 * @param {number} [opts.minPrice]
 * @param {number} [opts.maxPrice]
 * @param {number} [opts.page]
 * @param {string} [opts.ngKeyword]
 * @param {number} [opts.pointRateFlag]
 * @param {number} [opts.pointRate]
 * @param {string} [opts.sort]
 * @param {AbortSignal} [opts.signal]
 */
async function searchIchibaItems(opts) {
  const env = assertRakutenEnv();
  const keyword = String(opts.keyword || "").trim();
  if (!keyword) throw new Error("keyword が空です");

  const params = new URLSearchParams();
  params.set("applicationId", env.applicationId);
  params.set("accessKey", env.accessKey);
  params.set("affiliateId", env.affiliateId);
  params.set("format", "json");
  params.set("formatVersion", "2");
  params.set("keyword", keyword);
  params.set("hits", String(Math.min(30, Math.max(1, opts.hits ?? 10))));
  params.set("page", String(opts.page ?? 1));
  params.set("availability", "1");
  params.set("imageFlag", "1");
  params.set("sort", String(opts.sort || "-reviewCount"));
  if (opts.minPrice != null) params.set("minPrice", String(opts.minPrice));
  if (opts.maxPrice != null) params.set("maxPrice", String(opts.maxPrice));
  const ngKeyword = String(opts.ngKeyword || "").trim();
  if (ngKeyword) params.set("NGKeyword", ngKeyword);
  if (opts.pointRateFlag != null) {
    params.set("pointRateFlag", String(opts.pointRateFlag));
  }
  if (opts.pointRate != null) {
    params.set("pointRate", String(opts.pointRate));
  }
  // 最小構成 + セール判定用
  params.set(
    "elements",
    "itemName,itemPrice,itemUrl,affiliateUrl,mediumImageUrls,shopName,itemCode,itemCaption,catchcopy,pointRate,startTime,endTime,postageFlag,reviewCount,reviewAverage",
  );

  const url = `${API_BASE}?${params.toString()}`;
  const headers = {
    Accept: "application/json",
    accessKey: env.accessKey,
    Origin: env.origin,
    Referer: `${env.origin}/`,
    "User-Agent": "content-studio-living/1.0",
  };

  let body;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: opts.signal,
    });
    lastStatus = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `楽天API JSON解析失敗 HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
      continue;
    }

    if (!res.ok) {
      const msg =
        body?.errors?.errorMessage ||
        body?.error_description ||
        body?.error ||
        body?.message ||
        text.slice(0, 200);
      throw new Error(
        `楽天API HTTP ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}` +
          ` (Origin=${env.origin})`,
      );
    }
    break;
  }

  if (!body) {
    throw new Error(`楽天API 応答なし HTTP ${lastStatus}`);
  }

  // formatVersion=2 でもキーが Items / items のどちらかになることがある
  const rawList = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.Items)
      ? body.Items
      : [];
  const items = rawList
    .map((row) => (row && row.item ? row.item : row))
    .map(normalizeApiItem)
    .filter(Boolean);
  return {
    count: Number(body.count ?? body.Count) || items.length,
    page: Number(body.page ?? body.Page) || 1,
    items,
  };
}

function firstImageUrl(raw) {
  if (Array.isArray(raw?.mediumImageUrls) && raw.mediumImageUrls.length) {
    const first = raw.mediumImageUrls[0];
    if (typeof first === "string") return first.trim();
    if (first && typeof first.imageUrl === "string") return first.imageUrl.trim();
  }
  if (Array.isArray(raw?.smallImageUrls) && raw.smallImageUrls.length) {
    const first = raw.smallImageUrls[0];
    if (typeof first === "string") return first.trim();
    if (first && typeof first.imageUrl === "string") return first.imageUrl.trim();
  }
  return String(raw?.imageUrl || "").trim();
}

function normalizeApiItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const itemName = String(raw.itemName || "").trim();
  const itemPrice = Number(raw.itemPrice);
  // affiliateId 付きなら itemUrl がアフィURL。念のため affiliateUrl も見る
  const itemUrl = String(raw.itemUrl || raw.affiliateUrl || "").trim();
  const imageUrl = firstImageUrl(raw);
  const shopName = String(raw.shopName || "").trim();
  const itemCode = String(raw.itemCode || "").trim();
  if (!itemName || !itemUrl || !imageUrl || !Number.isFinite(itemPrice)) {
    return null;
  }
  const pointRate = Number(raw.pointRate);
  const reviewCount = Number(raw.reviewCount);
  const reviewAverage = Number(raw.reviewAverage);
  return {
    itemName,
    itemPrice,
    itemUrl,
    imageUrl,
    shopName,
    itemCode,
    itemCaption: String(raw.itemCaption || "").trim(),
    catchcopy: String(raw.catchcopy || "").trim(),
    pointRate: Number.isFinite(pointRate) && pointRate > 0 ? pointRate : null,
    reviewCount:
      Number.isFinite(reviewCount) && reviewCount >= 0 ? reviewCount : null,
    reviewAverage:
      Number.isFinite(reviewAverage) && reviewAverage >= 0
        ? reviewAverage
        : null,
    startTime: String(raw.startTime || "").trim(),
    endTime: String(raw.endTime || "").trim(),
    postageFlag: raw.postageFlag,
  };
}

module.exports = {
  API_BASE,
  loadRakutenEnv,
  assertRakutenEnv,
  searchIchibaItems,
  normalizeApiItem,
};
