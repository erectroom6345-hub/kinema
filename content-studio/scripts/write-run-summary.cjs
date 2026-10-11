#!/usr/bin/env node
/**
 * run-beauty / run-living 終了時に output/last-run-summary.json と履歴を書く。
 * 続けて output/metrics/post-history.jsonl へ商品別反応レコードを append。
 *   node scripts/write-run-summary.cjs --startedAt=... --status=success|failed|partial --error='...'
 *
 * CONTENT_PIPELINE_GENRE=living または article.pipelineGenre で channel を分離。
 */
const fs = require("fs");
const path = require("path");
const {
  withThreadsBeautyUtm,
  withInstagramBeautyUtm,
  normalizePipelineGenre,
} = require("./lib/utm.cjs");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output");
const historyDir = path.join(outputDir, "run-history");
const stepsPath = path.join(outputDir, ".run-steps.json");
const lastPath = path.join(outputDir, "last-run-summary.json");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "";
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
  const startedAt = (arg("--startedAt") || "").trim() || new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const status = (arg("--status") || "success").trim();
  const error = (arg("--error") || "").trim();

  const article = readJson(path.join(root, "input", "article.json"), {});
  const insta = readJson(path.join(root, "input", "instagram-post.json"), {});
  const blogger = readJson(path.join(outputDir, "last-blogger-publish.json"), {});
  const threads = readJson(path.join(outputDir, "last-threads-publish.json"), {});
  const ig = readJson(path.join(outputDir, "last-instagram-publish.json"), {});
  const xPub = readJson(path.join(outputDir, "last-x-publish.json"), {});
  const policy = readJson(path.join(outputDir, "policy", "last-policy-check.json"), null);
  const stepsMap = readJson(stepsPath, {});

  const pipelineGenre = normalizePipelineGenre(
    arg("--genre") ||
      process.env.CONTENT_PIPELINE_GENRE ||
      article.pipelineGenre ||
      (article.product && article.product.pipelineGenre) ||
      (article.product && article.product.genre) ||
      (insta && insta.genre),
  );
  const channel = `${pipelineGenre}-pipeline`;

  const productId =
    (article.product && article.product.id) ||
    blogger.productId ||
    threads.productId ||
    "";
  const blogUrl =
    (insta && insta.blogUrl) ||
    (article.product && article.product.blogUrl) ||
    blogger.blogUrl ||
    threads.blogUrl ||
    "";
  const selectedSource =
    article.selectedSource ||
    (article.product && article.product.selectedSource) ||
    "";
  const threadsPostId = (threads && threads.post_id) || null;
  const igPostId = (ig && (ig.post_id || ig.id)) || null;
  const xPostId = (xPub && xPub.post_id) || null;
  const utmUrl =
    (threads && threads.utmUrl) ||
    (blogUrl && productId
      ? withThreadsBeautyUtm(blogUrl, productId, {
          postId: threadsPostId || undefined,
          genre: pipelineGenre,
        })
      : null);
  const igUtmUrl =
    (insta && insta.blogUtmUrl) ||
    (ig && ig.utmUrl) ||
    (blogUrl && productId
      ? withInstagramBeautyUtm(blogUrl, productId, {
          postId: igPostId || undefined,
          genre: pipelineGenre,
        })
      : null);

  const steps = Object.keys(stepsMap)
    .sort((a, b) => {
      const na = Number(stepsMap[a].n || a);
      const nb = Number(stepsMap[b].n || b);
      return na - nb;
    })
    .map((k) => ({
      n: stepsMap[k].n,
      name: stepsMap[k].name,
      status: stepsMap[k].status,
      ...(stepsMap[k].error ? { error: stepsMap[k].error } : {}),
    }));

  const policyCheck = policy
    ? {
        checkedAt: policy.checkedAt || null,
        productId: policy.productId || productId || null,
        channel: policy.channel || null,
        result: policy.result || null,
        matchedRules: Array.isArray(policy.matchedRules)
          ? policy.matchedRules.map((m) => ({
              id: m.id,
              severity: m.severity,
              pattern: m.pattern,
              category: m.category,
            }))
          : [],
        checkedTextPreview: policy.checkedTextPreview || null,
      }
    : null;

  const instaPost = readJson(path.join(root, "input", "instagram-post.json"), {});
  const summary = {
    startedAt,
    finishedAt,
    status,
    productId: productId || null,
    blogUrl: blogUrl || null,
    utmUrl: utmUrl || null,
    igUtmUrl: igUtmUrl || null,
    igPostId,
    threadsPostId,
    xPostId,
    selectedSource: selectedSource || null,
    postPattern: instaPost.postPattern || null,
    genre: pipelineGenre,
    channel,
    policyCheck,
    steps,
    error: error || null,
  };

  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(lastPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const histPath = path.join(historyDir, `${pipelineGenre}-${stamp}.json`);
  fs.writeFileSync(histPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`runサマリ保存: ${lastPath}`);
  console.log(`run履歴保存: ${histPath}`);
  console.log(
    `status=${summary.status} genre=${pipelineGenre} channel=${channel} productId=${summary.productId || "-"}`,
  );

  // 商品別反応履歴へ append（失敗してもサマリ自体は残す）
  const append = spawnSync(
    process.execPath,
    [path.join(__dirname, "append-post-metrics.cjs"), "--from-summary"],
    { cwd: root, encoding: "utf8" },
  );
  if (append.stdout) process.stdout.write(append.stdout);
  if (append.status !== 0) {
    if (append.stderr) process.stderr.write(append.stderr);
    console.error("warn: append-post-metrics 失敗（runサマリは保存済み）");
  }
}

main();
