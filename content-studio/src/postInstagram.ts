import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { normalizeCaption } from "./utils/normalizeCaption.ts";

const inputPath = "input/instagram-post.json";
const articlePath = "input/article.json";
const postedPath = "data/posted-beauty.json";
const IMAGE_URL_CHECK_TIMEOUT_MS =
  Number(process.env.IMAGE_URL_CHECK_TIMEOUT_MS ?? "10000") || 10_000;

type InstagramEnv = {
  accessToken: string;
  igUserId: string;
};

/** 必須の Instagram 設定を早い段階で確認する（自動更新はしない） */
function requireInstagramEnv(): InstagramEnv {
  const accessToken = (process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
  const igUserId = (process.env.INSTAGRAM_ACCOUNT_ID ?? "").trim();

  const missing: string[] = [];
  if (!accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN");
  if (!igUserId) missing.push("INSTAGRAM_ACCOUNT_ID");

  if (missing.length > 0) {
    throw new Error(
      `Instagram設定が不足しています: ${missing.join(", ")} が空です。` +
        ` content-studio/.env を確認してください（自動更新はしません）。`,
    );
  }

  const placeholderToken =
    /^(your[_-]?token|changeme|xxx+|placeholder|todo)$/i.test(accessToken) ||
    accessToken.length < 20;
  if (placeholderToken) {
    throw new Error(
      "INSTAGRAM_ACCESS_TOKEN が無効またはプレースホルダの可能性があります。" +
        " Meta Graph API の有効なアクセストークンを .env に設定してください。",
    );
  }

  if (!/^\d+$/.test(igUserId)) {
    throw new Error(
      `INSTAGRAM_ACCOUNT_ID の形式が不正です: "${igUserId}"。` +
        ` Instagramビジネスアカウントの数値IDを設定してください。`,
    );
  }

  return { accessToken, igUserId };
}

const { accessToken, igUserId } = requireInstagramEnv();

const raw = fs.readFileSync(inputPath, "utf-8");
const post = JSON.parse(raw) as {
  imageUrl: string;
  caption: string;
};

type GraphErrorBody = {
  id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

/** Graph API 失敗を、設定値まわりか追いやすい文言にする */
function formatGraphApiFailure(
  step: "media作成" | "publish",
  status: number,
  data: GraphErrorBody,
): string {
  const err = data.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const type = err?.type ?? "";
  const message = err?.message ?? "(messageなし)";
  const parts = [
    `Instagram ${step}に失敗しました (HTTP ${status})`,
    `error.code=${code ?? "不明"}`,
    subcode != null ? `error_subcode=${subcode}` : null,
    type ? `type=${type}` : null,
    `message=${message}`,
  ].filter(Boolean);

  const hints: string[] = [];
  const msgLower = message.toLowerCase();

  // トークン期限切れ・無効
  if (
    code === 190 ||
    subcode === 463 ||
    subcode === 467 ||
    /access token|oauth|session has expired|invalid.*token/i.test(message)
  ) {
    hints.push(
      "原因候補: INSTAGRAM_ACCESS_TOKEN の期限切れ・無効・権限不足。" +
        " Metaでトークンを再発行し .env を更新してください（自動更新なし）。",
    );
  }

  // アカウントID誤り・権限
  if (
    code === 100 ||
    code === 10 ||
    code === 200 ||
    /user id|page id|does not exist|permission|unsupported post request/i.test(message)
  ) {
    hints.push(
      "原因候補: INSTAGRAM_ACCOUNT_ID の誤り、またはトークンにそのアカウントへの投稿権限がない。" +
        " アカウントIDとアプリ権限（instagram_content_publish 等）を確認してください。",
    );
  }

  if (/image|media|url|download|fetch/i.test(msgLower) && hints.length === 0) {
    hints.push(
      "原因候補: imageUrl 側の問題の可能性もあります（公開URL・形式）。設定値もあわせて確認してください。",
    );
  }

  if (hints.length === 0) {
    hints.push(
      "設定確認: INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID が朝時点で有効か、" +
        ".env が run-beauty.sh から読めているかを確認してください。",
    );
  }

  // トークン本体はログに出さない
  parts.push(`設定: ACCOUNT_ID=${igUserId}, TOKEN=設定済(長さ${accessToken.length})`);
  parts.push(...hints);

  return parts.join(" | ");
}

/** 空・ダミー・不正な imageUrl を投稿前に弾く */
function assertImageUrlShape(imageUrl: string): string {
  const url = (imageUrl ?? "").trim();
  if (!url) {
    throw new Error(
      "imageUrl が空です。instagram-post.json / article.json の product.imageUrl を確認してください。",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`imageUrl が不正なURL形式です: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`imageUrl は http(s) である必要があります: ${url}`);
  }

  const host = parsed.hostname.toLowerCase();
  const lower = url.toLowerCase();
  const dummyHost =
    host === "example.com" ||
    host === "www.example.com" ||
    host === "example.org" ||
    host === "example.net" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".example.com");
  const dummyPath =
    /\/(dummy|placeholder|sample|test)([/?#]|$)/i.test(parsed.pathname) ||
    /via\.placeholder|placehold\.it|placekitten|picsum\.photos/i.test(host);
  const dummyText = /ここに画像|your[-_]?image|replace[-_]?me|todo/i.test(lower);

  if (dummyHost || dummyPath || dummyText) {
    throw new Error(
      `imageUrl がダミーURLのため投稿を中止しました: ${url}` +
        `（example / placeholder / localhost などは使えません）`,
    );
  }

  return url;
}

/** Instagram が取得できるか、投稿前に到達確認する */
async function assertImageUrlReachable(imageUrl: string): Promise<void> {
  const tryFetch = async (method: "HEAD" | "GET") => {
    return fetch(imageUrl, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_URL_CHECK_TIMEOUT_MS),
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
    });
  };

  let res: Response;
  try {
    res = await tryFetch("HEAD");
    // 一部CDNはHEAD非対応 → GETで再確認
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await tryFetch("GET");
    }
  } catch (error) {
    const isAbort =
      (error instanceof Error && error.name === "AbortError") ||
      (typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError");
    if (isAbort) {
      throw new Error(
        `imageUrl に到達できませんでした（${IMAGE_URL_CHECK_TIMEOUT_MS / 1000}秒タイムアウト）: ${imageUrl}`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`imageUrl に到達できませんでした: ${imageUrl}（原因: ${detail}）`);
  }

  if (!res.ok) {
    throw new Error(
      `imageUrl が取得できませんでした (HTTP ${res.status}): ${imageUrl}` +
        `。公開URLか、リンク切れでないか確認してください。`,
    );
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
    throw new Error(
      `imageUrl の Content-Type が画像ではありません (${contentType}): ${imageUrl}`,
    );
  }
}

async function createMediaContainer(imageUrl: string) {
  const url = `https://graph.facebook.com/v23.0/${igUserId}/media`;
  // 投稿APIへ渡す直前の最終ゲート
  const caption = normalizeCaption(post.caption || "");
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await res.json()) as GraphErrorBody;
  console.log("media response:", data);

  if (!res.ok || !data.id) {
    throw new Error(formatGraphApiFailure("media作成", res.status, data));
  }

  return data.id;
}

async function publishMedia(creationId: string) {
  const url = `https://graph.facebook.com/v23.0/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await res.json()) as GraphErrorBody;
  console.log("publish response:", data);

  if (!res.ok) {
    throw new Error(formatGraphApiFailure("publish", res.status, data));
  }

  return data;
}

/** 投稿成功後にだけ、選択商品 ID を posted-beauty.json へ記録する */
function markProductAsPosted() {
  try {
    const article = JSON.parse(fs.readFileSync(articlePath, "utf-8")) as {
      product?: { id?: string };
    };
    const productId = article.product?.id?.trim();
    if (!productId) {
      console.warn("article.json に product.id が無いため posted-beauty.json は更新しません");
      return;
    }

    let posted: string[] = [];
    try {
      const rawPosted = fs.readFileSync(postedPath, "utf-8").trim();
      if (rawPosted) posted = JSON.parse(rawPosted) as string[];
    } catch {
      posted = [];
    }

    if (!Array.isArray(posted)) posted = [];
    const updated = [...new Set([...posted, productId])];
    fs.mkdirSync(path.dirname(postedPath), { recursive: true });
    fs.writeFileSync(postedPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
    console.log("posted-beauty.json に記録しました:", productId);
  } catch (error) {
    console.warn("posted-beauty.json の更新に失敗しました:", error);
  }
}

async function main() {
  console.log(
    `Instagram設定確認OK: ACCOUNT_ID=${igUserId}, TOKEN=設定済(長さ${accessToken.length})`,
  );

  const imageUrl = assertImageUrlShape(post.imageUrl);
  await assertImageUrlReachable(imageUrl);
  console.log("imageUrl 確認OK:", imageUrl);

  const creationId = await createMediaContainer(imageUrl);
  console.log("creationId:", creationId);

  await new Promise((r) => setTimeout(r, 5000));

  const result = await publishMedia(creationId);
  console.log("投稿成功:", result);
  markProductAsPosted();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("投稿エラー:", msg);
  process.exit(1);
});
