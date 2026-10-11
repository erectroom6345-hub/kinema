#!/usr/bin/env node
/**
 * living dry-run / 現状確認レポート
 */
const fs = require("fs");
const path = require("path");
const { describeUtm, buildTrackUrl } = require("./lib/utm.cjs");
const { formatText } = require("./lib/notify.cjs");
const { loadLivingOps } = require("./lib/living-ops.cjs");

const root = path.join(__dirname, "..");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function main() {
  const ops = loadLivingOps();
  const article = readJson(path.join(root, "input", "article.json"), {});
  const insta = readJson(path.join(root, "input", "instagram-post.json"), {});
  const xDraft = readJson(path.join(root, "output", "last-x-draft.json"), {});
  const productId = (article.product && article.product.id) || "living-sample";
  const fixedPage =
    ops.fixedPageUrl ||
    insta.blogUrl ||
    "https://living-notes-sample.blogspot.com/p/living.html";

  const utmIg = buildTrackUrl({
    blogUrl: fixedPage,
    productId,
    source: "instagram",
    genre: "living",
  });
  const utmTh = buildTrackUrl({
    blogUrl: fixedPage,
    productId,
    source: "threads",
    genre: "living",
  });
  const utmX = buildTrackUrl({
    blogUrl: fixedPage,
    productId,
    source: "x",
    genre: "living",
  });

  const slackExample = formatText({
    level: "info",
    eventType: "daily_summary",
    productId,
    step: "run-living",
    reason: "status=success genre=living mode=sns-first cta=fixed_page",
    logPath: path.join(root, "output", "living-cron.log"),
    at: new Date().toISOString(),
    extraLines: [
      "affiliate=rakuten_only",
      `utm_campaign=living_${productId}`,
    ],
  });

  const report = {
    mode: "sns-first",
    cta: "fixed_page",
    affiliate: "rakuten_only",
    productId,
    category: article.product?.category || null,
    fixedPageUrl: fixedPage,
    instagramCaption: insta.caption || null,
    threadsText: insta.threadsText || null,
    xText: insta.xText || xDraft.text || null,
    utm: {
      instagram: { url: utmIg, params: describeUtm(utmIg) },
      threads: { url: utmTh, params: describeUtm(utmTh) },
      x: { url: utmX, params: describeUtm(utmX) },
    },
    slackNotifyExample: slackExample,
    ops: {
      categories: ops.categories,
      growth: ops.growth,
      blog: ops.blog,
      posting: ops.posting,
    },
  };

  const outPath = path.join(root, "output", "living", "sample-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log("======== living 確認 (SNS先行 / 固定ページCTA / 楽天一本) ========");
  console.log(`productId: ${productId} category: ${report.category}`);
  console.log(`fixedPage: ${fixedPage}`);
  console.log("");
  console.log("--- Instagram ---");
  console.log(report.instagramCaption || "(未生成)");
  console.log("");
  console.log("--- Threads ---");
  console.log(report.threadsText || "(未生成)");
  console.log("");
  console.log("--- X ---");
  console.log(report.xText || "(未生成)");
  console.log("");
  console.log("--- UTM ---");
  console.log(JSON.stringify(report.utm, null, 2));
  console.log("");
  console.log("--- Slack例 ---");
  console.log(slackExample);
  console.log(`保存: ${outPath}`);
}

main();
