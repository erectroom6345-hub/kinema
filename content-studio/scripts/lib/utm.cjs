/**
 * CJS 側の UTM ヘルパー（write-run-summary / metrics / prepare 用）。
 * ロジックは src/utils/utm.ts と揃える。
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sanitizeUtmToken(value, maxLen = 64) {
  const v = String(value || "unknown").trim() || "unknown";
  return v.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, maxLen);
}

function formatUtmDate(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function normalizePipelineGenre(genre) {
  return String(genre || "").trim().toLowerCase() === "living" ? "living" : "beauty";
}

function normalizeSocialUtmSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "instagram") return "instagram";
  if (s === "x" || s === "twitter") return "x";
  return "threads";
}

function normalizeBeautyUtmSource(source) {
  return source === "instagram" ? "instagram" : "threads";
}

function appendUtmParams(rawUrl, params, opts = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const overwrite = Boolean(opts.overwrite);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = String(params[key] || "").trim();
    if (!v) continue;
    if (!overwrite && parsed.searchParams.has(key)) continue;
    parsed.searchParams.set(key, v);
  }
  return parsed.toString();
}

function buildTrackUrl(params = {}) {
  const source = normalizeSocialUtmSource(params.source);
  const genre = normalizePipelineGenre(params.genre);
  const safeProduct = sanitizeUtmToken(params.productId);
  const content =
    String(params.utmContent || "").trim() ||
    (params.postId ? `${source}_${sanitizeUtmToken(params.postId, 64)}` : "") ||
    `${source}_${formatUtmDate(params.date)}`;
  return appendUtmParams(params.blogUrl, {
    utm_source: source,
    utm_medium: "social",
    utm_campaign: `${genre}_${safeProduct}`,
    utm_content: content,
  });
}

function buildBeautyTrackUrl(params = {}) {
  return buildTrackUrl({
    ...params,
    genre: params.genre || "beauty",
  });
}

function withThreadsBeautyUtm(blogUrl, productId, opts = {}) {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "threads",
    genre: opts.genre || "beauty",
    postId: opts.postId,
    utmContent: opts.utmContent,
    date: opts.date,
  });
}

function withInstagramBeautyUtm(blogUrl, productId, opts = {}) {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "instagram",
    genre: opts.genre || "beauty",
    postId: opts.postId,
    utmContent: opts.utmContent,
    date: opts.date,
  });
}

function withXTrackUtm(blogUrl, productId, opts = {}) {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "x",
    genre: opts.genre || "living",
    postId: opts.postId,
    utmContent: opts.utmContent,
    date: opts.date,
  });
}

function describeUtm(url) {
  try {
    const u = new URL(url);
    const out = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const v = u.searchParams.get(key);
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

module.exports = {
  appendUtmParams,
  buildTrackUrl,
  buildBeautyTrackUrl,
  withThreadsBeautyUtm,
  withInstagramBeautyUtm,
  withXTrackUtm,
  describeUtm,
  formatUtmDate,
  sanitizeUtmToken,
  normalizeBeautyUtmSource,
  normalizePipelineGenre,
  normalizeSocialUtmSource,
};
