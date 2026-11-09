/**
 * living 専用トークン更新（美容ジョブとは分離）。
 *
 *   CONTENT_PIPELINE_GENRE=living npx tsx scripts/refresh-living-tokens.ts
 *   npx tsx scripts/refresh-living-tokens.ts --force
 *
 * - Threads: LIVING_THREADS_* を th_refresh_token
 * - Instagram: LIVING_* を適用して ensure（App ID/Secret は LIVING_FACEBOOK_* 優先）
 *
 * 状態: output/token/living-token-status.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureInstagramAccessToken,
  loadInstagramEnvFromFile,
  type InstagramTokenDebug,
} from "../src/services/instagramAuth.ts";
import {
  applyLivingThreadsEnvOverrides,
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

type LivingTokenStatus = {
  refreshedAt: string;
  genre: "living";
  threads: PartStatus;
  instagram: PartStatus;
};

const root = path.resolve(process.cwd());
const tokenDir = path.join(root, "output", "token");
const statusPath = path.join(tokenDir, "living-token-status.json");
const historyPath = path.join(tokenDir, "living-token-history.jsonl");

function writeStatus(status: LivingTokenStatus): void {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify(status)}\n`, "utf8");
  console.log(`[living-token] 状態保存: ${statusPath}`);
}

async function refreshThreads(): Promise<PartStatus> {
  process.env.CONTENT_PIPELINE_GENRE = "living";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-living.json";
  loadThreadsEnvFromFile();
  applyLivingThreadsEnvOverrides();

  const token = (process.env.LIVING_THREADS_ACCESS_TOKEN || "").trim();
  if (!token) {
    return {
      status: "skipped",
      action: "no-living-threads-token",
      error: "LIVING_THREADS_ACCESS_TOKEN 未設定",
    };
  }
  if ((process.env.LIVING_THREADS_ENABLED || "").trim().toLowerCase() === "false") {
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
  process.env.CONTENT_PIPELINE_GENRE = "living";
  process.env.POSTED_PRODUCTS_PATH =
    process.env.POSTED_PRODUCTS_PATH || "data/posted-living.json";
  loadInstagramEnvFromFile();

  const livingToken = (process.env.LIVING_INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!livingToken) {
    return {
      status: "skipped",
      action: "no-living-instagram-token",
      error: "LIVING_INSTAGRAM_ACCESS_TOKEN 未設定",
    };
  }

  const livingAppId = (process.env.LIVING_FACEBOOK_APP_ID || "").trim();
  const livingAppSecret = (process.env.LIVING_FACEBOOK_APP_SECRET || "").trim();
  if (!livingAppId || !livingAppSecret) {
    return {
      status: "skipped",
      action: "skipped-no-living-app-secret",
      error:
        "LIVING_FACEBOOK_APP_ID / LIVING_FACEBOOK_APP_SECRET 未設定。" +
        " living token の閲覧Appと一致するID/Secretを入れると自動延長できます。" +
        "（未設定でも投稿自体は既存tokenで可能なことが多い）",
    };
  }

  const preferPageToken =
    process.argv.includes("--prefer-page-token") ||
    (process.env.LIVING_INSTAGRAM_PREFER_PAGE_TOKEN ?? "").trim().toLowerCase() ===
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
  console.log("---- living token refresh ----");

  const threads = await refreshThreads();
  console.log(
    `[living-token:threads] status=${threads.status} action=${threads.action || "-"}` +
      (threads.error ? ` error=${threads.error}` : ""),
  );

  const instagram = await refreshInstagram(force);
  console.log(
    `[living-token:instagram] status=${instagram.status} action=${instagram.action || "-"}` +
      (instagram.error ? ` error=${instagram.error}` : ""),
  );

  const status: LivingTokenStatus = {
    refreshedAt: new Date().toISOString(),
    genre: "living",
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
  console.error(`[living-token] FAIL ${msg}`);
  process.exit(1);
});
