#!/usr/bin/env node
/**
 * gadget dry-run / 現状確認レポート
 */
const fs = require("fs");
const path = require("path");
const { formatText } = require("./lib/notify.cjs");
const { loadGadgetOps } = require("./lib/gadget-ops.cjs");

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
  const ops = loadGadgetOps();
  const article = readJson(path.join(root, "input", "article.json"), {});
  const insta = readJson(path.join(root, "input", "instagram-post.json"), {});
  const xDraft = readJson(path.join(root, "output", "last-x-draft.json"), {});
  const productId = (article.product && article.product.id) || "gadget-sample";
  const fixedPage =
    ops.fixedPageUrl ||
    "https://gadget-notes-sample.blogspot.com/p/gadget.html";

  const slackExample = formatText({
    level: "info",
    eventType: "daily_summary",
    productId,
    step: "run-gadget",
    reason: "status=success genre=gadget mode=sns-first cta=sns_self_contained",
    logPath: path.join(root, "output", "gadget-cron.log"),
    at: new Date().toISOString(),
    extraLines: ["affiliate=rakuten_only", "cta=sns_self_contained (blog誘導は美容のみ)"],
  });

  const report = {
    mode: "sns-first",
    cta: "sns_self_contained",
    affiliate: "rakuten_only",
    productId,
    category: article.product?.category || null,
    fixedPageUrl: fixedPage,
    fixedPageNote: "ブログまとめ用。SNS本文には載せない",
    instagramCaption: insta.caption || null,
    threadsText: insta.threadsText || null,
    xText: insta.xText || xDraft.text || null,
    utm: null,
    slackNotifyExample: slackExample,
    ops: {
      categories: ops.categories,
      growth: ops.growth,
      blog: ops.blog,
      posting: ops.posting,
    },
  };

  const outPath = path.join(root, "output", "gadget", "sample-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log("======== gadget 確認 (SNS先行 / SNS完結 / 楽天一本) ========");
  console.log(`productId: ${productId} category: ${report.category}`);
  console.log(`blogFixedPage(not in SNS): ${fixedPage}`);
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
  console.log("--- Slack例 ---");
  console.log(slackExample);
  console.log(`保存: ${outPath}`);
}

main();
