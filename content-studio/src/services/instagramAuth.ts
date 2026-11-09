/**
 * Instagram Graph API（Facebook Login / graph.facebook.com）向け token 運用。
 * - 投稿は postInstagram.ts が ensureInstagramAccessToken 後に .env の token を使う
 * - 長期化・診断は scripts/save-instagram-long-lived-token.ts / refresh-instagram-token.ts
 *
 * 注意: Facebook Login の長期 USER token は Threads/IG Login と違い、
 * 期限切れ後の無限 refresh はできない。運用の本命は Page token（expires_at=0）。
 */
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_GRAPH_VERSION = "v23.0";

export type InstagramTokenDebug = {
  appId?: string;
  type?: string;
  isValid: boolean;
  expiresAt?: number;
  dataAccessExpiresAt?: number;
  issuedAt?: number;
  scopes?: string[];
  userId?: string;
  /** short-lived | long-lived | never-expires | unknown | invalid */
  kind: "short-lived" | "long-lived" | "never-expires" | "unknown" | "invalid";
  lifetimeDays?: number;
  daysRemaining?: number;
};

/** 専用アカウント系ジャンル（美容 INSTAGRAM_* にフォールバックしない） */
export type DedicatedInstagramGenre = "living" | "gadget" | "food" | "drink";

export function getDedicatedInstagramGenre(): DedicatedInstagramGenre | null {
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

function dedicatedInstagramPrefix(
  genre: DedicatedInstagramGenre,
): "LIVING" | "GADGET" | "FOOD" | "DRINK" {
  if (genre === "drink") return "DRINK";
  if (genre === "food") return "FOOD";
  if (genre === "gadget") return "GADGET";
  return "LIVING";
}

/** living 投稿経路か（shell の CONTENT_PIPELINE_GENRE / POSTED_PRODUCTS_PATH） */
export function shouldUseLivingInstagramEnv(): boolean {
  return getDedicatedInstagramGenre() === "living";
}

export function shouldUseGadgetInstagramEnv(): boolean {
  return getDedicatedInstagramGenre() === "gadget";
}

export function shouldUseFoodInstagramEnv(): boolean {
  return getDedicatedInstagramGenre() === "food";
}

export function shouldUseDrinkInstagramEnv(): boolean {
  return getDedicatedInstagramGenre() === "drink";
}

function applyDedicatedInstagramEnvOverrides(
  genre: DedicatedInstagramGenre,
): void {
  const prefix = dedicatedInstagramPrefix(genre);
  const token = (process.env[`${prefix}_INSTAGRAM_ACCESS_TOKEN`] || "").trim();
  const accountId = (process.env[`${prefix}_INSTAGRAM_ACCOUNT_ID`] || "").trim();
  const pageId = (process.env[`${prefix}_FACEBOOK_PAGE_ID`] || "").trim();
  const preferPage = (
    process.env[`${prefix}_INSTAGRAM_PREFER_PAGE_TOKEN`] || ""
  ).trim();
  const appId = (process.env[`${prefix}_FACEBOOK_APP_ID`] || "").trim();
  const appSecret = (process.env[`${prefix}_FACEBOOK_APP_SECRET`] || "").trim();

  if (!token && !accountId && !pageId) return;

  if (token) process.env.INSTAGRAM_ACCESS_TOKEN = token;
  if (accountId) process.env.INSTAGRAM_ACCOUNT_ID = accountId;
  if (pageId) process.env.FACEBOOK_PAGE_ID = pageId;
  if (preferPage) process.env.INSTAGRAM_PREFER_PAGE_TOKEN = preferPage;
  if (appId) process.env.FACEBOOK_APP_ID = appId;
  if (appSecret) process.env.FACEBOOK_APP_SECRET = appSecret;

  console.log(
    `[Instagram認証] ${genre} 設定を適用: ACCOUNT_ID=${accountId || "(empty)"}` +
      ` PAGE_ID=${pageId || "(unset)"}` +
      ` TOKEN=${token ? `設定済(長さ${token.length})` : "(empty)"}`,
  );
}

/**
 * dotenv 再読込で美容 INSTAGRAM_* に戻ったあと、暮らし用 LIVING_* を共通キーへ載せ直す。
 * LIVING_* が空なら何もしない（美容設定のまま＝run-living 側の警告と対応）。
 */
export function applyLivingInstagramEnvOverrides(): void {
  if (!shouldUseLivingInstagramEnv()) return;
  applyDedicatedInstagramEnvOverrides("living");
}

export function applyGadgetInstagramEnvOverrides(): void {
  if (!shouldUseGadgetInstagramEnv()) return;
  applyDedicatedInstagramEnvOverrides("gadget");
}

export function applyFoodInstagramEnvOverrides(): void {
  if (!shouldUseFoodInstagramEnv()) return;
  applyDedicatedInstagramEnvOverrides("food");
}

export function applyDrinkInstagramEnvOverrides(): void {
  if (!shouldUseDrinkInstagramEnv()) return;
  applyDedicatedInstagramEnvOverrides("drink");
}

export function loadInstagramEnvFromFile(cwd = process.cwd()): string {
  const envPath = path.resolve(cwd, ".env");
  loadDotenv({ path: envPath, override: true });
  applyLivingInstagramEnvOverrides();
  applyGadgetInstagramEnvOverrides();
  applyFoodInstagramEnvOverrides();
  applyDrinkInstagramEnvOverrides();
  return envPath;
}

function graphVersion(): string {
  return (process.env.INSTAGRAM_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION).trim() || DEFAULT_GRAPH_VERSION;
}

function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

function readAppCredentials(): { appId: string; appSecret: string } {
  const appId = (
    process.env.FACEBOOK_APP_ID ||
    process.env.META_APP_ID ||
    process.env.INSTAGRAM_APP_ID ||
    ""
  ).trim();
  const appSecret = (
    process.env.FACEBOOK_APP_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    ""
  ).trim();
  return { appId, appSecret };
}

/** expires_at（unix秒）から種別判定。0/欠落は Page token 等の無期限扱い */
export function classifyFacebookTokenExpiry(expiresAt?: number, issuedAt?: number): InstagramTokenDebug["kind"] {
  if (expiresAt == null) return "unknown";
  if (expiresAt === 0) return "never-expires";
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) return "invalid";
  const lifetimeSec =
    issuedAt && issuedAt > 0 ? expiresAt - issuedAt : expiresAt - now;
  // 短命は数時間。1日未満なら short、それ以上は long（通常 ~60日）
  if (lifetimeSec > 0 && lifetimeSec < 86_400) return "short-lived";
  return "long-lived";
}

/**
 * .env の1キーだけ安全に置換（他キーは触らない）。
 * - 失敗時は元ファイルを残す（tmp 書き込み → rename）
 * - 置換前に `.env.bak-token` へバックアップ
 * Facebook / Threads 横展開用に key を引数で受け取れる。
 */
export function persistEnvKeySafe(
  key: string,
  value: string,
  envPath = path.resolve(".env"),
): void {
  const k = key.trim();
  const v = value.trim();
  if (!k) throw new Error("[env] 空のキーは保存できません");
  if (!v) throw new Error(`[env] 空の ${k} は保存できません`);
  if (!fs.existsSync(envPath)) {
    console.warn(`[env] ${envPath} が無いため ${k} のファイル保存をスキップ`);
    process.env[k] = v;
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const line = `${k}=${v}`;
  const re = new RegExp(`^${k}=.*$`, "m");
  const next = re.test(raw)
    ? raw.replace(re, line)
    : `${raw.replace(/\s*$/, "")}\n${line}\n`;

  const bakPath = `${envPath}.bak-token`;
  const tmpPath = `${envPath}.tmp-token-${process.pid}`;
  try {
    fs.writeFileSync(bakPath, raw, "utf8");
    fs.writeFileSync(tmpPath, next, "utf8");
    fs.renameSync(tmpPath, envPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
  process.env[k] = v;
}

export function persistInstagramAccessToken(newToken: string, envPath = path.resolve(".env")): void {
  const token = newToken.trim();
  if (!token) throw new Error("[Instagram認証] 空の token は保存できません");
  const dedicated = getDedicatedInstagramGenre();
  const prefix = dedicated ? dedicatedInstagramPrefix(dedicated) : null;
  const key = prefix ? `${prefix}_INSTAGRAM_ACCESS_TOKEN` : "INSTAGRAM_ACCESS_TOKEN";
  persistEnvKeySafe(key, token, envPath);
  process.env.INSTAGRAM_ACCESS_TOKEN = token;
  if (prefix) process.env[`${prefix}_INSTAGRAM_ACCESS_TOKEN`] = token;
  console.log(
    `[Instagram認証] .env の ${key} を更新しました（.bak-token 退避済み）`,
  );
}

/** debug_token で有効期限・種別を確認（app token があればより安定） */
export async function debugInstagramAccessToken(
  accessToken?: string,
): Promise<InstagramTokenDebug> {
  const token = (accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
  if (!token) throw new Error("[Instagram認証] INSTAGRAM_ACCESS_TOKEN が空です");

  const { appId, appSecret } = readAppCredentials();
  const appAccessToken =
    appId && appSecret ? `${appId}|${appSecret}` : token;

  const url =
    `${graphBase()}/debug_token` +
    `?input_token=${encodeURIComponent(token)}` +
    `&access_token=${encodeURIComponent(appAccessToken)}`;
  const res = await fetch(url);
  const raw = await res.text();
  let json: {
    data?: {
      app_id?: string;
      type?: string;
      is_valid?: boolean;
      expires_at?: number;
      data_access_expires_at?: number;
      issued_at?: number;
      scopes?: string[];
      user_id?: string;
    };
    error?: { message?: string };
  } = {};
  try {
    json = raw ? (JSON.parse(raw) as typeof json) : {};
  } catch {
    json = { error: { message: raw.slice(0, 200) } };
  }
  if (!res.ok || !json.data) {
    throw new Error(
      `[Instagram認証] debug_token 失敗: HTTP ${res.status}` +
        (json.error?.message ? ` message=${json.error.message}` : ` body=${raw.slice(0, 200)}`),
    );
  }

  const d = json.data;
  const now = Math.floor(Date.now() / 1000);
  const kind = d.is_valid === false
    ? "invalid"
    : classifyFacebookTokenExpiry(d.expires_at, d.issued_at);
  const lifetimeDays =
    d.expires_at && d.issued_at && d.expires_at > 0
      ? (d.expires_at - d.issued_at) / 86_400
      : undefined;
  const daysRemaining =
    d.expires_at && d.expires_at > 0 ? (d.expires_at - now) / 86_400 : undefined;

  return {
    appId: d.app_id,
    type: d.type,
    isValid: Boolean(d.is_valid),
    expiresAt: d.expires_at,
    dataAccessExpiresAt: d.data_access_expires_at,
    issuedAt: d.issued_at,
    scopes: d.scopes,
    userId: d.user_id,
    kind,
    lifetimeDays,
    daysRemaining,
  };
}

/**
 * 短命 User token → 長期 User token（約60日）。
 * GET /oauth/access_token?grant_type=fb_exchange_token
 */
export async function exchangeFacebookShortLivedForLongLived(params: {
  shortLivedToken: string;
  appId?: string;
  appSecret?: string;
}): Promise<{ accessToken: string; expiresIn?: number; kind: InstagramTokenDebug["kind"] }> {
  const { appId: envId, appSecret: envSecret } = readAppCredentials();
  const appId = (params.appId ?? envId).trim();
  const appSecret = (params.appSecret ?? envSecret).trim();
  const shortLivedToken = params.shortLivedToken.trim();
  if (!appId || !appSecret || !shortLivedToken) {
    throw new Error(
      "[Instagram認証] 長期交換には FACEBOOK_APP_ID / FACEBOOK_APP_SECRET と短命tokenが必要です",
    );
  }

  const url =
    `${graphBase()}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

  const res = await fetch(url);
  const raw = await res.text();
  let json: {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: { message?: string };
  } = {};
  try {
    json = raw ? (JSON.parse(raw) as typeof json) : {};
  } catch {
    json = { error: { message: raw.slice(0, 200) } };
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `[Instagram認証] fb_exchange_token 失敗: ` +
        (json.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`),
    );
  }

  const expiresIn = json.expires_in;
  const kind =
    expiresIn == null
      ? "unknown"
      : expiresIn < 86_400
        ? "short-lived"
        : "long-lived";
  if (kind === "short-lived") {
    throw new Error(
      `[Instagram認証] 長期交換なのに expires_in=${expiresIn}（短命相当）。.env に保存しないでください`,
    );
  }
  return { accessToken: json.access_token, expiresIn, kind };
}

export type FacebookPageRow = {
  id: string;
  name?: string;
  accessToken?: string;
  tasks?: string[];
  instagramBusinessAccountId?: string;
  instagramBusinessUsername?: string;
  connectedInstagramAccountId?: string;
  connectedInstagramUsername?: string;
};

export type ListFacebookPagesResult = {
  pages: FacebookPageRow[];
  /** /me/accounts が空のとき true（Business Suite 配下 Page でよく起きる） */
  emptyAccounts: boolean;
  hint?: string;
};

type AccountsApiPage = {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id?: string; username?: string };
  connected_instagram_account?: { id?: string; username?: string };
};

function linkedIgIds(page: FacebookPageRow): string[] {
  return [page.instagramBusinessAccountId, page.connectedInstagramAccountId]
    .map((v) => (v || "").trim())
    .filter(Boolean);
}

async function fetchJson(
  url: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; raw: string }> {
  const res = await fetch(url);
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { raw: raw.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, json, raw };
}

/** /me/accounts をページング取得（IG 連携フィールド両系統） */
export async function listFacebookPagesForUser(
  userAccessToken: string,
): Promise<ListFacebookPagesResult> {
  const fields = [
    "id",
    "name",
    "access_token",
    "tasks",
    "instagram_business_account{id,username}",
    "connected_instagram_account{id,username}",
  ].join(",");

  const pages: FacebookPageRow[] = [];
  let nextUrl: string | null =
    `${graphBase()}/me/accounts` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=50` +
    `&access_token=${encodeURIComponent(userAccessToken)}`;

  while (nextUrl) {
    const { ok, status, json, raw } = await fetchJson(nextUrl);
    if (!ok) {
      throw new Error(
        `[Instagram認証] /me/accounts 失敗: HTTP ${status} ` +
          String((json.error as { message?: string } | undefined)?.message || raw.slice(0, 200)),
      );
    }
    const data = (json.data as AccountsApiPage[] | undefined) ?? [];
    for (const p of data) {
      if (!p.id) continue;
      pages.push({
        id: p.id,
        name: p.name,
        accessToken: p.access_token,
        tasks: p.tasks,
        instagramBusinessAccountId: p.instagram_business_account?.id,
        instagramBusinessUsername: p.instagram_business_account?.username,
        connectedInstagramAccountId: p.connected_instagram_account?.id,
        connectedInstagramUsername: p.connected_instagram_account?.username,
      });
    }
    const paging = json.paging as { next?: string } | undefined;
    nextUrl = paging?.next?.trim() || null;
  }

  // list 上で IG が空の Page は、Page token で詳細を取り直す
  for (const page of pages) {
    if (linkedIgIds(page).length > 0 || !page.accessToken) continue;
    const detailUrl =
      `${graphBase()}/${encodeURIComponent(page.id)}` +
      `?fields=${encodeURIComponent(
        "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}",
      )}` +
      `&access_token=${encodeURIComponent(page.accessToken)}`;
    try {
      const { ok, json } = await fetchJson(detailUrl);
      if (!ok) continue;
      const iba = json.instagram_business_account as { id?: string; username?: string } | undefined;
      const cia = json.connected_instagram_account as { id?: string; username?: string } | undefined;
      page.instagramBusinessAccountId = iba?.id || page.instagramBusinessAccountId;
      page.instagramBusinessUsername = iba?.username || page.instagramBusinessUsername;
      page.connectedInstagramAccountId = cia?.id || page.connectedInstagramAccountId;
      page.connectedInstagramUsername = cia?.username || page.connectedInstagramUsername;
    } catch {
      /* ignore per-page detail failures */
    }
  }

  const emptyAccounts = pages.length === 0;
  const hint = emptyAccounts
    ? " /me/accounts が空です。Business Suite 配下の Page は pages_show_list だけでは出ず、" +
      "business_management 権限付きで再認可が必要なことが多いです。" +
      " または .env に FACEBOOK_PAGE_ID を入れて直接取得してください。"
    : undefined;

  return { pages, emptyAccounts, hint };
}

/**
 * 既知の Page ID から Page token を取る（/me/accounts が空のときのフォールバック）。
 * Business Suite の Page ID を FACEBOOK_PAGE_ID に入れる想定。
 */
export async function fetchPageTokenByPageId(params: {
  userAccessToken: string;
  pageId: string;
  igAccountId?: string;
}): Promise<{ pageId: string; pageName?: string; accessToken: string } | null> {
  const pageId = params.pageId.trim();
  if (!pageId) return null;

  const url =
    `${graphBase()}/${encodeURIComponent(pageId)}` +
    `?fields=${encodeURIComponent(
      "id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}",
    )}` +
    `&access_token=${encodeURIComponent(params.userAccessToken)}`;
  const { ok, status, json, raw } = await fetchJson(url);
  if (!ok) {
    throw new Error(
      `[Instagram認証] Page直接取得失敗 page=${pageId}: HTTP ${status} ` +
        String((json.error as { message?: string } | undefined)?.message || raw.slice(0, 200)),
    );
  }

  const accessToken = String(json.access_token ?? "").trim();
  if (!accessToken) return null;

  const igAccountId = (params.igAccountId ?? process.env.INSTAGRAM_ACCOUNT_ID ?? "").trim();
  if (igAccountId) {
    const iba = json.instagram_business_account as { id?: string } | undefined;
    const cia = json.connected_instagram_account as { id?: string } | undefined;
    const linked = [iba?.id, cia?.id].map((v) => (v || "").trim()).filter(Boolean);
    if (linked.length > 0 && !linked.includes(igAccountId)) {
      console.warn(
        `[Instagram認証] FACEBOOK_PAGE_ID=${pageId} の IG 連携が INSTAGRAM_ACCOUNT_ID と不一致` +
          ` linked=${linked.join(",")} expected=${igAccountId}（続行して Page token は返す）`,
      );
    }
  }

  return {
    pageId: String(json.id ?? pageId),
    pageName: typeof json.name === "string" ? json.name : undefined,
    accessToken,
  };
}

/**
 * 長期 User token から、INSTAGRAM_ACCOUNT_ID に紐づく Page token を取得。
 * Page token（長期User由来）は実質無期限になりやすい。
 */
export async function fetchPageTokenForInstagramAccount(params: {
  userAccessToken: string;
  igAccountId?: string;
  /** true で照合過程を詳細ログ */
  verbose?: boolean;
}): Promise<{ pageId: string; pageName?: string; accessToken: string } | null> {
  const igAccountId = (
    params.igAccountId ??
    process.env.INSTAGRAM_ACCOUNT_ID ??
    ""
  ).trim();
  if (!igAccountId) {
    throw new Error("[Instagram認証] INSTAGRAM_ACCOUNT_ID が必要です");
  }

  const manualPageId = (
    process.env.FACEBOOK_PAGE_ID ||
    process.env.INSTAGRAM_FACEBOOK_PAGE_ID ||
    ""
  ).trim();
  if (manualPageId) {
    if (params.verbose) {
      console.log(`[page] FACEBOOK_PAGE_ID=${manualPageId} で直接取得を試行`);
    }
    const direct = await fetchPageTokenByPageId({
      userAccessToken: params.userAccessToken,
      pageId: manualPageId,
      igAccountId,
    });
    if (direct) return direct;
  }

  const listed = await listFacebookPagesForUser(params.userAccessToken);
  if (params.verbose) {
    console.log(`[page] /me/accounts count=${listed.pages.length}`);
    for (const p of listed.pages) {
      console.log(
        `  - page=${p.id} name=${p.name ?? "?"}` +
          ` iba=${p.instagramBusinessAccountId ?? "-"}` +
          ` cia=${p.connectedInstagramAccountId ?? "-"}` +
          ` token=${p.accessToken ? "yes" : "no"}`,
      );
    }
    if (listed.hint) console.warn(`[page]${listed.hint}`);
  }

  if (listed.emptyAccounts) {
    throw new Error(
      "[Instagram認証] /me/accounts が空のため Page token を取得できません。" +
        " 原因候補: Business Suite 配下 Page なのに business_management 未付与。" +
        " 対処: business_management を含む再認可、または FACEBOOK_PAGE_ID を .env に設定。" +
        " 診断: npx tsx scripts/diagnose-instagram-pages.ts",
    );
  }

  const hit = listed.pages.find((p) => linkedIgIds(p).includes(igAccountId));
  if (!hit?.accessToken) {
    if (params.verbose) {
      console.warn(
        `[page] INSTAGRAM_ACCOUNT_ID=${igAccountId} に一致する Page なし` +
          `（instagram_business_account / connected_instagram_account 両方を照合済み）`,
      );
    }
    return null;
  }

  return {
    pageId: hit.id,
    pageName: hit.name,
    accessToken: hit.accessToken,
  };
}

/** Page↔IG 連携の診断用スナップショット */
export async function diagnoseInstagramPageLinks(params?: {
  userAccessToken?: string;
  igAccountId?: string;
}): Promise<{
  igAccountId: string;
  permissions: Array<{ permission?: string; status?: string }>;
  pages: FacebookPageRow[];
  emptyAccounts: boolean;
  matchPageId?: string;
  hint?: string;
}> {
  loadInstagramEnvFromFile();
  const token = (params?.userAccessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
  const igAccountId = (params?.igAccountId ?? process.env.INSTAGRAM_ACCOUNT_ID ?? "").trim();
  if (!token) throw new Error("[Instagram認証] INSTAGRAM_ACCESS_TOKEN が空です");

  const permUrl = `${graphBase()}/me/permissions?access_token=${encodeURIComponent(token)}`;
  const permRes = await fetchJson(permUrl);
  const permissions =
    (permRes.json.data as Array<{ permission?: string; status?: string }> | undefined) ?? [];

  const listed = await listFacebookPagesForUser(token);
  const match = listed.pages.find((p) => linkedIgIds(p).includes(igAccountId));

  return {
    igAccountId,
    permissions,
    pages: listed.pages,
    emptyAccounts: listed.emptyAccounts,
    matchPageId: match?.id,
    hint: listed.hint,
  };
}

export type EnsureInstagramAccessTokenResult = {
  accessToken: string;
  debug: InstagramTokenDebug;
  action: "none" | "exchanged" | "page-token" | "skipped-no-secret" | "unchanged";
};

function preferPageTokenFromEnv(): boolean {
  return (process.env.INSTAGRAM_PREFER_PAGE_TOKEN ?? "").trim().toLowerCase() === "true";
}

function renewThresholdDays(): number {
  const n = Number(process.env.INSTAGRAM_TOKEN_RENEW_DAYS ?? "14");
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/**
 * 投稿前・定期ジョブ共用の token 確保。
 * - 短命 → fb_exchange_token で長期化して .env 保存
 * - 長期で残日数が閾値以下 → 延長を試行（成功時のみ保存）
 * - INSTAGRAM_PREFER_PAGE_TOKEN=true → Page token 化を優先（無期限寄り）
 * - App ID/Secret が無い場合は既存 token のまま続行（投稿は壊さない）
 */
export async function ensureInstagramAccessToken(opts?: {
  renewIfDaysRemainingBelow?: number;
  preferPageToken?: boolean;
  /** true なら残日数に関わらず交換を試す（定期ジョブ向け） */
  forceExchange?: boolean;
}): Promise<EnsureInstagramAccessTokenResult> {
  loadInstagramEnvFromFile();
  let accessToken = (process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) {
    throw new Error("[Instagram認証] INSTAGRAM_ACCESS_TOKEN が空です");
  }

  let debug = await debugInstagramAccessToken(accessToken);
  if (!debug.isValid || debug.kind === "invalid") {
    throw new Error(
      "[Instagram認証] token が無効です。Graph API Explorer 等で取り直し、長期化して .env を更新してください",
    );
  }

  const preferPage = opts?.preferPageToken ?? preferPageTokenFromEnv();
  const threshold = opts?.renewIfDaysRemainingBelow ?? renewThresholdDays();
  const forceExchange = Boolean(opts?.forceExchange);
  const { appId, appSecret } = readAppCredentials();

  // 本命: Page token（無期限寄り）へ一度寄せる
  if (preferPage && debug.kind !== "never-expires") {
    if (!appId || !appSecret) {
      console.warn(
        "[Instagram認証] Page token 化スキップ: FACEBOOK_APP_ID / FACEBOOK_APP_SECRET 未設定",
      );
    } else {
      try {
        // Page 取得前に短期なら先に長期 User へ
        let userToken = accessToken;
        if (debug.kind === "short-lived") {
          const exchanged = await exchangeFacebookShortLivedForLongLived({
            shortLivedToken: accessToken,
            appId,
            appSecret,
          });
          userToken = exchanged.accessToken;
        }
        const page = await fetchPageTokenForInstagramAccount({
          userAccessToken: userToken,
        });
        if (page?.accessToken) {
          persistInstagramAccessToken(page.accessToken);
          accessToken = page.accessToken;
          debug = await debugInstagramAccessToken(accessToken);
          console.log(
            `[Instagram認証] Page token を保存しました page=${page.pageId}` +
              (page.pageName ? ` name=${page.pageName}` : "") +
              ` kind=${debug.kind}`,
          );
          return { accessToken, debug, action: "page-token" };
        }
        console.warn(
          "[Instagram認証] 紐づく Page token が見つかりません（pages_show_list / Page↔IG 連携を確認）",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Instagram認証] Page token 化失敗（既存tokenで続行）: ${msg}`);
      }
    }
  }

  if (debug.kind === "never-expires") {
    return { accessToken, debug, action: "none" };
  }

  const needsRenew =
    debug.kind === "short-lived" ||
    forceExchange ||
    (debug.kind === "long-lived" &&
      debug.daysRemaining != null &&
      debug.daysRemaining <= threshold);

  if (!needsRenew) {
    return { accessToken, debug, action: "unchanged" };
  }

  if (!appId || !appSecret) {
    console.warn(
      `[Instagram認証] 更新スキップ: FACEBOOK_APP_ID / FACEBOOK_APP_SECRET 未設定` +
        ` kind=${debug.kind}` +
        (debug.daysRemaining != null
          ? ` remaining≈${debug.daysRemaining.toFixed(1)}d`
          : ""),
    );
    return { accessToken, debug, action: "skipped-no-secret" };
  }

  try {
    const exchanged = await exchangeFacebookShortLivedForLongLived({
      shortLivedToken: accessToken,
      appId,
      appSecret,
    });
    // 期限が伸びた／短命から長期になった場合のみ保存
    const nextDebug = await debugInstagramAccessToken(exchanged.accessToken);
    const improved =
      debug.kind === "short-lived" ||
      (nextDebug.daysRemaining ?? 0) > (debug.daysRemaining ?? 0) + 1 ||
      exchanged.accessToken !== accessToken;
    if (improved) {
      persistInstagramAccessToken(exchanged.accessToken);
      console.log(
        `[Instagram認証] token を更新しました kind=${nextDebug.kind}` +
          (nextDebug.daysRemaining != null
            ? ` remaining≈${nextDebug.daysRemaining.toFixed(1)}d`
            : ""),
      );
      return {
        accessToken: exchanged.accessToken,
        debug: nextDebug,
        action: "exchanged",
      };
    }
    console.log("[Instagram認証] 交換結果を保存せず（残日数の改善なし）");
    return { accessToken, debug, action: "unchanged" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.kind === "short-lived") throw err;
    console.warn(
      `[Instagram認証] 延長失敗（既存tokenで続行）。` +
        ` Facebook 長期USERは再ログインが必要な場合があります: ${msg}`,
    );
    return { accessToken, debug, action: "unchanged" };
  }
}
