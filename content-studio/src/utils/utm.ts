/**
 * Blogger 導線URL用 UTM 付与（既存クエリを壊さない）。
 *
 * 組み立て箇所:
 * - src/utils/utm.ts … 本ファイル（共通）
 * - src/services/threads.ts … Threads本文末尾
 * - src/postThreads.ts … 保存・ログ
 * - src/generateInstagramCaption.ts / generateLivingCaption.ts / prepareInstagramPost.cjs
 *
 * ルール:
 * - utm_source = threads | instagram | x | blogger
 * - utm_medium = social（SNS） / affiliate（Blogger商品リンク）
 * - utm_campaign = {genre}_{productId}（例: beauty_xxx / living_xxx）
 * - utm_content = {source}_{YYYYMMDD} または {source}_{postId}
 */

export type UtmParams = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content?: string;
};

export type SocialUtmSource = "threads" | "instagram" | "x";

/** パイプラインジャンル識別子（UTM campaign 接頭辞） */
export type PipelineGenre = "beauty" | "living";

export function appendUtmParams(
  rawUrl: string,
  params: UtmParams,
  opts?: { overwrite?: boolean },
): string {
  const url = (rawUrl || "").trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const overwrite = Boolean(opts?.overwrite);
  const entries: Array<[string, string | undefined]> = [
    ["utm_source", params.utm_source],
    ["utm_medium", params.utm_medium],
    ["utm_campaign", params.utm_campaign],
    ["utm_content", params.utm_content],
  ];

  for (const [key, value] of entries) {
    const v = (value || "").trim();
    if (!v) continue;
    if (!overwrite && parsed.searchParams.has(key)) continue;
    parsed.searchParams.set(key, v);
  }
  return parsed.toString();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYYMMDD（ローカル日付） */
export function formatUtmDate(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export function sanitizeUtmToken(value: string, maxLen = 64): string {
  const v = (value || "unknown").trim() || "unknown";
  return v.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, maxLen);
}

export function normalizePipelineGenre(genre?: string): PipelineGenre {
  return (genre || "").trim().toLowerCase() === "living" ? "living" : "beauty";
}

export function normalizeSocialUtmSource(source?: string): SocialUtmSource {
  const s = (source || "").trim().toLowerCase();
  if (s === "instagram") return "instagram";
  if (s === "x" || s === "twitter") return "x";
  return "threads";
}

/** @deprecated normalizeSocialUtmSource を推奨 */
export type BeautyUtmSource = "threads" | "instagram";

/** @deprecated normalizeSocialUtmSource を推奨 */
export function normalizeBeautyUtmSource(source?: string): BeautyUtmSource {
  return source === "instagram" ? "instagram" : "threads";
}

/**
 * channel + genre 付き Blogger 計測URL（共通入口）。
 * campaign = {genre}_{productId}
 */
export function buildTrackUrl(params: {
  blogUrl: string;
  productId: string;
  source: SocialUtmSource | string;
  genre?: string;
  postId?: string;
  utmContent?: string;
  date?: Date;
}): string {
  const source = normalizeSocialUtmSource(params.source);
  const genre = normalizePipelineGenre(params.genre);
  const safeProduct = sanitizeUtmToken(params.productId);
  const content =
    (params.utmContent || "").trim() ||
    (params.postId ? `${source}_${sanitizeUtmToken(params.postId, 64)}` : "") ||
    `${source}_${formatUtmDate(params.date)}`;

  return appendUtmParams(params.blogUrl, {
    utm_source: source,
    utm_medium: "social",
    utm_campaign: `${genre}_${safeProduct}`,
    utm_content: content,
  });
}

/**
 * beauty 後方互換。genre 未指定時は beauty。
 */
export function buildBeautyTrackUrl(params: {
  blogUrl: string;
  productId: string;
  source: BeautyUtmSource | string;
  genre?: string;
  postId?: string;
  utmContent?: string;
  date?: Date;
}): string {
  return buildTrackUrl({
    ...params,
    genre: params.genre || "beauty",
  });
}

/** Threads → Blogger（後方互換） */
export function withThreadsBeautyUtm(
  blogUrl: string,
  productId: string,
  opts?: { utmContent?: string; postId?: string; date?: Date; genre?: string },
): string {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "threads",
    genre: opts?.genre || "beauty",
    postId: opts?.postId,
    utmContent: opts?.utmContent,
    date: opts?.date,
  });
}

/** Instagram → Blogger */
export function withInstagramBeautyUtm(
  blogUrl: string,
  productId: string,
  opts?: { utmContent?: string; postId?: string; date?: Date; genre?: string },
): string {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "instagram",
    genre: opts?.genre || "beauty",
    postId: opts?.postId,
    utmContent: opts?.utmContent,
    date: opts?.date,
  });
}

/** X → Blogger */
export function withXTrackUtm(
  blogUrl: string,
  productId: string,
  opts?: { utmContent?: string; postId?: string; date?: Date; genre?: string },
): string {
  return buildTrackUrl({
    blogUrl,
    productId,
    source: "x",
    genre: opts?.genre || "living",
    postId: opts?.postId,
    utmContent: opts?.utmContent,
    date: opts?.date,
  });
}

/** @deprecated buildTrackUrl({ source: "threads" }) を推奨 */
export function buildThreadsTrackUrl(params: {
  blogUrl: string;
  productId: string;
  genre?: string;
  postId?: string;
  utmContent?: string;
  date?: Date;
}): string {
  return buildTrackUrl({ ...params, source: "threads", genre: params.genre || "beauty" });
}

export function describeUtm(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const out: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const v = u.searchParams.get(key);
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}
