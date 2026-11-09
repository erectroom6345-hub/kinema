/**
 * drink 専用トークン更新（美容ジョブとは分離）。
 *
 *   CONTENT_PIPELINE_GENRE=drink npx tsx scripts/refresh-drink-tokens.ts
 *   npx tsx scripts/refresh-drink-tokens.ts --force
 *
 * - Threads: DRINK_THREADS_* を th_refresh_token
 * - Instagram: DRINK_* を適用して ensure（App ID/Secret は DRINK_FACEBOOK_* 優先）
 *
 * 状態: output/token/drink-token-status.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureInstagramAccessToken,
  loadInstagramEnvFromFile,
  type InstagramTokenDebug,
} from "../src/services/instagramAuth.ts";
import {
  applyDrinkThreadsEnvOverrides,
  ensureThreadsAccessToken,
  loadThreadsEnvFromFile,
  readThreadsCredentialsFromEnv,
} from "../src/services/threads.ts";

type PartStatus = {
  status: "ok" | "skipped" | "error";
  action?: string | null;
  kind?: string | null;
  daysRemaining?: number | null;
  error?: string | null;
};

type DrinkTokenStatus = {
  refreshedAt: string;
  genre: "drink";
  threads: PartStatus;
  instagram: PartStatus;
};

const root = path.resolve(process.cwd());
const tokenDir = path.join(root, "output", "token");
const statusPath = path.join(tokenDir, "drink-token-status.json");
const historyPath = path.join(tokenDir, "drink-token-history.jsonl");

function writeStatus(status: DrinkTokenStatus): void {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify(status)}\n`, "utf8");
  console.log(`[drink-token] 状態保存: ${statusPath}`);
}

async function refreshThreads(): Promise<PartStatus> {
  process.env.CONTENT_PIPELINE_GENRE = "drink";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-drink.json";
  loadThreadsEnvFromFile();
  applyDrinkThreadsEnvOverrides();

  const token = (process.env.DRINK_THREADS_ACCESS_TOKEN || "").trim();
  if (!token) {
    return {
      status: "skipped",
      action: "no-drink-threads-token",
      error: "DRINK_THREADS_ACCESS_TOKEN 未設定",
    };
  }
  if ((process.env.DRINK_THREADS_ENABLED || "").trim().toLowerCase() === "false") {
    return { status: "skipped", action: "threads-disabled" };
  }

  try {
    const before = readThreadsCredentialsFromEnv();
    const after = await ensureThreadsAccessToken(before);
    const changed = after.accessToken !== before.accessToken;
    return {
      status: "ok",
      action: changed ? "refreshed" : "unchanged-or-too-new",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      action: "refresh-failed",
      error: msg.replace(/[A-Za-z0-9]{32,}/g, "[redacted]"),
    };
  }
}

async function refreshInstagram(force: boolean): Promise<PartStatus> {
  process.env.CONTENT_PIPELINE_GENRE = "drink";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-drink.json";
  loadInstagramEnvFromFile();

  const livingToken = (process.env.DRINK_INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!livingToken) {
    return {
      status: "skipped",
      action: "no-drink-instagram-token",
      error: "DRINK_INSTAGRAM_ACCESS_TOKEN 未設定",
    };
  }

  const livingAppId = (process.env.DRINK_FACEBOOK_APP_ID || "").trim();
  const livingAppSecret = (process.env.DRINK_FACEBOOK_APP_SECRET || "").trim();
  if (!livingAppId || !livingAppSecret) {
    return {
      status: "skipped",
      action: "skipped-no-drink-app-secret",
      error:
        "DRINK_FACEBOOK_APP_ID / DRINK_FACEBOOK_APP_SECRET 未設定。" +
        " drink token の閲覧Appと一致するID/Secretを入れると自動延長できます。" +
        "（未設定でも投稿自体は既存tokenで可能なことが多い）",
    };
  }

  const preferPageToken =
    process.argv.includes("--prefer-page-token") ||
    (process.env.DRINK_INSTAGRAM_PREFER_PAGE_TOKEN ?? "").trim().toLowerCase() ===
      "true";

  try {
    const result = await ensureInstagramAccessToken({
      forceExchange: force,
      preferPageToken,
    });
    const debug: InstagramTokenDebug = result.debug;
    return {
      status: "ok",
      action: result.action,
      kind: debug.kind,
      daysRemaining:
        debug.daysRemaining != null && Number.isFinite(debug.daysRemaining)
          ? debug.daysRemaining
          : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      action: "ensure-failed",
      error: msg.replace(/[A-Za-z0-9]{32,}/g, "[redacted]"),
    };
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  console.log("---- drink token refresh ----");

  const threads = await refreshThreads();
  console.log(
    `[drink-token:threads] status=${threads.status} action=${threads.action || "-"}` +
      (threads.error ? ` error=${threads.error}` : ""),
  );

  const instagram = await refreshInstagram(force);
  console.log(
    `[drink-token:instagram] status=${instagram.status} action=${instagram.action || "-"}` +
      (instagram.error ? ` error=${instagram.error}` : ""),
  );

  const status: DrinkTokenStatus = {
    refreshedAt: new Date().toISOString(),
    genre: "drink",
    threads,
    instagram,
  };
  writeStatus(status);

  // Threads 致命のみ fail。IG は App Secret 未設定スキップを許容（現状の運用）
  if (threads.status === "error") process.exit(1);
  if (instagram.status === "error") process.exit(2);
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[drink-token] FAIL ${msg}`);
  process.exit(1);
});
