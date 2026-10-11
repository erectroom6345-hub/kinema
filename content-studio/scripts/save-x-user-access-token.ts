/**
 * X (Twitter) OAuth 2.0 User Access Token を取得し、LIVING_X_ACCESS_TOKEN に保存する。
 *
 *   npx tsx scripts/save-x-user-access-token.ts --auth-url
 *   npx tsx scripts/save-x-user-access-token.ts --callback-url='https://.../oauth-callback?state=...&code=...'
 *
 * 必要 .env: LIVING_X_CLIENT_ID / LIVING_X_CLIENT_SECRET / LIVING_X_REDIRECT_URI
 *
 * 注意:
 * - code は1回限り。交換失敗後は --auth-url からやり直し
 * - --auth-url は未使用の .x-oauth-pkce.json を上書きしない（--force で強制）
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkcePath = path.join(root, "output", ".x-oauth-pkce.json");
const DEFAULT_REDIRECT =
  "https://erectroom6345-hub.github.io/instagram-cards/oauth-callback";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
const TOKEN_URLS = [
  "https://api.twitter.com/2/oauth2/token",
  "https://api.x.com/2/oauth2/token",
];

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

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function mask(value: string, head = 8, tail = 4): string {
  const v = value.trim();
  if (!v) return "(empty)";
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier, "utf8").digest(),
  );
  return { verifier, challenge };
}

function readEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = (
    process.env.LIVING_X_CLIENT_ID ||
    process.env.X_CLIENT_ID ||
    ""
  ).trim();
  const clientSecret = (
    process.env.LIVING_X_CLIENT_SECRET ||
    process.env.X_CLIENT_SECRET ||
    ""
  ).trim();
  const redirectUri = (
    process.env.LIVING_X_REDIRECT_URI ||
    process.env.X_REDIRECT_URI ||
    process.env.THREADS_REDIRECT_URI ||
    DEFAULT_REDIRECT
  ).trim();
  return { clientId, clientSecret, redirectUri };
}

function loadPkce(): PkceSession {
  if (!fs.existsSync(pkcePath)) {
    throw new Error(
      `${pkcePath} がありません。先に --auth-url を実行してください。`,
    );
  }
  const raw = fs.readFileSync(pkcePath, "utf8");
  const pkce = JSON.parse(raw) as PkceSession;
  if (!pkce.verifier || !pkce.state || !pkce.redirectUri || !pkce.clientId) {
    throw new Error("pkce ファイルが不完全です。--auth-url からやり直してください。");
  }
  return pkce;
}

function persistEnvKey(key: string, value: string): void {
  const envPath = path.resolve(root, ".env");
  const v = value.trim();
  if (!v) throw new Error(`空の ${key} は保存できません`);
  if (!fs.existsSync(envPath)) {
    process.env[key] = v;
    console.warn(".env が無いためメモリのみ更新");
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
  console.log(`[X認証] .env の ${key} を更新しました`);
}

/** code を壊さない: URLSearchParams.get の1回だけ（二重 decode しない） */
function extractCodeAndState(callbackUrl: string): {
  code: string;
  state: string;
  error: string;
  errorDescription: string;
} {
  const trimmed = callbackUrl.trim().replace(/#.*$/, "");
  const u = new URL(trimmed);
  return {
    code: u.searchParams.get("code") ?? "",
    state: u.searchParams.get("state") ?? "",
    error: u.searchParams.get("error") ?? "",
    errorDescription: u.searchParams.get("error_description") ?? "",
  };
}

function printAuthUrl(): void {
  const { clientId, redirectUri } = readEnv();
  if (!clientId) {
    throw new Error(
      "LIVING_X_CLIENT_ID（または X_CLIENT_ID）が空です。Portal の OAuth 2.0 Client ID を .env に入れてください。",
    );
  }

  if (fs.existsSync(pkcePath) && !hasFlag("--force")) {
    const existing = JSON.parse(fs.readFileSync(pkcePath, "utf8")) as PkceSession;
    throw new Error(
      `未使用の pkce が残っています: ${pkcePath}\n` +
        `  state=${existing.state}\n` +
        `  createdAt=${existing.createdAt}\n` +
        `同じ認可セッションを続けるなら --callback-url を使ってください。\n` +
        `新規認可なら: npx tsx scripts/save-x-user-access-token.ts --auth-url --force`,
    );
  }

  const { verifier, challenge } = createPkce();
  const state = base64Url(crypto.randomBytes(16));
  const session: PkceSession = {
    verifier,
    state,
    redirectUri,
    clientId,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(pkcePath), { recursive: true });
  fs.writeFileSync(pkcePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const url = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

  console.log("redirect_uri=", redirectUri);
  console.log("client_id=", mask(clientId, 4, 4));
  console.log("state=", state);
  console.log("scope=", SCOPES.join(" "));
  console.log(`pkce saved: ${pkcePath} (上書き防止あり・--force で再作成)`);
  console.log("\n--- Safari で開く認可URL（1本）---");
  console.log(url);
  console.log("---");
  console.log(
    "許可後（すぐ）:\n" +
      "  npx tsx scripts/save-x-user-access-token.ts --callback-url='（戻りURL全体）'",
  );
}

function logExchangeDiagnostics(params: {
  pkce: PkceSession;
  callbackState: string;
  code: string;
  envClientId: string;
  envRedirect: string;
  body: URLSearchParams;
  hasBasicAuth: boolean;
}): void {
  const { pkce, callbackState, code, envClientId, envRedirect, body, hasBasicAuth } =
    params;
  const stateMatch = callbackState === pkce.state;
  console.log("---- X OAuth exchange diagnostics ----");
  console.log(`state match: ${stateMatch}`);
  console.log(`  pkce.state     = ${pkce.state}`);
  console.log(`  callback.state = ${callbackState || "(empty)"}`);
  console.log(`pkce.clientId     = ${mask(pkce.clientId, 4, 4)}`);
  console.log(`env clientId      = ${mask(envClientId, 4, 4)}`);
  console.log(`clientId match    = ${pkce.clientId === envClientId}`);
  console.log(`pkce.redirectUri  = ${pkce.redirectUri}`);
  console.log(`env redirectUri   = ${envRedirect}`);
  console.log(`redirect match    = ${pkce.redirectUri === envRedirect}`);
  console.log(`code length       = ${code.length}`);
  console.log(`code (masked)     = ${mask(code, 10, 6)}`);
  console.log(`code modified?    = false (URLSearchParams.get のみ・二重decodeなし)`);
  console.log(`pkce.createdAt    = ${pkce.createdAt}`);
  console.log(`pkce.usedAt       = ${pkce.usedAt || "(none)"}`);
  console.log(`Authorization     = ${hasBasicAuth ? "Basic (client_id:secret)" : "(none)"}`);
  console.log("token body (redacted):");
  for (const [k, v] of body.entries()) {
    if (k === "code" || k === "code_verifier" || k === "client_secret") {
      console.log(`  ${k}=${mask(v, 6, 4)} (len=${v.length})`);
    } else {
      console.log(`  ${k}=${v}`);
    }
  }
  console.log("--------------------------------------");
  if (!stateMatch) {
    throw new Error(
      "state 不一致: --auth-url のセッションと戻りURLが違うか、pkce が上書きされています。" +
        " --auth-url --force からやり直してください。",
    );
  }
}

async function exchangeCode(code: string, callbackState: string): Promise<void> {
  const env = readEnv();
  const pkce = loadPkce();

  // 交換は認可時に保存した値を優先（.env 変更や取り違え防止）
  const clientId = pkce.clientId;
  const redirectUri = pkce.redirectUri;
  const verifier = pkce.verifier.trim();
  const cleanCode = code; // 加工しない

  if (!cleanCode) throw new Error("code が空です");
  if (!verifier) throw new Error("pkce verifier が空です");

  // Confidential (:ci): Basic(client_id:secret) + body に client_id を入れない
  // Public (:na): body に client_id（secret なし）
  const hasSecret = Boolean(env.clientSecret);
  if (!hasSecret) {
    throw new Error(
      "LIVING_X_CLIENT_SECRET が空です。この Client ID は Confidential (:ci) です。Secret 必須。",
    );
  }
  if (env.clientId && env.clientId !== clientId) {
    throw new Error(
      `client_id 不一致: 認可時 pkce=${mask(clientId, 4, 4)} / .env=${mask(env.clientId, 4, 4)}。` +
        `同じ Client ID で --auth-url からやり直してください。`,
    );
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", cleanCode);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", verifier);
  // client_id は body に入れない（Basic と二重にしない）

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${clientId}:${env.clientSecret}`).toString("base64")}`,
  };

  logExchangeDiagnostics({
    pkce,
    callbackState,
    code: cleanCode,
    envClientId: env.clientId || clientId,
    envRedirect: env.redirectUri,
    body,
    hasBasicAuth: true,
  });
  console.log("final POST shape: Basic auth + body keys =", [...body.keys()].join(","));
  console.log("scopes used at authorize:", SCOPES.join(" "), "(tweet.write に必要最小+offline.access)");

  // 使用済みマーク（再実行で同じ code を誤用しないよう）
  pkce.usedAt = new Date().toISOString();
  fs.writeFileSync(pkcePath, `${JSON.stringify(pkce, null, 2)}\n`, "utf8");

  let lastErr = "";
  for (const tokenUrl of TOKEN_URLS) {
    console.log(`POST ${tokenUrl}`);
    console.log("headers: Content-Type=application/x-www-form-urlencoded, Authorization=Basic ***");
    console.log("body (redacted):");
    for (const [k, v] of body.entries()) {
      if (k === "code" || k === "code_verifier") {
        console.log(`  ${k}=${mask(v, 6, 4)} (len=${v.length})`);
      } else {
        console.log(`  ${k}=${v}`);
      }
    }
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body,
    });
    const raw = await res.text();
    let json: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    } = {};
    try {
      json = raw ? (JSON.parse(raw) as typeof json) : {};
    } catch {
      json = {};
    }
    if (res.ok && json.access_token) {
      console.log(
        `access_token=${mask(json.access_token)} expires_in=${json.expires_in ?? "?"}s` +
          ` scope=${json.scope || "?"}`,
      );
      persistEnvKey("LIVING_X_ACCESS_TOKEN", json.access_token);
      if (json.refresh_token) {
        persistEnvKey("LIVING_X_REFRESH_TOKEN", json.refresh_token);
      }
      try {
        fs.unlinkSync(pkcePath);
      } catch {
        /* ignore */
      }
      console.log("\n完了: LIVING_X_ACCESS_TOKEN に User Access Token を保存しました");
      console.log("投稿有効化: LIVING_X_ENABLED=true");
      console.log(
        "※ access_token は短命（約2h）。失敗した code は再利用不可 → 次回は --auth-url --force から",
      );
      return;
    }
    lastErr =
      `HTTP ${res.status} ` +
      (json.error_description || json.error || raw.slice(0, 300));
    console.warn(`失敗: ${lastErr}`);
  }

  throw new Error(
    `token 交換失敗: ${lastErr}\n` +
      `code は1回限りです。次は必ず:\n` +
      `  npx tsx scripts/save-x-user-access-token.ts --auth-url --force\n` +
      `  （Safariで認可）\n` +
      `  npx tsx scripts/save-x-user-access-token.ts --callback-url='（新しい戻りURL）'`,
  );
}

async function main(): Promise<void> {
  if (hasFlag("--auth-url")) {
    printAuthUrl();
    return;
  }

  const callbackUrl = argValue("--callback-url");
  let code = argValue("--code");
  let callbackState = "";

  if (callbackUrl) {
    const extracted = extractCodeAndState(callbackUrl);
    if (extracted.error) {
      throw new Error(
        `認可エラー: ${extracted.error} ${extracted.errorDescription}`,
      );
    }
    code = extracted.code;
    callbackState = extracted.state;
  }

  if (!code) {
    throw new Error(
      "使い方:\n" +
        "  npx tsx scripts/save-x-user-access-token.ts --auth-url\n" +
        "  npx tsx scripts/save-x-user-access-token.ts --auth-url --force\n" +
        "  npx tsx scripts/save-x-user-access-token.ts --callback-url='...'",
    );
  }

  // --code のみのときは pkce.state と照合できないので警告
  if (!callbackState) {
    console.warn(
      "[警告] --callback-url ではなく --code 指定のため state チェックをスキップします。可能なら --callback-url を使ってください。",
    );
  }

  await exchangeCode(code, callbackState);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
