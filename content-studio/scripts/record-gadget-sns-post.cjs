#!/usr/bin/env node
/**
 * gadget SNS 投稿履歴へ1行 append（伸び判定用）。
 *   node scripts/record-gadget-sns-post.cjs
 *   node scripts/record-gadget-sns-post.cjs --likes=12 --replies=1
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const historyPath = path.join(root, "output", "metrics", "gadget-sns-posts.jsonl");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function main() {
  const article = readJson(path.join(root, "input", "article.json"), {});
  const insta = readJson(path.join(root, "input", "instagram-post.json"), {});
  const threads = readJson(path.join(root, "output", "last-threads-publish.json"), {});
  const ig = readJson(path.join(root, "output", "last-instagram-publish.json"), {});

  const likesRaw = arg("--likes");
  const repliesRaw = arg("--replies");
  const quotesRaw = arg("--quotes");

  const selectedSource = article.selectedSource || null;
  const interrupt =
    (article.product && article.product.interrupt) ||
    (String(selectedSource || "").startsWith("interrupt-")
      ? String(selectedSource).replace(/^interrupt-/, "")
      : null);

  const record = {
    at: new Date().toISOString(),
    productId: (article.product && article.product.id) || null,
    category: (article.product && article.product.category) || null,
    platform: "threads",
    threadsPostId: threads.post_id || null,
    igPostId: (ig && (ig.post_id || ig.id)) || null,
    captionPreview: String(insta.caption || "").slice(0, 120) || null,
    likes: likesRaw === "" ? null : Number(likesRaw),
    replies: repliesRaw === "" ? null : Number(repliesRaw),
    quotes: quotesRaw === "" ? null : Number(quotesRaw),
    checked: false,
    genre: "gadget",
    selectedSource,
    interrupt,
    labels: (article.product && article.product.labels) || null,
  };

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf8");
  console.log(`gadget sns history append: ${historyPath}`);
  console.log(
    `productId=${record.productId} category=${record.category} threads=${record.threadsPostId || "-"}`,
  );
}

main();
