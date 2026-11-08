/**
 * Threads Graph API（テキスト投稿）の service 層。
 * Instagram / Blogger とは独立。呼び出し側は薄く保つ。
 */
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { buildBeautyTrackUrl } from "../utils/utm.ts";
import { buildBeautyThreadsBody } from "../templates/beautySocialCopy.ts";
import { threadsFixedCtaLine } from "../templates/beautyPostPatterns.ts";

const DEFAULT_API_VERSION = "v1.0";

export type ThreadsPublishResult = {
  creationId: string;
  postId: string;
  text: string;
};

export type ThreadsCredentials = {
  accessToken: string;
  userId: string;
  apiVersion?: string;
};

export class ThreadsAuthError extends Error {
  readonly code = "THREADS_AUTH";
  constructor(message: string) {
    super(message);
    this.name = "ThreadsAuthError";
  }
}

function apiBase(apiVersion?: string): string {
  const ver = (apiVersion || process.env.THREADS_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  return `https://graph.threads.net/${ver}`;
}

/** 専用アカウント系ジャンル（美容 THREADS_* にフォールバックしない） */
export type DedicatedThreadsGenre = "living" | "gadget" | "food" | "drink";

export function getDedicatedThreadsGenre(): DedicatedThreadsGenre | null {
  const genre = (process.env.CONTENT_PIPELINE_GENRE || "").trim().toLowerCase();
  if (genre === "living" || genre === "gadget" || genre === "food" || genre === "drink") return genre;
  const posted = (process.env.POSTED_PRODUCTS_PATH || "").trim();
  if (/posted-living\.json$/i.test(posted) || posted.includes("posted-living")) {
    return "living";
  }
  if (/posted-gadget\.json$/i.test(posted) || posted.includes("posted-gadget")) {
    return "gadget";
  }
  if (/posted-food\.json$/i.test(posted) || posted.includes("posted-food")) {
    return "food";
  }
  if (/posted-drink\.json$/i.test(posted) || posted.includes("posted-drink")) {
    return "drink";
  }
  return null;
}

function dedicatedThreadsPrefix(
  genre: DedicatedThreadsGenre,
): "LIVING" | "GADGET" | "FOOD" | "DRINK" {
  if (genre === "drink") return "DRINK";
  if (genre === "food") return "FOOD";
  if (genre === "gadget") return "GADGET";
  return "LIVING";
}

/** living 投稿経路か（shell の CONTENT_PIPELINE_GENRE / POSTED_PRODUCTS_PATH） */
export function shouldUseLivingThreadsEnv(): boolean {
  return getDedicatedThreadsGenre() === "living";
}

export function shouldUseGadgetThreadsEnv(): boolean {
  return getDedicatedThreadsGenre() === "gadget";
}

export function shouldUseFoodThreadsEnv(): boolean {
  return getDedicatedThreadsGenre() === "food";
}

export function shouldUseDrinkThreadsEnv(): boolean {
  return getDedicatedThreadsGenre() === "drink";
}

function applyDedicatedThreadsEnvOverrides(
  genre: DedicatedThreadsGenre,
): void {
  const prefix = dedicatedThreadsPrefix(genre);
  const token = (process.env[`${prefix}_THREADS_ACCESS_TOKEN`] || "").trim();
  const userId = (process.env[`${prefix}_THREADS_USER_ID`] || "").trim();
  const enabled = (process.env[`${prefix}_THREADS_ENABLED`] || "").trim();
  const appId = (process.env[`${prefix}_THREADS_APP_ID`] || "").trim();
  const appSecret = (process.env[`${prefix}_THREADS_APP_SECRET`] || "").trim();
  const redirectUri = (process.env[`${prefix}_THREADS_REDIRECT_URI`] || "").trim();

  if (!token && !userId && !enabled) return;

  if (token) process.env.THREADS_ACCESS_TOKEN = token;
  if (userId) process.env.THREADS_USER_ID = userId;
  if (enabled) process.env.THREADS_ENABLED = enabled;
  if (appId) process.env.THREADS_APP_ID = appId;
  if (appSecret) process.env.THREADS_APP_SECRET = appSecret;
  if (redirectUri) process.env.THREADS_REDIRECT_URI = redirectUri;

  console.log(
    `[Threads認証] ${genre} 設定を適用: USER_ID=${userId || "(empty)"}` +
      ` ENABLED=${(process.env.THREADS_ENABLED || "").trim() || "(unset)"}` +
      ` TOKEN=${token ? `設定済(長さ${token.length})` : "(empty)"}`,
  );
}

/**
 * dotenv 再読込で美容 THREADS_* に戻ったあと、暮らし用 LIVING_* を共通キーへ載せ直す。
 * LIVING_* が空なら何もしない（美容設定のまま＝run-living 側の警告と対応）。
 */
export function applyLivingThreadsEnvOverrides(): void {
  if (!shouldUseLivingThreadsEnv()) return;
  applyDedicatedThreadsEnvOverrides("living");
}

export function applyGadgetThreadsEnvOverrides(): void {
  if (!shouldUseGadgetThreadsEnv()) return;
  applyDedicatedThreadsEnvOverrides("gadget");
}

export function applyFoodThreadsEnvOverrides(): void {
  if (!shouldUseFoodThreadsEnv()) return;
  applyDedicatedThreadsEnvOverrides("food");
}

export function applyDrinkThreadsEnvOverrides(): void {
  if (!shouldUseDrinkThreadsEnv()) return;
  applyDedicatedThreadsEnvOverrides("drink");
}

/**
 * content-studio/.env を優先して読み込む（既存 process.env を上書き）。
 * dotenv 既定は「既に export 済みの値を上書きしない」ため、古いシェル変数が残ると古い token になる。
 * living/gadget/food/drink 経路では直後に専用 THREADS_* を再適用する。
 */
export function loadThreadsEnvFromFile(cwd = process.cwd()): string {
  const envPath = path.resolve(cwd, ".env");
  loadDotenv({ path: envPath, override: true });
  applyLivingThreadsEnvOverrides();
  applyGadgetThreadsEnvOverrides();
  applyFoodThreadsEnvOverrides();
  applyDrinkThreadsEnvOverrides();
  return envPath;
}

export function readThreadsCredentialsFromEnv(): ThreadsCredentials {
  // 読み出し直前に .env を再適用（シェルに古い THREADS_* が残っていてもファイル優先）
  loadThreadsEnvFromFile();

  const dedicated = getDedicatedThreadsGenre();
  const prefix = dedicated ? dedicatedThreadsPrefix(dedicated) : null;
  // 専用ジャンルは美容 THREADS_* にフォールバックしない（誤投稿防止）
  const accessToken = prefix
    ? (process.env[`${prefix}_THREADS_ACCESS_TOKEN`] ?? "").trim()
    : (process.env.THREADS_ACCESS_TOKEN ?? "").trim();
  const userId = prefix
    ? (process.env[`${prefix}_THREADS_USER_ID`] ?? "").trim()
    : (process.env.THREADS_USER_ID ?? "").trim();

  const missing: string[] = [];
  if (!accessToken) {
    missing.push(prefix ? `${prefix}_THREADS_ACCESS_TOKEN` : "THREADS_ACCESS_TOKEN");
  }
  if (!userId) {
    missing.push(prefix ? `${prefix}_THREADS_USER_ID` : "THREADS_USER_ID");
  }
  if (missing.length > 0) {
    throw new ThreadsAuthError(
      `[Threads認証] 設定不足: ${missing.join(", ")}。.env を確認してください。`,
    );
  }

  // 下流の Graph 呼び出しが THREADS_* を見る場合に備え、専用値を共通キーへ載せる
  if (prefix) {
    process.env.THREADS_ACCESS_TOKEN = accessToken;
    process.env.THREADS_USER_ID = userId;
  }

  return {
    accessToken,
    userId,
    apiVersion: (process.env.THREADS_API_VERSION ?? DEFAULT_API_VERSION).trim(),
  };
}

export function isThreadsEnabled(): boolean {
  loadThreadsEnvFromFile();
  const dedicated = getDedicatedThreadsGenre();
  if (dedicated) {
    const prefix = dedicatedThreadsPrefix(dedicated);
    const dedicatedEnabled = (process.env[`${prefix}_THREADS_ENABLED`] ?? "").trim();
    if (dedicatedEnabled) return dedicatedEnabled.toLowerCase() === "true";
    // 専用 *_THREADS_ENABLED 未設定時のみ共通キー（apply 済み）を見る
  }
  return (process.env.THREADS_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** token に紐づく正しい Threads user id（/me）。.env の誤値検出用 */
export async function fetchThreadsMe(creds?: ThreadsCredentials): Promise<{ id: string; username?: string }> {
  const c = creds ?? readThreadsCredentialsFromEnv();
  const url =
    `${apiBase(c.apiVersion)}/me?fields=id,username` +
    `&access_token=${encodeURIComponent(c.accessToken)}`;
  const res = await fetch(url);
  const raw = await res.text();
  let json: { id?: string; username?: string; error?: { message?: string } } = {};
  try {
    json = raw ? (JSON.parse(raw) as typeof json) : {};
  } catch {
    json = {};
  }
  if (!res.ok || !json.id) {
    throw new ThreadsAuthError(
      `[Threads認証] /me 失敗: HTTP ${res.status}` +
        (json.error?.message ? ` message=${json.error.message}` : ` body=${raw.slice(0, 200)}`),
    );
  }
  return { id: String(json.id), username: json.username };
}

/**
 * .env の THREADS_USER_ID が /me と違う場合は /me の id に合わせる。
 * （1桁違いなどで GET /{user-id}/threads が Unsupported get request になる）
 */
export async function syncThreadsUserIdFromMe(
  creds?: ThreadsCredentials,
): Promise<ThreadsCredentials> {
  const base = creds ?? readThreadsCredentialsFromEnv();
  const me = await fetchThreadsMe(base);
  if (me.id === base.userId) return base;
  console.warn(
    `[Threads認証] THREADS_USER_ID 不一致: env=${base.userId} me=${me.id}` +
      (me.username ? ` username=${me.username}` : "") +
      ` → /me の id に更新します`,
  );
  try {
    persistThreadsUserId(me.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Threads認証] THREADS_USER_ID の .env 保存に失敗（メモリ上は修正）: ${msg}`);
    process.env.THREADS_USER_ID = me.id;
    const dedicated = getDedicatedThreadsGenre();
    if (dedicated) {
      process.env[`${dedicatedThreadsPrefix(dedicated)}_THREADS_USER_ID`] = me.id;
    }
  }
  return { ...base, userId: me.id };
}

/** expires_in（秒）から短命 / 長期を判定（短命≈1h、長期≈60日） */
export function classifyThreadsTokenLifetime(expiresInSec?: number): "short-lived" | "long-lived" | "unknown" {
  if (expiresInSec == null || !Number.isFinite(expiresInSec) || expiresInSec <= 0) return "unknown";
  // 短命は通常 3600。余裕を見て 1日未満を short 扱い
  if (expiresInSec < 86_400) return "short-lived";
  return "long-lived";
}

function persistThreadsEnvKey(key: string, value: string, envPath = path.resolve(".env")): void {
  const v = value.trim();
  if (!v) throw new ThreadsAuthError(`[Threads認証] 空の ${key} は保存できません`);
  if (!fs.existsSync(envPath)) {
    console.warn(`[Threads認証] ${envPath} が無いため ${key} のファイル保存をスキップ`);
    process.env[key] = v;
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8");
  const line = `${key}=${v}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(raw)
    ? raw.replace(re, line)
    : `${raw.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(envPath, next, "utf8");
  process.env[key] = v;
}

/** .env の THREADS_ACCESS_TOKEN（living/gadget 時は専用キー）を更新 */
export function persistThreadsAccessToken(newToken: string, envPath = path.resolve(".env")): void {
  const token = newToken.trim();
  if (!token) throw new ThreadsAuthError("[Threads認証] 空の token は保存できません");
  const dedicated = getDedicatedThreadsGenre();
  const prefix = dedicated ? dedicatedThreadsPrefix(dedicated) : null;
  const key = prefix ? `${prefix}_THREADS_ACCESS_TOKEN` : "THREADS_ACCESS_TOKEN";
  persistThreadsEnvKey(key, token, envPath);
  process.env.THREADS_ACCESS_TOKEN = token;
  if (prefix) process.env[`${prefix}_THREADS_ACCESS_TOKEN`] = token;
  console.log(`[Threads認証] .env の ${key} を更新しました`);
}

export function persistThreadsUserId(userId: string, envPath = path.resolve(".env")): void {
  const id = userId.trim();
  const dedicated = getDedicatedThreadsGenre();
  const prefix = dedicated ? dedicatedThreadsPrefix(dedicated) : null;
  const key = prefix ? `${prefix}_THREADS_USER_ID` : "THREADS_USER_ID";
  persistThreadsEnvKey(key, id, envPath);
  process.env.THREADS_USER_ID = id;
  if (prefix) process.env[`${prefix}_THREADS_USER_ID`] = id;
  console.log(`[Threads認証] .env の ${key} を更新しました userId=${id}`);
}

type ThreadsTokenApiJson = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: number | string;
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
  error_message?: string;
};

async function parseThreadsTokenResponse(res: Response): Promise<{ raw: string; json: ThreadsTokenApiJson }> {
  const raw = await res.text();
  let json: ThreadsTokenApiJson = {};
  try {
    json = raw ? (JSON.parse(raw) as ThreadsTokenApiJson) : {};
  } catch {
    json = { error_message: raw.slice(0, 200) };
  }
  return { raw, json };
}

/**
 * OAuth code → 短命 token（約1時間）。
 * POST https://graph.threads.com/oauth/access_token
 * 保存すべきなのはこの値ではなく、続く th_exchange_token の長期 token。
 */
export async function exchangeThreadsAuthCode(params: {
  code: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}): Promise<{ accessToken: string; userId?: string; expiresIn?: number; kind: "short-lived" | "unknown" }> {
  const clientId = (params.clientId ?? process.env.THREADS_APP_ID ?? "").trim();
  const clientSecret = (params.clientSecret ?? process.env.THREADS_APP_SECRET ?? "").trim();
  const redirectUri =
    (params.redirectUri ?? process.env.THREADS_REDIRECT_URI ?? "").trim() ||
    "https://erectroom6345-hub.github.io/instagram-cards/oauth-callback";
  const code = params.code.trim();
  if (!clientId || !clientSecret || !code) {
    throw new ThreadsAuthError(
      "[Threads認証] code 交換には THREADS_APP_ID / THREADS_APP_SECRET / code が必要です",
    );
  }

  const res = await fetch("https://graph.threads.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const { raw, json } = await parseThreadsTokenResponse(res);
  if (!res.ok || !json.access_token) {
    const msg = json.error?.message || json.error_message || raw.slice(0, 200) || `HTTP ${res.status}`;
    throw new ThreadsAuthError(`[Threads認証] code→短命token 失敗: ${msg}`);
  }

  // oauth/access_token の応答は短命（約1時間）。expires_in が無くても short 扱い。
  return {
    accessToken: json.access_token,
    userId: json.user_id != null ? String(json.user_id) : undefined,
    expiresIn: json.expires_in,
    kind: "short-lived",
  };
}

/**
 * 短命 token → 長期 token（約60日）。
 * GET https://graph.threads.com/access_token?grant_type=th_exchange_token
 * .env に保存すべきなのはこのレスポンスの access_token。
 */
export async function exchangeThreadsShortLivedForLongLived(params: {
  shortLivedToken: string;
  clientSecret?: string;
}): Promise<{ accessToken: string; expiresIn?: number; kind: "long-lived" | "short-lived" | "unknown" }> {
  const clientSecret = (params.clientSecret ?? process.env.THREADS_APP_SECRET ?? "").trim();
  const shortLivedToken = params.shortLivedToken.trim();
  if (!clientSecret || !shortLivedToken) {
    throw new ThreadsAuthError(
      "[Threads認証] 長期交換には THREADS_APP_SECRET と短命 access_token が必要です",
    );
  }

  const url =
    "https://graph.threads.com/access_token" +
    `?grant_type=th_exchange_token` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&access_token=${encodeURIComponent(shortLivedToken)}`;

  const res = await fetch(url, { method: "GET" });
  const { raw, json } = await parseThreadsTokenResponse(res);
  if (!res.ok || !json.access_token) {
    const msg = json.error?.message || json.error_message || raw.slice(0, 200) || `HTTP ${res.status}`;
    throw new ThreadsAuthError(`[Threads認証] 短命→長期token 失敗: ${msg}`);
  }

  const expiresIn = json.expires_in;
  const kind = classifyThreadsTokenLifetime(expiresIn);
  if (kind === "short-lived") {
    throw new ThreadsAuthError(
      `[Threads認証] 長期交換なのに expires_in=${expiresIn}（短命相当）。` +
        ` 返却値を .env に保存しないでください`,
    );
  }

  return { accessToken: json.access_token, expiresIn, kind };
}

/**
 * 長期トークンを延長（未失効かつ発行から24時間以上が条件）。
 * GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token
 * ※ 前提は長期 token。短命 token では使えない。
 */
export async function refreshThreadsLongLivedToken(
  accessToken: string,
): Promise<{ accessToken: string; expiresIn?: number }> {
  const url =
    "https://graph.threads.com/refresh_access_token" +
    `?grant_type=th_refresh_token&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, { method: "GET" });
  const { raw, json } = await parseThreadsTokenResponse(res);

  if (!res.ok || !json.access_token) {
    const msg =
      json.error?.message ||
      json.error_message ||
      raw.slice(0, 200) ||
      `HTTP ${res.status}`;
    const code = json.error?.code;
    const lower = msg.toLowerCase();
    const expired =
      code === 190 ||
      /expired|invalid.*token|session has expired|cannot be refreshed|revoked/i.test(lower);

    if (expired) {
      throw new ThreadsAuthError(
        `[Threads認証] refresh 不可（期限切れまたはセッション無効）。` +
          ` 長期tokenの再取得が必要です。detail=${msg}`,
      );
    }

    // 発行直後（24h未満）などは既存トークン継続でよいケースもある
    const tooNew = /at least 24 hours|too new|not old enough/i.test(msg);
    if (tooNew) {
      return { accessToken };
    }

    throw new ThreadsAuthError(
      `[Threads認証] refresh 失敗: ${msg}` + (code != null ? ` code=${code}` : ""),
    );
  }

  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

/** 投稿前に refresh を試み、成功時は .env を更新して新しい token を返す */
export async function ensureThreadsAccessToken(
  creds?: ThreadsCredentials,
): Promise<ThreadsCredentials> {
  const base = creds ?? readThreadsCredentialsFromEnv();
  try {
    const refreshed = await refreshThreadsLongLivedToken(base.accessToken);
    if (refreshed.accessToken && refreshed.accessToken !== base.accessToken) {
      try {
        persistThreadsAccessToken(refreshed.accessToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Threads認証] .env 保存に失敗（メモリ上の新tokenで続行）: ${msg}`);
        process.env.THREADS_ACCESS_TOKEN = refreshed.accessToken;
        const dedicated = getDedicatedThreadsGenre();
        if (dedicated) {
          process.env[`${dedicatedThreadsPrefix(dedicated)}_THREADS_ACCESS_TOKEN`] =
            refreshed.accessToken;
        }
      }
      return { ...base, accessToken: refreshed.accessToken };
    }
    return base;
  } catch (err) {
    if (err instanceof ThreadsAuthError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ThreadsAuthError(`[Threads認証] refresh 中に例外: ${msg}`);
  }
}

function isThreadsAuthFailure(status: number, json: Record<string, unknown>): boolean {
  if (status === 401 || status === 403) return true;
  const err = json.error as { code?: number; message?: string; type?: string } | undefined;
  if (!err) return false;
  if (err.code === 190) return true;
  const message = (err.message || "").toLowerCase();
  return /access token|oauth|session has expired|invalid.*token|permission/i.test(message);
}

/** Threads 本文の目安文字数（URL・ハッシュタグ除く） */
const THREADS_BODY_SOFT_LIMIT = 160;
/** Threads 固定ハッシュタグ（毎回1個・重複なし） */
const THREADS_FIXED_HASHTAG = "#スキンケア";

/** Threads API 送信直前の改行正規化（IG/Blogger には使わない） */
export function normalizeThreadsPostText(raw: string): string {
  let text = raw;
  // JSON 等で残ったリテラル "\\r\\n" / "\\n" を実改行へ
  text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 連続空行は最大1行（段落間は \n\n まで）
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** プロフィール誘導・露骨な販促を弱め、短文＋固定タグ1個に整える */
function softenThreadsBody(raw: string): string {
  let text = normalizeThreadsPostText(raw);

  // プロフィール誘導は削除（URLは後段で付ける）
  text = text
    .replace(/詳しくは[、,]?\s*プロフィールのリンクからご覧ください[。．]?/gu, "")
    .replace(/プロフィールのリンクからご覧ください[。．]?/gu, "")
    .replace(/プロフィール(のリンク)?から[^\n。]*[。．]?/gu, "")
    .replace(/詳しくはプロフィール[^\n。]*[。．]?/gu, "");

  // 露骨な宣伝・押し感をやわらげる
  text = text
    .replace(/今すぐ(購入|チェック|ゲット)/gu, "気になったらチェック")
    .replace(/絶対に[買買]うべき/gu, "気になりやすい")
    .replace(/マストバイ/gu, "気になる一品")
    .replace(/買いです[！!]?/gu, "取り入れてみやすいです")
    .replace(/おすすめです[！!]{2,}/gu, "おすすめです")
    .replace(/[！!]{2,}/g, "！")
    .replace(/[？?]{2,}/g, "？");

  // 既存ハッシュタグはすべて除去（後で #スキンケア を1個だけ付ける）
  text = text.replace(/#[^\s#]+/g, "").replace(/[ \t]{2,}/g, " ");

  // 行単位で空行を除き、短く整える
  let lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // 箇条書き記号は会話っぽく平文化
  lines = lines.map((line) => line.replace(/^[・\-•]\s*/, ""));

  // 長すぎる行は句読点で軽く分割しつつ、全体を短文寄りに
  const softLines: string[] = [];
  for (const line of lines) {
    if ([...line].length <= 70) {
      softLines.push(line);
      continue;
    }
    const parts = line.split(/(?<=[。！？!?])/u).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) softLines.push(...parts);
    else softLines.push(line);
  }

  // 本文は最大4行程度、文字数はソフト上限
  const bodyLines: string[] = [];
  let chars = 0;
  for (const line of softLines) {
    if (bodyLines.length >= 4) break;
    const next = chars + [...line].length;
    if (bodyLines.length > 0 && next > THREADS_BODY_SOFT_LIMIT) break;
    bodyLines.push(line);
    chars = next;
    if (chars >= THREADS_BODY_SOFT_LIMIT) break;
  }

  let body = bodyLines.join("\n").trim();
  if (!body && softLines[0]) body = softLines[0];

  // 改行は 2〜4 行（1行だけなら自然な位置で1回だけ割る）
  const currentLines = body.split("\n").filter(Boolean);
  if (currentLines.length === 1 && [...body].length > 50) {
    const one = currentLines[0];
    const cut = one.search(/[。！？!?]/u);
    if (cut > 10 && cut < one.length - 5) {
      body = `${one.slice(0, cut + 1).trim()}\n${one.slice(cut + 1).trim()}`;
    }
  }

  // 固定タグを本文末尾に1個（重複なし）
  if (!body.includes(THREADS_FIXED_HASHTAG)) {
    body = `${body}\n${THREADS_FIXED_HASHTAG}`;
  }

  return normalizeThreadsPostText(body);
}

/**
 * Threads → Blogger 導線 URL（UTM 付き）。
 * 投稿本文組み立てとメトリクス保存の両方から使う。
 */
export function buildThreadsTrackUrl(params: {
  blogUrl: string;
  productId: string;
  postId?: string;
  utmContent?: string;
  date?: Date;
}): string {
  return buildBeautyTrackUrl({
    blogUrl: params.blogUrl,
    productId: params.productId,
    source: "threads",
    postId: params.postId,
    utmContent: params.utmContent,
    date: params.date,
  });
}

/**
 * IGキャプションを Threads 向けに軽く整え、末尾に blogUrl を付ける。
 * Instagram / Blogger の生成ロジックには触れない。
 * blogUrl には productId があるとき UTM（utm_source=threads 等）を付与する。
 * utm_content 既定は投稿日(YYYYMMDD)。postId / utmContent で上書き可。
 */
export function buildThreadsTextFromBeauty(params: {
  caption?: string;
  body?: string;
  title?: string;
  blogUrl?: string;
  productId?: string;
  productName?: string;
  brand?: string;
  genre?: string;
  /** 投稿前は日付、投稿後に postId を入れる場合はここ */
  utmContent?: string;
  postId?: string;
}): string {
  // 美容 Threads は専用短文テンプレを優先（曖昧な汎用フォールバックを使わない）
  const productName = (params.productName || "").trim();
  const brand = (params.brand || "").trim();
  const genre = (params.genre || "").trim();
  let text = "";
  if (productName || brand) {
    text = softenThreadsBody(
      buildBeautyThreadsBody({
        brand,
        productName,
        genre,
        productId: params.productId,
      }),
    );
  }
  if (!text) {
    const source = (params.caption || params.body || params.title || "").trim();
    if (!source) {
      throw new Error("Threads本文が空です（caption / body / title がありません）");
    }
    text = softenThreadsBody(source);
  }
  if (!text) {
    throw new Error("Threads本文の整形結果が空になりました");
  }

  // 固定導線: 本文 → 固定CTA → UTM付き blogUrl（最終行）
  // 利益化導線: blogUrl が無い Threads 投稿は作らない
  let blogUrl = (params.blogUrl || "").trim();
  // 任意: 固定ハブURL（個別記事よりプロフィール的な導線を優先したいとき）
  const hub = String(process.env.BEAUTY_THREADS_FIXED_BLOG_URL || "").trim();
  if (hub) blogUrl = hub;
  if (!blogUrl) {
    throw new Error(
      "Threads投稿中止: blogUrl がありません（Blogger公開成功後にのみ投稿します）",
    );
  }
  const productId = (params.productId || "").trim();
  if (productId) {
    blogUrl = buildThreadsTrackUrl({
      blogUrl,
      productId,
      postId: params.postId,
      utmContent: params.utmContent,
    });
  }
  let bareBase = blogUrl;
  try {
    const u = new URL(blogUrl);
    bareBase = `${u.origin}${u.pathname}`;
  } catch {
    bareBase = blogUrl.split("?")[0] || blogUrl;
  }
  const cta = threadsFixedCtaLine();
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === blogUrl) return false;
      if (line === cta) return false;
      if (bareBase && (line === bareBase || line.startsWith(`${bareBase}?`))) return false;
      return true;
    })
    .join("\n");
  text = `${text}\n\n${cta}\n${blogUrl}`;
  return normalizeThreadsPostText(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactUrl(url: string): string {
  return url.replace(/access_token=[^&]*/g, "access_token=***");
}

async function postForm(
  label: string,
  url: string,
  fields: Record<string, string>,
  ctx?: { userId?: string },
): Promise<Record<string, unknown>> {
  let lastNetworkErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      });
    } catch (err) {
      lastNetworkErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Threads ${label} ネットワーク再試行 ${attempt}/3: ${msg}`);
      if (attempt < 3) {
        await sleep(2_000 * attempt);
        continue;
      }
      throw new Error(`Threads ${label}失敗: fetch failed (${msg})`);
    }
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json = { raw: raw.slice(0, 500) };
    }

    if (!res.ok) {
      const err = json.error as {
        message?: string;
        code?: number;
        error_subcode?: number;
        error_user_msg?: string;
      } | undefined;
      const detail =
        `HTTP ${res.status}` +
        (err?.code != null ? ` code=${err.code}` : "") +
        (err?.error_subcode != null ? ` subcode=${err.error_subcode}` : "") +
        (err?.message ? ` message=${err.message}` : "") +
        (err?.error_user_msg ? ` user_msg=${err.error_user_msg}` : "") +
        ` url=${redactUrl(url)}` +
        (ctx?.userId ? ` userId=${ctx.userId}` : "") +
        (fields.creation_id ? ` creation_id=${fields.creation_id}` : "") +
        ` body=${raw.slice(0, 400)}`;

      const error = new Error(`Threads ${label}失敗: ${detail}`) as Error & {
        httpStatus?: number;
        apiCode?: number;
      };
      error.httpStatus = res.status;
      error.apiCode = err?.code;

      if (isThreadsAuthFailure(res.status, json)) {
        throw new ThreadsAuthError(
          `[Threads認証] ${label}で認証エラー。再認証が必要です。 ${detail}`,
        );
      }
      throw error;
    }
    return json;
  }
  throw lastNetworkErr instanceof Error
    ? lastNetworkErr
    : new Error(`Threads ${label}失敗: fetch failed`);
}

/**
 * container が publish 可能になるまで待機。
 * 即 publish すると code=24 / subcode=4279009 (Media Not Found) になりやすい。
 */
async function waitForThreadsContainerReady(
  creationId: string,
  creds: ThreadsCredentials,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const base = apiBase(creds.apiVersion);
  const started = Date.now();
  let lastStatus = "";

  while (Date.now() - started < timeoutMs) {
    const url =
      `${base}/${encodeURIComponent(creationId)}` +
      `?fields=status,error_message` +
      `&access_token=${encodeURIComponent(creds.accessToken)}`;
    const res = await fetch(url);
    const raw = await res.text();
    let json: { status?: string; error_message?: string; error?: { message?: string } } = {};
    try {
      json = raw ? (JSON.parse(raw) as typeof json) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      throw new Error(
        `Threads container-status失敗: HTTP ${res.status}` +
          ` creation_id=${creationId} url=${redactUrl(url)} body=${raw.slice(0, 300)}`,
      );
    }
    const status = String(json.status ?? "").toUpperCase();
    if (status && status !== lastStatus) {
      console.log(`Threads container status=${status} creation_id=${creationId}`);
      lastStatus = status;
    }
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        `Threads container 準備失敗: creation_id=${creationId} status=${status}` +
          ` detail=${json.error_message || json.error?.message || ""}`,
      );
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Threads container 準備タイムアウト: creation_id=${creationId} (${timeoutMs}ms) last=${lastStatus || "?"}`,
  );
}

/** 画像なし TEXT を1本投稿。成功時は creationId / postId を返す。 */
export async function publishThreadsTextPost(params: {
  text: string;
  videoUrl?: string;
  /** 自分の投稿への返信（商品リンクカード用）。videoUrl と同時指定不可 */
  replyToId?: string;
  credentials?: ThreadsCredentials;
  /** false で refresh を省略（疎通固定文などで明示指定可）。既定 true */
  refreshToken?: boolean;
}): Promise<ThreadsPublishResult> {
  const text = normalizeThreadsPostText(params.text);
  if (!text) throw new Error("Threads text が空です");

  let creds = params.credentials ?? readThreadsCredentialsFromEnv();
  if (params.refreshToken !== false) {
    try {
      creds = await ensureThreadsAccessToken(creds);
    } catch (err) {
      // refresh 失敗でも、既存 token で投稿を試す（失効判定は API 応答で行う）
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Threads認証] refresh 失敗のため既存tokenで投稿を試行: ${msg}`);
    }
  }

  try {
    creds = await syncThreadsUserIdFromMe(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Threads認証] /me userId 同期失敗（既存 userId で投稿試行）: ${msg}`);
  }

  const base = apiBase(creds.apiVersion);
  const ctx = { userId: creds.userId };
  const videoUrl = String(params.videoUrl || "").trim();
  const replyToId = String(params.replyToId || "").trim();
  if (videoUrl && replyToId) {
    throw new Error("Threads: videoUrl と replyToId は同時に使えません");
  }
  // create / publish とも /me（token 紐づきアカウント）。userId はログ・同期用
  console.log(
    `Threads投稿開始: userId=${creds.userId} chars=${[...text].length}` +
      ` media=${videoUrl ? "VIDEO" : "TEXT"}` +
      `${replyToId ? ` reply_to=${replyToId}` : ""}` +
      ` create=${base}/me/threads publish=${base}/me/threads_publish`,
  );

  const created = await postForm(
    "container作成",
    `${base}/me/threads`,
    videoUrl
      ? {
          media_type: "VIDEO",
          video_url: videoUrl,
          text,
          access_token: creds.accessToken,
        }
      : replyToId
        ? {
            media_type: "TEXT",
            text,
            reply_to_id: replyToId,
            access_token: creds.accessToken,
          }
        : {
            media_type: "TEXT",
            text,
            access_token: creds.accessToken,
          },
    ctx,
  );
  const creationId = String(created.id ?? "").trim();
  if (!creationId) throw new Error("Threads container 応答に id がありません");
  console.log(`Threads creation_id=${creationId}`);

  await waitForThreadsContainerReady(
    creationId,
    creds,
    videoUrl ? { timeoutMs: 300_000, intervalMs: 5_000 } : undefined,
  );

  let published: Record<string, unknown> | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      published = await postForm(
        "publish",
        `${base}/me/threads_publish`,
        {
          creation_id: creationId,
          access_token: creds.accessToken,
        },
        ctx,
      );
      break;
    } catch (err) {
      lastErr = err;
      const apiCode = (err as { apiCode?: number }).apiCode;
      // code=24 Media Not Found は未準備の典型。同一 creation_id で再試行
      if (apiCode === 24 && attempt < 3) {
        console.warn(
          `Threads publish code=24 — 再試行 ${attempt}/3 creation_id=${creationId}`,
        );
        await sleep(3_000 * attempt);
        continue;
      }
      throw err;
    }
  }
  if (!published) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  const postId = String(published.id ?? "").trim();
  if (!postId) throw new Error("Threads publish 応答に id がありません");

  console.log(`Threads投稿成功: post_id=${postId} creation_id=${creationId} userId=${creds.userId}`);
  return { creationId, postId, text };
}

export interface ThreadsMediaSummary {
  id: string;
  text: string;
  timestamp?: string;
  permalink?: string;
}

/**
 * 直近の Threads 投稿を取得（重複判定用）。
 * GET /{user-id}/threads
 */
export async function listRecentThreadsPosts(params?: {
  credentials?: ThreadsCredentials;
  limit?: number;
  refreshToken?: boolean;
}): Promise<ThreadsMediaSummary[]> {
  let creds = params?.credentials ?? readThreadsCredentialsFromEnv();
  if (params?.refreshToken !== false) {
    try {
      creds = await ensureThreadsAccessToken(creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Threads認証] refresh 失敗のため既存tokenで一覧取得: ${msg}`);
    }
  }
  try {
    creds = await syncThreadsUserIdFromMe(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Threads認証] /me 同期失敗（既存 userId で一覧）: ${msg}`);
  }

  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 50);
  const base = apiBase(creds.apiVersion);
  const qs = new URLSearchParams({
    fields: "id,text,timestamp,permalink",
    limit: String(limit),
    access_token: creds.accessToken,
  });
  const url = `${base}/${encodeURIComponent(creds.userId)}/threads?${qs.toString()}`;
  const res = await fetch(url);
  const raw = await res.text();
  let json: {
    data?: Array<{
      id?: string;
      text?: string;
      timestamp?: string;
      permalink?: string;
    }>;
    error?: { message?: string; code?: number };
  } = {};
  try {
    json = raw ? (JSON.parse(raw) as typeof json) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const detail = json.error?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
    if (isThreadsAuthFailure(res.status, json as Record<string, unknown>)) {
      throw new ThreadsAuthError(`[Threads認証] 投稿一覧で認証エラー: ${detail}`);
    }
    throw new Error(`Threads 投稿一覧失敗: ${detail}`);
  }

  return (json.data || [])
    .map((item) => ({
      id: String(item.id || "").trim(),
      text: String(item.text || ""),
      timestamp: item.timestamp,
      permalink: item.permalink,
    }))
    .filter((item) => item.id);
}

/** blogUrl（クエリ無視）が既存 Threads 本文に含まれるか */
export function threadsTextMentionsBlogUrl(
  threadsText: string,
  blogUrl: string,
): boolean {
  const bare = (() => {
    try {
      const u = new URL(blogUrl.trim());
      return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
    } catch {
      return (blogUrl || "").trim().split("?")[0]?.replace(/\/+$/, "") || "";
    }
  })();
  if (!bare) return false;
  const text = threadsText || "";
  if (text.includes(bare)) return true;
  // 末尾スラッシュ有無の揺れ
  if (text.includes(`${bare}/`)) return true;
  return false;
}
