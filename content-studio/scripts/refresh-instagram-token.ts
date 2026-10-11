/**
 * Instagram token の定期更新入口（投稿とは独立）。
 *
 *   npx tsx scripts/refresh-instagram-token.ts
 *   npx tsx scripts/refresh-instagram-token.ts --force
 *   npx tsx scripts/refresh-instagram-token.ts --prefer-page-token
 *   npx tsx scripts/refresh-instagram-token.ts --dry-status   # 状態だけ書いて終了しない用途は無し
 *
 * 成功/失敗の要約を output/token/instagram-token-status.json に保存。
 * トークン値そのものはログにも状態ファイルにも出さない。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ensureInstagramAccessToken,
  loadInstagramEnvFromFile,
  type InstagramTokenDebug,
} from "../src/services/instagramAuth.ts";

type TokenStatus = {
  refreshedAt: string;
  tokenType: "instagram";
  kind: InstagramTokenDebug["kind"] | null;
  status: "ok" | "skipped" | "error";
  action: string | null;
  daysRemaining: number | null;
  expiresAt: number | null;
  error: string | null;
};

const root = path.resolve(process.cwd());
const tokenDir = path.join(root, "output", "token");
const statusPath = path.join(tokenDir, "instagram-token-status.json");
const historyPath = path.join(tokenDir, "instagram-token-history.jsonl");

function writeStatus(status: TokenStatus): void {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify(status)}\n`, "utf8");
  console.log(`[Instagram認証] 状態保存: ${statusPath}`);
  console.log(
    `[Instagram認証] status=${status.status} action=${status.action || "-"}` +
      ` kind=${status.kind || "-"}` +
      (status.daysRemaining != null
        ? ` remaining≈${status.daysRemaining.toFixed(1)}d`
        : status.expiresAt === 0
          ? " expires_at=0"
          : ""),
  );
}

async function main(): Promise<void> {
  loadInstagramEnvFromFile();
  const force = process.argv.includes("--force");
  const preferPageToken =
    process.argv.includes("--prefer-page-token") ||
    (process.env.INSTAGRAM_PREFER_PAGE_TOKEN ?? "").trim().toLowerCase() === "true";

  try {
    const result = await ensureInstagramAccessToken({
      forceExchange: force,
      preferPageToken,
    });

    const needsAttention =
      result.action === "skipped-no-secret" &&
      result.debug.kind === "long-lived" &&
      result.debug.daysRemaining != null &&
      result.debug.daysRemaining <= 14;

    const status: TokenStatus = {
      refreshedAt: new Date().toISOString(),
      tokenType: "instagram",
      kind: result.debug.kind,
      status: needsAttention ? "error" : result.action === "skipped-no-secret" ? "skipped" : "ok",
      action: result.action,
      daysRemaining:
        result.debug.daysRemaining != null && Number.isFinite(result.debug.daysRemaining)
          ? result.debug.daysRemaining
          : null,
      expiresAt: result.debug.expiresAt ?? null,
      error: needsAttention
        ? "FACEBOOK_APP_ID/SECRET 未設定のため期限接近中の更新ができません"
        : null,
    };
    writeStatus(status);

    if (status.status === "error") {
      console.error(`[Instagram認証] ${status.error}`);
      process.exit(2);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // トークン文字列が message に混ざることは通常ないが、念のため長い英数字列は伏せる
    const safe = msg.replace(/[A-Za-z0-9]{32,}/g, "[redacted]");
    writeStatus({
      refreshedAt: new Date().toISOString(),
      tokenType: "instagram",
      kind: null,
      status: "error",
      action: null,
      daysRemaining: null,
      expiresAt: null,
      error: safe,
    });
    console.error(`[Instagram認証] refresh 失敗: ${safe}`);
    process.exit(1);
  }
}

main();
