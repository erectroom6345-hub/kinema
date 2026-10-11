/**
 * Threads / Blogger 認証の疎通確認（secrets は伏せ字）
 *
 *   npx tsx scripts/check-auth-tokens.ts
 *   npx tsx scripts/check-auth-tokens.ts --refresh-threads
 */
import "dotenv/config";
import { createBloggerClient, ApiBloggerClient } from "../src/adapters/blogger.ts";
import { getConfig, loadEnv } from "../src/config/env.ts";
import { debugInstagramAccessToken, loadInstagramEnvFromFile } from "../src/services/instagramAuth.ts";
import {
  classifyThreadsTokenLifetime,
  ensureThreadsAccessToken,
  readThreadsCredentialsFromEnv,
  refreshThreadsLongLivedToken,
} from "../src/services/threads.ts";

function mask(value: string, head = 6, tail = 4): string {
  const v = value.trim();
  if (!v) return "(empty)";
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

async function checkInstagram(): Promise<void> {
  console.log("\n=== Instagram ===");
  try {
    loadInstagramEnvFromFile();
    const token = (process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
    const accountId = (process.env.INSTAGRAM_ACCOUNT_ID ?? "").trim();
    console.log(`INSTAGRAM_ACCOUNT_ID=${accountId || "(empty)"}`);
    console.log(`INSTAGRAM_ACCESS_TOKEN=${mask(token)}`);
    const d = await debugInstagramAccessToken(token);
    console.log(
      `[Instagram認証] kind=${d.kind} type=${d.type ?? "?"} is_valid=${d.isValid}` +
        (d.daysRemaining != null ? ` remaining≈${d.daysRemaining.toFixed(1)}d` : "") +
        (d.expiresAt === 0 ? " expires_at=0" : ""),
    );
    if (d.kind === "short-lived") {
      console.error(
        "[Instagram認証] 短命tokenです。npx tsx scripts/save-instagram-long-lived-token.ts --short-token=... で長期化してください",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
  }
}

async function checkThreads(doRefresh: boolean): Promise<void> {
  console.log("\n=== Threads ===");
  try {
    const creds = readThreadsCredentialsFromEnv();
    console.log(`THREADS_USER_ID=${creds.userId}`);
    console.log(`THREADS_ACCESS_TOKEN=${mask(creds.accessToken)}`);
    console.log(
      `THREADS_APP_ID=${mask(process.env.THREADS_APP_ID ?? "", 4, 4)}` +
        ` THREADS_APP_SECRET=${(process.env.THREADS_APP_SECRET ?? "").trim() ? "(set)" : "(missing)"}`,
    );

    // me で有効性確認
    const ver = (creds.apiVersion || "v1.0").trim() || "v1.0";
    const meUrl =
      `https://graph.threads.net/${ver}/me?fields=id,username` +
      `&access_token=${encodeURIComponent(creds.accessToken)}`;
    const meRes = await fetch(meUrl);
    const meJson = (await meRes.json().catch(() => ({}))) as {
      id?: string;
      username?: string;
      error?: { message?: string; code?: number };
    };
    if (!meRes.ok) {
      console.error(
        `[Threads認証] me 確認失敗: HTTP ${meRes.status}` +
          (meJson.error?.message ? ` message=${meJson.error.message}` : "") +
          ` token=${mask(creds.accessToken)}`,
      );
    } else {
      console.log(`[Threads認証] me OK id=${meJson.id} username=${meJson.username ?? "?"}`);
    }

    // refresh 前提は長期token。短命を保存しているとここで落ちる
    try {
      const probe = await refreshThreadsLongLivedToken(creds.accessToken);
      const kind = classifyThreadsTokenLifetime(probe.expiresIn);
      console.log(
        `[Threads認証] token種別probe: kind=${kind}` +
          (probe.expiresIn != null ? ` expires_in=${probe.expiresIn}` : " expires_in=(none/too-new)") +
          ` （refresh成功=長期運用向け）`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[Threads認証] token種別probe失敗: 短命token保存の疑い、または失効。` +
          ` 修正: npx tsx scripts/save-threads-long-lived-token.ts --code='...'` +
          ` detail=${msg}`,
      );
    }

    if (doRefresh) {
      const next = await ensureThreadsAccessToken(creds);
      console.log(`[Threads認証] refresh 後 token=${mask(next.accessToken)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
  }
}

async function checkBlogger(): Promise<void> {
  console.log("\n=== Blogger ===");
  loadEnv();
  const config = getConfig();
  console.log(`BLOGGER_BLOG_ID=${config.bloggerBlogId || "(empty)"}`);
  console.log(`BLOGGER_CLIENT_ID=${mask(config.bloggerClientId)}`);
  console.log(`BLOGGER_REFRESH_TOKEN=${mask(config.bloggerRefreshToken)}`);

  const client = createBloggerClient();
  if (!(client instanceof ApiBloggerClient)) {
    console.error(
      "[Blogger認証] 未設定（BLOGGER_BLOG_ID / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN を確認）",
    );
    return;
  }

  try {
    const accessToken = await client.refreshAccessToken();
    console.log(`[Blogger認証] refresh OK access_token=${mask(accessToken)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
  }
}

async function main(): Promise<void> {
  const doRefresh = process.argv.includes("--refresh-threads");
  await checkInstagram();
  await checkThreads(doRefresh);
  await checkBlogger();
  console.log("\n完了");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
