#!/usr/bin/env node
/**
 * 投稿1回分の計測レコードを output/metrics/post-history.jsonl に append。
 *   node scripts/append-post-metrics.cjs --from-summary
 *   node scripts/append-post-metrics.cjs --productId=... --status=success ...
 */
const fs = require("fs");
const path = require("path");
const { withThreadsBeautyUtm } = require("./lib/utm.cjs");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output");
const metricsDir = path.join(outputDir, "metrics");
const historyPath = path.join(metricsDir, "post-history.jsonl");
const lastPath = path.join(metricsDir, "last-post-metrics.json");

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

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildRecord(input) {
  const productId = (input.productId || "").trim() || null;
  const blogUrl = (input.blogUrl || "").trim() || null;
  const threadsPostId = (input.threadsPostId || "").trim() || null;
  let utmUrl = (input.utmUrl || "").trim() || null;
  if (!utmUrl && blogUrl && productId) {
    utmUrl = withThreadsBeautyUtm(blogUrl, productId, {
      postId: threadsPostId || undefined,
      genre: input.genre || (String(input.channel || "").startsWith("living") ? "living" : "beauty"),
    });
  }

  return {
    at: input.at || new Date().toISOString(),
    productId,
    selectedSource: input.selectedSource || null,
    blogUrl,
    utmUrl,
    igUtmUrl: (input.igUtmUrl || "").trim() || null,
    threadsPostId,
    igPostId: input.igPostId || null,
    status: input.status || "unknown",
    postPattern: input.postPattern || null,
    channel: input.channel || "beauty-pipeline",
    genre:
      input.genre ||
      (String(input.channel || "").startsWith("living") ? "living" : "beauty"),
    captionType: input.captionType || null,
    tags: Array.isArray(input.tags) ? input.tags : [],
    policyCheck: input.policyCheck || null,
    metrics: {
      clicks: null,
      impressions: null,
      likes: null,
      replies: null,
      reach: null,
      saved: null,
      profile_visits: null,
      total_interactions: null,
      ...(input.metrics && typeof input.metrics === "object" ? input.metrics : {}),
    },
  };
}

function appendRecord(record) {
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf8");
  fs.writeFileSync(lastPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`metrics append: ${historyPath}`);
  console.log(
    `productId=${record.productId || "-"} status=${record.status} utm=${record.utmUrl ? "yes" : "no"}`,
  );
}

function fromSummary() {
  const summary = readJson(path.join(outputDir, "last-run-summary.json"), {});
  const threads = readJson(path.join(outputDir, "last-threads-publish.json"), {});
  const ig = readJson(path.join(outputDir, "last-instagram-publish.json"), {});
  const insta = readJson(path.join(root, "input", "instagram-post.json"), {});
  const record = buildRecord({
    at: summary.finishedAt || summary.startedAt || new Date().toISOString(),
    productId: summary.productId,
    selectedSource: summary.selectedSource,
    blogUrl: summary.blogUrl,
    utmUrl: threads.utmUrl || summary.utmUrl,
    igUtmUrl: summary.igUtmUrl || ig.utmUrl || insta.blogUtmUrl || null,
    threadsPostId: summary.threadsPostId || threads.post_id,
    igPostId: summary.igPostId || ig.post_id,
    status: summary.status || "unknown",
    postPattern: summary.postPattern || insta.postPattern || null,
    channel: summary.channel || "beauty-pipeline",
    genre: summary.genre || null,
    captionType: summary.captionType || null,
    tags: summary.tags || [],
    policyCheck: summary.policyCheck || null,
  });
  appendRecord(record);
}

function main() {
  if (hasFlag("--from-summary")) {
    fromSummary();
    return;
  }

  const record = buildRecord({
    at: arg("--at") || new Date().toISOString(),
    productId: arg("--productId"),
    selectedSource: arg("--selectedSource"),
    blogUrl: arg("--blogUrl"),
    utmUrl: arg("--utmUrl"),
    threadsPostId: arg("--threadsPostId"),
    igPostId: arg("--igPostId"),
    status: arg("--status") || "unknown",
    channel: arg("--channel") || "beauty-pipeline",
    captionType: arg("--captionType") || null,
  });
  appendRecord(record);
}

main();
