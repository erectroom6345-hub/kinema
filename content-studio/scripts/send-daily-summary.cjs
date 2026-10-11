#!/usr/bin/env node
/**
 * run-beauty 終了後の短い日次サマリ（info）。
 * SLACK_DAILY_SUMMARY=true のときだけ Slack 送信。
 *
 *   node scripts/send-daily-summary.cjs
 *   node scripts/send-daily-summary.cjs --force
 */
const fs = require("fs");
const path = require("path");
const { sendNotify } = require("./lib/notify.cjs");

const root = path.join(__dirname, "..");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function yn(v) {
  return v ? "yes" : "no";
}

async function main() {
  const summary = readJson(path.join(root, "output", "last-run-summary.json"), {});
  const steps = Array.isArray(summary.steps) ? summary.steps : [];
  const stepOk = (name) =>
    steps.some((s) => s.name === name && (s.status === "ok" || s.status === "success"));

  const productId = summary.productId || "";
  const status = summary.status || "unknown";
  const policy = summary.policyCheck || {};
  const policyWarn = policy.result === "warn";

  const blog = yn(Boolean(summary.blogUrl) || stepOk("Blogger公開とblogUrl取得") || stepOk("Blogger本文生成(dry-run)"));
  const ig = yn(Boolean(summary.igPostId) || stepOk("IG投稿"));
  const threads = yn(Boolean(summary.threadsPostId) || stepOk("Threads投稿"));
  const x = yn(Boolean(summary.xPostId) || stepOk("X投稿"));
  const genre = summary.genre || (String(summary.channel || "").startsWith("living") ? "living" : "beauty");
  const runLabel = genre === "living" ? "run-living" : "run-beauty";
  const logName = genre === "living" ? "living-cron.log" : "beauty-cron.log";

  const kpi = readJson(path.join(root, "output", "metrics", "kpi-summary.json"), {});
  const k = kpi.kpis || {};
  const reason = `status=${status} genre=${genre} blog=${blog} ig=${ig} threads=${threads} x=${x} policyWarn=${yn(policyWarn)}`;

  await sendNotify({
    level: "info",
    eventType: "daily_summary",
    productId,
    step: runLabel,
    reason,
    logPath: path.join(root, "output", logName),
    force: hasFlag("--force"),
    extraLines: [
      `channel=${summary.channel || `${genre}-pipeline`}`,
      `utm=${summary.utmUrl ? "yes" : "no"}`,
      `selectedSource=${summary.selectedSource || "-"}`,
      `kpi_saved=${k.ig_saved ?? "-"} reach=${k.ig_reach ?? "-"} profile=${k.ig_profile_visits ?? "-"}`,
      `kpi_utm_sent=${k.utm_links_sent ?? "-"} blog_clicks=${k.blog_sessions_or_clicks ?? "-"}`,
    ],
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(0);
});
