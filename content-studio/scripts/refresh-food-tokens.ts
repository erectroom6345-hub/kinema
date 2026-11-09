/**
 * food 専用トークン更新（美容ジョブとは分離）。
 *
 *   CONTENT_PIPELINE_GENRE=food npx tsx scripts/refresh-food-tokens.ts
 *   npx tsx scripts/refresh-food-tokens.ts --force
 *
 * - Threads: FOOD_THREADS_* を th_refresh_token
 * - Instagram: FOOD_* を適用して ensure（App ID/Secret は FOOD_FACEBOOK_* 優先）
 *
 * 状態: output/token/food-token-status.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureInstagramAccessToken,
  loadInstagramEnvFromFile,
  type InstagramTokenDebug,
} from "../src/services/instagramAuth.ts";
import {
  applyFoodThreadsEnvOverrides,
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

type FoodTokenStatus = {
  refreshedAt: string;
  genre: "food";
  threads: PartStatus;
  instagram: PartStatus;
};

const root = path.resolve(process.cwd());
const tokenDir = path.join(root, "output", "token");
const statusPath = path.join(tokenDir, "food-token-status.json");
const historyPath = path.join(tokenDir, "food-token-history.jsonl");

function writeStatus(status: FoodTokenStatus): void {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify(status)}\n`, "utf8");
  console.log(`[food-token] 状態保存: ${statusPath}`);
}

async function refreshThreads(): Promise<PartStatus> {
  process.env.CONTENT_PIPELINE_GENRE = "food";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-food.json";
  loadThreadsEnvFromFile();
  applyFoodThreadsEnvOverrides();

  const token = (process.env.FOOD_THREADS_ACCESS_TOKEN || "").trim();
  if (!token) {
    return {
      status: "skipped",
      action: "no-food-threads-token",
      error: "FOOD_THREADS_ACCESS_TOKEN 未設定",
    };
  }
  if ((process.env.FOOD_THREADS_ENABLED || "").trim().toLowerCase() === "false") {
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
  process.env.CONTENT_PIPELINE_GENRE = "food";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-food.json";
  loadInstagramEnvFromFile();

  const livingToken = (process.env.FOOD_INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!livingToken) {
    return {
      status: "skipped",
      action: "no-food-instagram-token",
      error: "FOOD_INSTAGRAM_ACCESS_TOKEN 未設定",
    };
  }

  const livingAppId = (process.env.FOOD_FACEBOOK_APP_ID || "").trim();
  const livingAppSecret = (process.env.FOOD_FACEBOOK_APP_SECRET || "").trim();
  if (!livingAppId || !livingAppSecret) {
    return {
      status: "skipped",
      action: "skipped-no-food-app-secret",
      error:
        "FOOD_FACEBOOK_APP_ID / FOOD_FACEBOOK_APP_SECRET 未設定。" +
        " food token の閲覧Appと一致するID/Secretを入れると自動延長できます。" +
        "（未設定でも投稿自体は既存tokenで可能なことが多い）",
    };
  }

  const preferPageToken =
    process.argv.includes("--prefer-page-token") ||
    (process.env.FOOD_INSTAGRAM_PREFER_PAGE_TOKEN ?? "").trim().toLowerCase() ===
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
  console.log("---- food token refresh ----");

  const threads = await refreshThreads();
  console.log(
    `[food-token:threads] status=${threads.status} action=${threads.action || "-"}` +
      (threads.error ? ` error=${threads.error}` : ""),
  );

  const instagram = await refreshInstagram(force);
  console.log(
    `[food-token:instagram] status=${instagram.status} action=${instagram.action || "-"}` +
      (instagram.error ? ` error=${instagram.error}` : ""),
  );

  const status: FoodTokenStatus = {
    refreshedAt: new Date().toISOString(),
    genre: "food",
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
  console.error(`[food-token] FAIL ${msg}`);
  process.exit(1);
});
