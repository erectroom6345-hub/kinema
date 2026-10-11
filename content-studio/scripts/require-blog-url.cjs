#!/usr/bin/env node
/**
 * SNS投稿前ゲート: 有効な Blogger 個別記事URLが無いと exit 2。
 * publishBeautyBlogger が書く output/blog-ready.json も確認する。
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const articlePath = path.join(root, "input", "article.json");
const readyPath = path.join(root, "output", "blog-ready.json");

function isUnusableBlogUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return true;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG/i.test(raw) || /REPLACE-/i.test(raw)) {
    return true;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const pathname = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return pathname === "/";
  } catch {
    return true;
  }
}

function main() {
  let article = {};
  try {
    article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  } catch {
    console.error("require-blog-url: article.json が読めません");
    process.exit(2);
  }

  const blogUrl = (article.product && article.product.blogUrl) || "";
  if (isUnusableBlogUrl(blogUrl)) {
    console.error(
      `require-blog-url: 有効な blogUrl が無いため SNS 投稿を中止します: ${blogUrl || "(空)"}`,
    );
    process.exit(2);
  }

  if (!fs.existsSync(readyPath)) {
    console.error(
      "require-blog-url: output/blog-ready.json がありません。" +
        " Blogger公開（または明示的な再利用）が成功していません。SNS中止。",
    );
    process.exit(2);
  }

  let ready = {};
  try {
    ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch {
    console.error("require-blog-url: blog-ready.json が壊れています。SNS中止。");
    process.exit(2);
  }

  if (!ready.ok) {
    console.error(
      `require-blog-url: blog-ready.ok!=true のため SNS 中止: ${ready.reason || ""}`,
    );
    process.exit(2);
  }

  if (isUnusableBlogUrl(ready.blogUrl)) {
    console.error("require-blog-url: blog-ready の blogUrl が不正です。SNS中止。");
    process.exit(2);
  }

  const imageStatus = ready.imageStatus || "";
  const imageCount = Number(ready.imageCount || 0);
  console.log(
    `SNSゲートOK: mode=${ready.mode || "-"} blogUrl=${ready.blogUrl} productId=${ready.productId || "-"}` +
      ` imageStatus=${imageStatus || "-"} imageCount=${imageCount}`,
  );
  if (
    imageStatus === "missing" ||
    imageStatus === "broken" ||
    imageStatus === "fixed-skipped" ||
    imageCount === 0
  ) {
    console.warn(
      `WARN: Bloggerは公開済みだが商品画像なし (imageStatus=${imageStatus || "unknown"} imageCount=${imageCount})` +
        (ready.warning ? ` — ${ready.warning}` : ""),
    );
    // exit 0 のまま（SNSは続行）。呼び出し側が partial に倒す。
    process.exitCode = 0;
  }
}

main();
