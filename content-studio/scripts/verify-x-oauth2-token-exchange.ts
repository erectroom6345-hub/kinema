/**
 * X OAuth 2.0 token 交換の最小検証（.env へ保存しない）。
 * save-x-user-access-token.ts とは別ファイル。
 *
 * 前提:
 *   1) npx tsx scripts/save-x-user-access-token.ts --auth-url --force
 *   2) Safari で認可 → 戻りURLをすぐ渡す
 *
 *   npx tsx scripts/verify-x-oauth2-token-exchange.ts \
 *     --callback-url='https://.../oauth-callback?state=...&code=...'
 *
 * Confidential (:ci) 想定の最終POST（成功時の形）:
 *   POST https://api.twitter.com/2/oauth2/token
 *   Authorization: Basic base64(client_id:client_secret)
 *   Content-Type: application/x-www-form-urlencoded
 *   body: grant_type / code / redirect_uri / code_verifier
 *         （client_id は body に入れない）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkcePath = path.join(root, "output", ".x-oauth-pkce.json");

type PkceSession = {
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  createdAt: string;
  usedAt?: string;
};

function argValue(name: string): string {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim();
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return "";
}

function mask(value: string, head = 8, tail = 4): string {
  const v = value.trim();
  if (!v) return "(empty)";
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function decodeClientKind(clientId: string): string {
  try {
    const pad = "=".repeat((4 - (clientId.length % 4)) % 4);
    const decoded = Buffer.from(clientId + pad, "base64").toString("utf8");
    if (decoded.endsWith(":ci")) return `confidential (:ci) decoded=${decoded}`;
    if (decoded.endsWith(":na")) return `public/native (:na) decoded=${decoded}`;
    return `unknown decoded=${decoded}`;
  } catch {
    return "decode-failed";
  }
}

function extractCallback(callbackUrl: string): { code: string; state: string } {
  // 二重 decode しない。URL パーサ1回のみ。#fragment は捨てる
  const trimmed = callbackUrl.trim().replace(/#.*$/, "");
  const u = new URL(trimmed);
  return {
    code: u.searchParams.get("code") ?? "",
    state: u.searchParams.get("state") ?? "",
  };
}

function redactBody(body: URLSearchParams): string {
  const lines: string[] = [];
  for (const [k, v] of body.entries()) {
    if (k === "code" || k === "code_verifier" || k === "client_secret") {
      lines.push(`  ${k}=${mask(v, 6, 4)} (len=${v.length})`);
    } else {
      lines.push(`  ${k}=${v}`);
    }
  }
  return lines.join("\n");
}

async function postVariant(params: {
  label: string;
  tokenUrl: string;
  headers: Record<string, string>;
  body: URLSearchParams;
}): Promise<boolean> {
  const { label, tokenUrl, headers, body } = params;
  console.log(`\n===== VARIANT: ${label} =====`);
  console.log(`POST ${tokenUrl}`);
  console.log("headers (redacted):");
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") {
      console.log(`  ${k}=Basic *** (len=${v.length})`);
    } else {
      console.log(`  ${k}=${v}`);
    }
  }
  console.log("body (redacted):");
  console.log(redactBody(body));
  console.log(`body has client_id? ${body.has("client_id")}`);
  console.log(`grant_type=${body.get("grant_type")}`);

  const res = await fetch(tokenUrl, { method: "POST", headers, body });
  const raw = await res.text();
  console.log(`response: HTTP ${res.status}`);
  console.log(`response body: ${raw.slice(0, 500)}`);
  try {
    const json = JSON.parse(raw) as { access_token?: string };
    if (res.ok && json.access_token) {
      console.log(`SUCCESS access_token=${mask(json.access_token)}`);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function main(): Promise<void> {
  const callbackUrl = argValue("--callback-url");
  if (!callbackUrl) {
    throw new Error(
      "必要: --callback-url='https://.../oauth-callback?state=...&code=...'",
    );
  }
  if (!fs.existsSync(pkcePath)) {
    throw new Error(`${pkcePath} がありません。先に --auth-url --force`);
  }

  const pkce = JSON.parse(fs.readFileSync(pkcePath, "utf8")) as PkceSession;
  const envClientId = (
    process.env.LIVING_X_CLIENT_ID ||
    process.env.X_CLIENT_ID ||
    ""
  ).trim();
  const envSecret = (
    process.env.LIVING_X_CLIENT_SECRET ||
    process.env.X_CLIENT_SECRET ||
    ""
  ).trim();
  const envRedirect = (
    process.env.LIVING_X_REDIRECT_URI ||
    process.env.X_REDIRECT_URI ||
    process.env.THREADS_REDIRECT_URI ||
    ""
  ).trim();

  const { code, state } = extractCallback(callbackUrl);

  console.log("==== precheck ====");
  console.log(`pkce.clientId     = ${mask(pkce.clientId, 4, 4)}`);
  console.log(`env clientId      = ${mask(envClientId, 4, 4)}`);
  console.log(
    `client_id equal (auth session vs .env) = ${pkce.clientId === envClientId}`,
  );
  console.log(`client kind       = ${decodeClientKind(pkce.clientId)}`);
  console.log(`pkce.redirectUri  = ${pkce.redirectUri}`);
  console.log(`env redirectUri   = ${envRedirect || "(empty)"}`);
  console.log(`redirect equal    = ${pkce.redirectUri === envRedirect}`);
  console.log(`state pkce        = ${pkce.state}`);
  console.log(`state callback    = ${state}`);
  console.log(`state equal       = ${pkce.state === state}`);
  console.log(`code (masked)     = ${mask(code, 10, 6)} len=${code.length}`);
  console.log(`code re-encode?   = false (URLSearchParams.get 1回のみ)`);
  console.log(`verifier (masked) = ${mask(pkce.verifier, 6, 4)} len=${pkce.verifier.length}`);
  console.log(`pkce.createdAt    = ${pkce.createdAt}`);
  console.log(`pkce.usedAt       = ${pkce.usedAt || "(none)"}`);
  if (pkce.usedAt) {
    console.warn(
      "[警告] この pkce は既に交換試行済み。code は使い切りの可能性大。失敗なら --auth-url --force からやり直し。",
    );
  }
  if (pkce.state !== state) {
    throw new Error("state 不一致。同じ --auth-url セッションの戻りURLを使ってください。");
  }
  if (!code) throw new Error("code が空です");
  if (!envSecret) throw new Error("LIVING_X_CLIENT_SECRET が空です（Confidential 必須）");

  // 認可時 client_id で Basic を組む（.env と食い違っても pkce 側を使う）
  const basic = `Basic ${Buffer.from(`${pkce.clientId}:${envSecret}`).toString("base64")}`;
  const tokenUrl = "https://api.twitter.com/2/oauth2/token";

  // A: Confidential 正解形 — Basic + body に client_id なし
  const bodyA = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pkce.redirectUri,
    code_verifier: pkce.verifier,
  });
  const okA = await postVariant({
    label: "A confidential: Basic + NO client_id in body",
    tokenUrl,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basic,
    },
    body: bodyA,
  });
  if (okA) return;

  // B: Basic + body に client_id も入れる（互換試験）
  const bodyB = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: pkce.clientId,
    redirect_uri: pkce.redirectUri,
    code_verifier: pkce.verifier,
  });
  const okB = await postVariant({
    label: "B Basic + client_id in body",
    tokenUrl,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basic,
    },
    body: bodyB,
  });
  if (okB) return;

  // C: Basic なし・body に client_id + client_secret（非推奨・比較用）
  const bodyC = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: pkce.clientId,
    client_secret: envSecret,
    redirect_uri: pkce.redirectUri,
    code_verifier: pkce.verifier,
  });
  const okC = await postVariant({
    label: "C NO Basic; client_id+client_secret in body",
    tokenUrl,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyC,
  });
  if (okC) return;

  console.error("\n全バリアント失敗。");
  console.error(
    "code 無効が続く場合は OAuth 2.0 ではなく OAuth 1.0a User Context への切替を推奨（Portal に Access Token / Secret が表示される）。",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
