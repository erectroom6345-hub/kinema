/**
 * living / gadget 向け X（Twitter）投稿 — OAuth 1.0a User Context。
 * - 本文は instagram-post.json の xText（なければ短文を組み立て）
 * - X_ENABLED=true かつ OAuth 1.0a 4点が揃うときだけ投稿
 * - 未設定時はプレビューのみ（exit 0）
 *
 * .env（ジャンル専用）:
 *   LIVING_X_* / GADGET_X_*（ENABLED / API_KEY / API_SECRET / ACCESS_TOKEN / ACCESS_TOKEN_SECRET）
 */
import "dotenv/config";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { describeUtm } from "./utils/utm.ts";

const articlePath = "input/article.json";
const instaPath = "input/instagram-post.json";
const TWEET_URL = "https://api.twitter.com/2/tweets";

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

type DedicatedXGenre = "living" | "gadget" | "food" | "drink";

function getDedicatedXGenre(): DedicatedXGenre | null {
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

function dedicatedXPrefix(genre: DedicatedXGenre): "LIVING" | "GADGET" | "FOOD" | "DRINK" {
  if (genre === "drink") return "DRINK";
  if (genre === "food") return "FOOD";
  if (genre === "gadget") return "GADGET";
  return "LIVING";
}

/** 専用ジャンル時は LIVING_X_* / GADGET_X_* を共通 X_* へ載せる（美容キーへフォールバックしない） */
function applyDedicatedXEnvOverrides(): void {
  const dedicated = getDedicatedXGenre();
  if (!dedicated) return;
  const prefix = dedicatedXPrefix(dedicated);
  const map: Array<[string, string]> = [
    [`${prefix}_X_ENABLED`, "X_ENABLED"],
    [`${prefix}_X_API_KEY`, "X_API_KEY"],
    [`${prefix}_X_API_SECRET`, "X_API_SECRET"],
    [`${prefix}_X_ACCESS_TOKEN`, "X_ACCESS_TOKEN"],
    [`${prefix}_X_ACCESS_TOKEN_SECRET`, "X_ACCESS_TOKEN_SECRET"],
  ];
  let any = false;
  for (const [from, to] of map) {
    const v = (process.env[from] || "").trim();
    if (v) {
      process.env[to] = v;
      any = true;
    }
  }
  if (any) {
    console.log(
      `[X認証] ${dedicated} OAuth1.0a 設定を適用: API_KEY=${
        (process.env.X_API_KEY || "").trim() ? "設定済" : "(empty)"
      } ACCESS_TOKEN=${(process.env.X_ACCESS_TOKEN || "").trim() ? "設定済" : "(empty)"}`,
    );
  }
}

applyDedicatedXEnvOverrides();

function isXEnabled(): boolean {
  const dedicated = getDedicatedXGenre();
  if (dedicated) {
    const flag = (process.env[`${dedicatedXPrefix(dedicated)}_X_ENABLED`] || "").trim();
    if (flag) return flag.toLowerCase() === "true";
  }
  return (process.env.X_ENABLED ?? "").trim().toLowerCase() === "true";
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function readOAuth1Credentials(): {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
} | null {
  const dedicated = getDedicatedXGenre();
  // 専用ジャンルは LIVING_X_* / GADGET_X_* のみ（美容 X_* へフォールバックしない）
  const keys = dedicated
    ? (() => {
        const prefix = dedicatedXPrefix(dedicated);
        return {
          apiKey: (process.env[`${prefix}_X_API_KEY`] || "").trim(),
          apiSecret: (process.env[`${prefix}_X_API_SECRET`] || "").trim(),
          accessToken: (process.env[`${prefix}_X_ACCESS_TOKEN`] || "").trim(),
          accessTokenSecret: (
            process.env[`${prefix}_X_ACCESS_TOKEN_SECRET`] || ""
          ).trim(),
          labels: [
            `${prefix}_X_API_KEY`,
            `${prefix}_X_API_SECRET`,
            `${prefix}_X_ACCESS_TOKEN`,
            `${prefix}_X_ACCESS_TOKEN_SECRET`,
          ] as const,
        };
      })()
    : {
        apiKey: (process.env.X_API_KEY || "").trim(),
        apiSecret: (process.env.X_API_SECRET || "").trim(),
        accessToken: (process.env.X_ACCESS_TOKEN || "").trim(),
        accessTokenSecret: (process.env.X_ACCESS_TOKEN_SECRET || "").trim(),
        labels: [
          "X_API_KEY",
          "X_API_SECRET",
          "X_ACCESS_TOKEN",
          "X_ACCESS_TOKEN_SECRET",
        ] as const,
      };

  const { apiKey, apiSecret, accessToken, accessTokenSecret, labels } = keys;
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    const missing = [
      !apiKey && labels[0],
      !apiSecret && labels[1],
      !accessToken && labels[2],
      !accessTokenSecret && labels[3],
    ].filter(Boolean);
    console.warn(`X投稿スキップ: OAuth 1.0a 不足 ${missing.join(", ")}`);
    return null;
  }
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

/** OAuth 1.0a Authorization header（JSON body は署名対象外） */
function buildOAuth1Header(params: {
  method: string;
  url: string;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: params.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: params.accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauth[k])}`)
    .join("&");

  const baseString = [
    params.method.toUpperCase(),
    percentEncode(params.url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(params.apiSecret)}&${percentEncode(
    params.accessTokenSecret,
  )}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
  oauth.oauth_signature = signature;

  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ");
  return header;
}

function buildText(): { text: string; utmUrl: string; productId: string; blogUrl: string } {
  const article = readJson<{
    title?: string;
    product?: {
      id?: string;
      name?: string;
      category?: string;
      blogUrl?: string;
      genre?: string;
    };
  }>(articlePath);
  const insta = readJson<{
    xText?: string;
    xUtmUrl?: string;
    caption?: string;
    blogUrl?: string;
    productName?: string;
    category?: string;
  }>(instaPath);

  const productId = (article?.product?.id || "").trim();
  const blogUrl = (insta?.blogUrl || article?.product?.blogUrl || "").trim();
  const pipelineGenre = getDedicatedXGenre() || "living";
  // living/gadget/food/drink は SNS完結。ブログURLは付けない（blog誘導は美容のみ）
  const utmUrl = "";

  let text = (insta?.xText || "").trim();
  if (!text) {
    const name = (insta?.productName || article?.product?.name || "").trim();
    const category = (insta?.category || article?.product?.category || "").trim();
    const hook =
      pipelineGenre === "drink"
        ? "食卓の一杯向きの銘酒を見つけました"
        : pipelineGenre === "food"
          ? "手土産や食卓向きのフードを見つけました"
          : pipelineGenre === "gadget"
            ? category === "power"
              ? "充電まわりが少し楽になりそうなガジェットを見つけました"
              : "デスク周りが少し楽になりそうなガジェット小物を見つけました"
            : category === "kitchen"
              ? "キッチンまわりが少し楽になりそうな道具を見つけました"
              : "暮らしの動線が少し楽になりそうな便利グッズを見つけました";
    text = name ? `${hook}。「${name}」 ※PR` : `${hook} ※PR`;
  }

  return { text, utmUrl, productId, blogUrl, genre: pipelineGenre };
}

function classifyXFailure(status: number, raw: string): string {
  const lower = raw.toLowerCase();
  if (status === 402 || /credits.?depleted|payment.?required/.test(lower)) {
    return "credits_depleted";
  }
  if (status === 401 || /unauthorized|invalid.*oauth|could not authenticate|32\b/.test(lower)) {
    return "auth_or_signature";
  }
  if (status === 403 && /duplicate|already.?posted|187\b/.test(lower)) {
    return "duplicate";
  }
  if (
    status === 403 ||
    /forbidden|not.?permitted|missing.*permission|oauth1.?app.?permissions|453\b|89\b/.test(
      lower,
    )
  ) {
    return "permission";
  }
  if (/duplicate|already.?posted|187\b/.test(lower)) return "duplicate";
  return "other";
}

function writeXErrorLog(payload: Record<string, unknown>): void {
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-x-error.json",
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function publishXText(text: string): Promise<{ id: string } | null> {
  const creds = readOAuth1Credentials();
  if (!creds) {
    console.log("[X分岐] credentials_missing → 下書きのみ");
    return null;
  }

  const auth = buildOAuth1Header({
    method: "POST",
    url: TWEET_URL,
    ...creds,
  });

  console.log(`[X] POST ${TWEET_URL} (OAuth 1.0a)`);
  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const raw = await res.text();
  let json: {
    data?: { id?: string };
    detail?: string;
    title?: string;
    type?: string;
    errors?: unknown;
  } = {};
  try {
    json = raw ? (JSON.parse(raw) as typeof json) : {};
  } catch {
    json = {};
  }

  console.log(`[X] HTTP ${res.status}`);
  console.log(`[X] response body: ${raw.slice(0, 800)}`);

  if (!res.ok || !json.data?.id) {
    const kind = classifyXFailure(res.status, raw);
    writeXErrorLog({
      at: new Date().toISOString(),
      branch: "publishXText_api_error",
      httpStatus: res.status,
      kind,
      body: raw,
      json,
      textPreview: text.slice(0, 120),
    });
    console.error(`[X分岐] publishXText_api_error kind=${kind}`);
    throw new Error(
      `X投稿失敗: HTTP ${res.status} kind=${kind} ${
        json.detail || json.title || raw.slice(0, 300)
      }`,
    );
  }
  console.log(`[X分岐] publish_ok id=${json.data.id}`);
  return { id: String(json.data.id) };
}

async function main(): Promise<void> {
  applyDedicatedXEnvOverrides();
  const { text, utmUrl, productId, blogUrl, genre } = buildText();

  console.log(`X投稿文プレビュー (${genre}):`);
  console.log(text);
  console.log("---");
  if (utmUrl) {
    console.log("---- X Blogger UTM ----");
    console.log(`productId: ${productId || "-"}`);
    console.log(`生成前URL: ${blogUrl}`);
    console.log(`生成後URL: ${utmUrl}`);
    console.log(`付与utm: ${JSON.stringify(describeUtm(utmUrl))}`);
  }

  fs.mkdirSync("output", { recursive: true });
  const draftPath = "output/last-x-draft.json";
  fs.writeFileSync(
    draftPath,
    `${JSON.stringify(
      {
        text,
        utmUrl: utmUrl || null,
        productId: productId || null,
        blogUrl: blogUrl || null,
        genre,
        auth: "oauth1.0a",
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (!isXEnabled() && process.env.X_FORCE !== "true") {
    console.log("[X分岐] disabled → 下書きのみ (X_ENABLED!=true)");
    return;
  }

  const result = await publishXText(text);
  if (!result) {
    writeXErrorLog({
      at: new Date().toISOString(),
      branch: "credentials_missing",
      httpStatus: null,
      kind: "credentials_missing",
      body: null,
    });
    console.log("[X分岐] credentials_missing → 下書きのみ");
    return;
  }

  fs.writeFileSync(
    "output/last-x-publish.json",
    `${JSON.stringify(
      {
        post_id: result.id,
        text,
        utmUrl: utmUrl || null,
        productId: productId || null,
        genre,
        auth: "oauth1.0a",
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, post_id: result.id, utmUrl }, null, 2));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("X投稿エラー（独立失敗）:", msg);
  process.exit(1);
});
