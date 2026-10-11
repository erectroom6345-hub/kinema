/**
 * Threads コメント取得・定型自動返信（service 層）
 * - 検知はポーリング（Webhook は別途公開URLが必要）
 * - 投稿フローとは独立。失敗しても throw せず結果に残す選択は呼び出し側
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureThreadsAccessToken,
  loadThreadsEnvFromFile,
  readThreadsCredentialsFromEnv,
  syncThreadsUserIdFromMe,
  type ThreadsCredentials,
  ThreadsAuthError,
} from "./threads.ts";

const DEFAULT_API_VERSION = "v1.0";
const REPLIED_PATH = path.resolve("data", "threads-replied.json");

export type ThreadsReplyItem = {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  is_reply_owned_by_me?: boolean;
};

export type AutoReplyResult = {
  scannedPosts: number;
  scannedReplies: number;
  replied: Array<{ replyId: string; postId: string; creationId?: string }>;
  skipped: Array<{ replyId: string; reason: string }>;
  errors: Array<{ replyId?: string; message: string }>;
};

function apiBase(apiVersion?: string): string {
  const ver =
    (apiVersion || process.env.THREADS_API_VERSION || DEFAULT_API_VERSION).trim() ||
    DEFAULT_API_VERSION;
  return `https://graph.threads.net/${ver}`;
}

function isAutoReplyEnabled(): boolean {
  return (process.env.THREADS_AUTO_REPLY ?? "").trim().toLowerCase() === "true";
}

const DEFAULT_REPLY_TEXTS = [
  "ありがとうございます。うれしいです。",
  "見てくださって嬉しいです。また遊びにきてくださいね。",
  "コメントありがとうございます。励みになります。",
  "ありがとうございます。またゆっくり見にきてください。",
  "うれしいコメントです。また寄ってくださいね。",
];

/** たまにだけ付ける絵文字（最大1個） */
const REPLY_EMOJI_POOL = ["🌸", "🌿", "✨"];
const REPLY_EMOJI_CHANCE = 0.25;

function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** カンマ区切り。空/未設定ならキーワード条件なし（全件対象） */
function replyKeywords(): string[] {
  return splitCsv(process.env.THREADS_REPLY_KEYWORDS ?? "");
}

/** THREADS_REPLY_NG_KEYWORDS 優先。旧 THREADS_REPLY_NG_WORDS も可 */
function ngWords(): string[] {
  const raw = (
    process.env.THREADS_REPLY_NG_KEYWORDS ||
    process.env.THREADS_REPLY_NG_WORDS ||
    ""
  ).trim();
  const defaults = ["死ね", "殺す", "詐欺", "クソ", "馬鹿", "バカ", "ゴミ"];
  if (!raw) return defaults;
  return splitCsv(raw);
}

function replyTextCandidates(): string[] {
  // 複数文: パイプ区切り（推奨）
  const multi = (process.env.THREADS_AUTO_REPLY_TEXTS ?? "").trim();
  if (multi) {
    const list = multi
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  // 単一文（後方互換）
  const single = (process.env.THREADS_AUTO_REPLY_TEXT ?? "").trim();
  if (single) return [single];
  return DEFAULT_REPLY_TEXTS;
}

function stripTrailingEmoji(text: string): string {
  return text.replace(/\s*[\p{Extended_Pictographic}\uFE0F]+$/u, "").trimEnd();
}

/** 同じ意図の文面から1つ選び、たまにだけ絵文字を1個付ける */
export function pickReplyText(): string {
  const candidates = replyTextCandidates();
  const base = stripTrailingEmoji(
    candidates[Math.floor(Math.random() * candidates.length)] || DEFAULT_REPLY_TEXTS[0],
  );
  const alreadyHasEmoji = /[\p{Extended_Pictographic}]/u.test(base);
  if (alreadyHasEmoji || Math.random() >= REPLY_EMOJI_CHANCE) {
    return base;
  }
  const emoji = REPLY_EMOJI_POOL[Math.floor(Math.random() * REPLY_EMOJI_POOL.length)];
  return `${base}${emoji}`;
}

function loadRepliedIds(): Set<string> {
  try {
    if (!fs.existsSync(REPLIED_PATH)) return new Set();
    const raw = JSON.parse(fs.readFileSync(REPLIED_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((id) => String(id)));
  } catch {
    return new Set();
  }
}

function saveRepliedIds(ids: Set<string>): void {
  fs.mkdirSync(path.dirname(REPLIED_PATH), { recursive: true });
  fs.writeFileSync(
    REPLIED_PATH,
    `${JSON.stringify([...ids].sort(), null, 2)}\n`,
    "utf8",
  );
}

async function threadsGet(
  url: string,
  label: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const err = json.error as { message?: string; code?: number } | undefined;
    throw new Error(
      `[Threads返信] ${label}失敗 HTTP ${res.status}` +
        (err?.code != null ? ` code=${err.code}` : "") +
        (err?.message ? ` message=${err.message}` : ` body=${raw.slice(0, 200)}`),
    );
  }
  return json;
}

async function threadsPostForm(
  label: string,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const err = json.error as {
      message?: string;
      code?: number;
      error_subcode?: number;
    } | undefined;
    const error = new Error(
      `[Threads返信] ${label}失敗 HTTP ${res.status}` +
        (err?.code != null ? ` code=${err.code}` : "") +
        (err?.error_subcode != null ? ` subcode=${err.error_subcode}` : "") +
        (err?.message ? ` message=${err.message}` : ` body=${raw.slice(0, 200)}`),
    ) as Error & { httpStatus?: number; apiCode?: number };
    error.httpStatus = res.status;
    error.apiCode = err?.code;
    throw error;
  }
  return json;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * container が publish 可能になるまで待機。
 * 即 publish すると code=24 Media Not Found になりやすい。
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

  while (Date.now() - started < timeoutMs) {
    const url =
      `${base}/${encodeURIComponent(creationId)}` +
      `?fields=status,error_message` +
      `&access_token=${encodeURIComponent(creds.accessToken)}`;
    const json = await threadsGet(url, `container-status(${creationId})`);
    const status = String(json.status ?? "").toUpperCase();
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      const errMsg = String(json.error_message ?? status);
      throw new Error(
        `[Threads返信] container 準備失敗 creation_id=${creationId} status=${status} detail=${errMsg}`,
      );
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `[Threads返信] container 準備タイムアウト creation_id=${creationId} (${timeoutMs}ms)`,
  );
}

/** 直近の自投稿 ID 一覧（公式例どおり /me/threads。誤った USER_ID でも落ちない） */
export async function listRecentOwnThreads(
  creds: ThreadsCredentials,
  limit = 5,
): Promise<string[]> {
  const base = apiBase(creds.apiVersion);
  const url =
    `${base}/me/threads` +
    `?fields=id,text,timestamp` +
    `&limit=${Math.max(1, Math.min(limit, 20))}` +
    `&access_token=${encodeURIComponent(creds.accessToken)}`;
  const json = await threadsGet(url, "自投稿一覧");
  const data = (json.data as Array<{ id?: string }> | undefined) ?? [];
  return data.map((item) => String(item.id || "").trim()).filter(Boolean);
}

/** 投稿へのトップレベル返信を取得 */
export async function listTopLevelReplies(
  mediaId: string,
  creds: ThreadsCredentials,
): Promise<ThreadsReplyItem[]> {
  const base = apiBase(creds.apiVersion);
  const fields = "id,text,username,timestamp,is_reply_owned_by_me";
  const url =
    `${base}/${encodeURIComponent(mediaId)}/replies` +
    `?fields=${fields}&reverse=true` +
    `&access_token=${encodeURIComponent(creds.accessToken)}`;
  const json = await threadsGet(url, `replies(${mediaId})`);
  const data = (json.data as ThreadsReplyItem[] | undefined) ?? [];
  return data.filter((item) => item?.id);
}

/**
 * コメント（返信メディア）へ TEXT 返信。
 * - reply_to_id には投稿IDではなく、GET /{media-id}/replies のコメント id を渡す
 * - container 作成後、status=FINISHED を待ってから threads_publish（即 publish は code=24 になりやすい）
 */
export async function publishReplyToComment(params: {
  replyToId: string;
  text: string;
  creds: ThreadsCredentials;
}): Promise<{ creationId: string; replyMediaId: string }> {
  const base = apiBase(params.creds.apiVersion);
  const text = params.text.trim();
  if (!text) throw new Error("[Threads返信] 返信本文が空です");

  // POST https://graph.threads.net/v1.0/me/threads
  // body: media_type=TEXT&text=...&reply_to_id=<コメントID>&access_token=...
  const created = await threadsPostForm(
    "reply-container",
    `${base}/me/threads`,
    {
      media_type: "TEXT",
      text,
      reply_to_id: params.replyToId,
      access_token: params.creds.accessToken,
    },
  );
  const creationId = String(created.id ?? "").trim();
  if (!creationId) throw new Error("[Threads返信] container id がありません");

  await waitForThreadsContainerReady(creationId, params.creds);

  // POST https://graph.threads.net/v1.0/me/threads_publish
  // body: creation_id=<container id>&access_token=...
  let published: Record<string, unknown> | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      published = await threadsPostForm(
        "reply-publish",
        `${base}/me/threads_publish`,
        {
          creation_id: creationId,
          access_token: params.creds.accessToken,
        },
      );
      break;
    } catch (err) {
      lastErr = err;
      const apiCode = (err as { apiCode?: number }).apiCode;
      // code=24 Media Not Found は container 未準備の典型。待って同一 creation_id で再試行
      if (apiCode === 24 && attempt < 3) {
        await sleep(3_000 * attempt);
        continue;
      }
      throw err;
    }
  }
  if (!published) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  const replyMediaId = String(published.id ?? "").trim();
  if (!replyMediaId) throw new Error("[Threads返信] publish id がありません");
  return { creationId, replyMediaId };
}

export function shouldAutoReply(text: string): { ok: boolean; reason?: string } {
  const body = (text || "").trim();
  if (!body) return { ok: false, reason: "空コメント" };

  const ng = ngWords();
  for (const word of ng) {
    if (word && body.includes(word)) {
      return { ok: false, reason: `NGワード:${word}` };
    }
  }

  const keywords = replyKeywords();
  // キーワード未設定時は条件なしで返信対象。1件以上あるときだけ一致判定。
  if (keywords.length > 0) {
    const hit = keywords.some((kw) => body.includes(kw));
    if (!hit) return { ok: false, reason: "条件キーワード不一致" };
  }

  // 長文スパムっぽいものはスキップ
  if ([...body].length > 280) return { ok: false, reason: "長すぎる" };

  return { ok: true };
}

/**
 * 直近投稿のコメントをポーリングし、条件一致のみ定型返信。
 * 個別失敗は errors に溜め、全体 throw しない。
 */
export async function pollAndAutoReply(params?: {
  credentials?: ThreadsCredentials;
  postLimit?: number;
  /** 追加で見る投稿ID（例: 直前の投稿） */
  extraMediaIds?: string[];
}): Promise<AutoReplyResult> {
  const result: AutoReplyResult = {
    scannedPosts: 0,
    scannedReplies: 0,
    replied: [],
    skipped: [],
    errors: [],
  };

  if (!isAutoReplyEnabled() && process.env.THREADS_AUTO_REPLY_FORCE !== "true") {
    console.log(
      "[Threads返信] スキップ: THREADS_AUTO_REPLY!=true（強制は THREADS_AUTO_REPLY_FORCE=true）",
    );
    return result;
  }

  loadThreadsEnvFromFile();

  let creds = params?.credentials ?? readThreadsCredentialsFromEnv();
  try {
    creds = await ensureThreadsAccessToken(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Threads返信] refresh 失敗のため続行: ${msg}`);
  }
  try {
    creds = await syncThreadsUserIdFromMe(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Threads返信] userId 同期失敗のため続行: ${msg}`);
  }

  const repliedIds = loadRepliedIds();
  console.log("[Threads返信] 開始");

  let mediaIds: string[] = [];
  try {
    mediaIds = await listRecentOwnThreads(creds, params?.postLimit ?? 5);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push({ message: msg });
    console.error(`[Threads返信] 自投稿一覧の取得失敗: ${msg}`);
    return result;
  }

  for (const extra of params?.extraMediaIds ?? []) {
    const id = extra.trim();
    if (id && !mediaIds.includes(id)) mediaIds.unshift(id);
  }

  // last-threads-publish.json も候補に
  try {
    const lastPath = path.resolve("output", "last-threads-publish.json");
    if (fs.existsSync(lastPath)) {
      const last = JSON.parse(fs.readFileSync(lastPath, "utf8")) as { post_id?: string };
      const id = (last.post_id || "").trim();
      if (id && !mediaIds.includes(id)) mediaIds.unshift(id);
    }
  } catch {
    /* ignore */
  }

  result.scannedPosts = mediaIds.length;
  console.log(`[Threads返信] 対象投稿数=${mediaIds.length}`);

  for (const mediaId of mediaIds) {
    let replies: ThreadsReplyItem[] = [];
    try {
      replies = await listTopLevelReplies(mediaId, creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ message: `${mediaId}: ${msg}` });
      console.error(`[Threads返信] 取得失敗 media=${mediaId}:`, msg);
      continue;
    }

    for (const reply of replies) {
      result.scannedReplies += 1;
      const replyId = reply.id;

      if (reply.is_reply_owned_by_me) {
        result.skipped.push({ replyId, reason: "自分の返信" });
        continue;
      }
      if (repliedIds.has(replyId)) {
        result.skipped.push({ replyId, reason: "返信済み" });
        continue;
      }

      const decision = shouldAutoReply(reply.text || "");
      if (!decision.ok) {
        result.skipped.push({ replyId, reason: decision.reason || "スキップ" });
        continue;
      }

      try {
        const replyText = pickReplyText();
        const published = await publishReplyToComment({
          replyToId: replyId,
          text: replyText,
          creds,
        });
        repliedIds.add(replyId);
        saveRepliedIds(repliedIds);
        result.replied.push({
          replyId,
          postId: published.replyMediaId,
          creationId: published.creationId,
        });
        console.log(
          `[Threads返信] 成功 replyId=${replyId} post_id=${published.replyMediaId} text=${replyText}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ replyId, message: msg });
        console.error(`[Threads返信] 失敗 replyId=${replyId}:`, msg);
        if (err instanceof ThreadsAuthError) {
          // 認証切れは以降も失敗しやすいので打ち切り
          break;
        }
      }
    }
  }

  console.log(
    `[Threads返信] 完了 scannedPosts=${result.scannedPosts} scannedReplies=${result.scannedReplies} replied=${result.replied.length} errors=${result.errors.length}`,
  );
  return result;
}
