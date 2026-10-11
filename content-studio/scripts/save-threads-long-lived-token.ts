/**
 * Threads の短命 token を長期 token に交換し、.env の THREADS_ACCESS_TOKEN に保存する。
 *
 *   # ブラウザ認可後の code から（推奨）
 *   npx tsx scripts/save-threads-long-lived-token.ts --code='AQB...'
 *
 *   # すでに短命 token がある場合
 *   npx tsx scripts/save-threads-long-lived-token.ts --short-token='THA...'
 *
 *   # いま .env の token 種別を診断のみ
 *   npx tsx scripts/save-threads-long-lived-token.ts --diagnose
 *
 * 必要: .env に THREADS_APP_ID / THREADS_APP_SECRET
 * 任意: THREADS_REDIRECT_URI（未設定時は Pages oauth-callback）
 */
import {
  classifyThreadsTokenLifetime,
  exchangeThreadsAuthCode,
  exchangeThreadsShortLivedForLongLived,
  loadThreadsEnvFromFile,
  persistThreadsAccessToken,
  persistThreadsUserId,
  readThreadsCredentialsFromEnv,
  refreshThreadsLongLivedToken,
} from "../src/services/threads.ts";

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

function describeExpires(expiresIn?: number): string {
  if (expiresIn == null) return "expires_in=(none)";
  const kind = classifyThreadsTokenLifetime(expiresIn);
  const hours = expiresIn / 3600;
  const days = expiresIn / 86_400;
  return `expires_in=${expiresIn}s (~${hours.toFixed(1)}h / ~${days.toFixed(1)}d) kind=${kind}`;
}

async function diagnoseCurrent(): Promise<void> {
  console.log("=== diagnose: current .env THREADS_ACCESS_TOKEN ===");
  const creds = readThreadsCredentialsFromEnv();
  console.log(`token=${mask(creds.accessToken)} userId=${creds.userId}`);
  try {
    const refreshed = await refreshThreadsLongLivedToken(creds.accessToken);
    console.log(
      `[診断] th_refresh_token OK → 長期tokenとして扱える` +
        ` ${describeExpires(refreshed.expiresIn)}` +
        ` same=${refreshed.accessToken === creds.accessToken}` +
        ` next=${mask(refreshed.accessToken)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[診断] th_refresh_token 失敗（短期保存の疑い or 失効）: ${msg}`);
  }
}

async function main(): Promise<void> {
  loadThreadsEnvFromFile();

  const appId = (process.env.THREADS_APP_ID ?? "").trim();
  const appSecret = (process.env.THREADS_APP_SECRET ?? "").trim();
  const redirectUri =
    (process.env.THREADS_REDIRECT_URI ?? "").trim() ||
    "https://erectroom6345-hub.github.io/instagram-cards/oauth-callback";

  console.log(`THREADS_APP_ID=${appId ? mask(appId, 4, 4) : "(missing)"}`);
  console.log(`THREADS_APP_SECRET=${appSecret ? mask(appSecret, 4, 4) : "(missing)"}`);
  console.log(`THREADS_REDIRECT_URI=${redirectUri}`);

  if (hasFlag("--diagnose")) {
    await diagnoseCurrent();
    return;
  }

  const code = argValue("--code");
  let shortToken = argValue("--short-token");
  let userIdFromCode: string | undefined;

  if (code) {
    if (!appId || !appSecret) {
      throw new Error("code 交換には .env の THREADS_APP_ID / THREADS_APP_SECRET が必要です");
    }
    console.log("\n[1/2] code → 短命 token (POST /oauth/access_token の access_token)");
    const short = await exchangeThreadsAuthCode({
      code,
      clientId: appId,
      clientSecret: appSecret,
      redirectUri,
    });
    shortToken = short.accessToken;
    userIdFromCode = short.userId;
    console.log(
      `短命 token=${mask(shortToken)} user_id=${short.userId ?? "?"}` +
        ` ${describeExpires(short.expiresIn)} ← これを .env に入れない`,
    );
  }

  if (!shortToken) {
    throw new Error(
      "使い方: --code=... または --short-token=...（診断のみは --diagnose）",
    );
  }
  if (!appSecret) {
    throw new Error("長期交換には .env の THREADS_APP_SECRET が必要です");
  }

  console.log("\n[2/2] 短命 → 長期 token (GET /access_token?grant_type=th_exchange_token の access_token)");
  const longLived = await exchangeThreadsShortLivedForLongLived({
    shortLivedToken: shortToken,
    clientSecret: appSecret,
  });
  console.log(
    `長期 token=${mask(longLived.accessToken)} ${describeExpires(longLived.expiresIn)} ← これを .env に保存`,
  );

  persistThreadsAccessToken(longLived.accessToken);
  if (userIdFromCode) {
    persistThreadsUserId(userIdFromCode);
  }

  console.log("\n=== 保存後の確認 (th_refresh_token) ===");
  // 発行直後は 24h 未満で refresh 拒否されることがある。その場合も長期保存自体は成功扱い。
  try {
    const refreshed = await refreshThreadsLongLivedToken(longLived.accessToken);
    console.log(
      `refresh probe OK ${describeExpires(refreshed.expiresIn)} next=${mask(refreshed.accessToken)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/at least 24 hours|too new|not old enough/i.test(msg)) {
      console.log(`refresh probe: 発行直後のため延長不可（想定内）。長期token保存は完了。 detail=${msg}`);
    } else {
      console.warn(`refresh probe 警告: ${msg}`);
    }
  }

  console.log("\n完了: THREADS_ACCESS_TOKEN に長期 token を保存しました");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
