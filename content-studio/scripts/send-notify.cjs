#!/usr/bin/env node
/**
 * Slack 通知 CLI
 *
 *   node scripts/send-notify.cjs --level=error --eventType=run_failed --productId=... --step=... --reason='...' --logPath=...
 *   node scripts/send-notify.cjs --level=info --eventType=daily_summary --force
 */
const { sendNotify } = require("./lib/notify.cjs");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const extra = (arg("--extra") || "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await sendNotify({
    level: arg("--level") || "error",
    eventType: arg("--eventType") || "unknown",
    productId: arg("--productId"),
    step: arg("--step"),
    reason: arg("--reason"),
    logPath: arg("--logPath"),
    force: hasFlag("--force"),
    extraLines: extra,
  });

  if (result.sent) process.exit(0);
  if (result.skipped === "dedup" || result.skipped === "level_not_allowed") {
    process.exit(0);
  }
  // Webhook 未設定や送信失敗でもジョブは止めない
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(0);
});
