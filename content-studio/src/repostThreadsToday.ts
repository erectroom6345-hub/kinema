/**
 * 今日の最新美容ブログ記事に対して Threads だけ再投稿する。
 * - Blogger posts.insert は呼ばない
 * - Instagram publish は呼ばない
 * - Threads 投稿担当: src/services/threads.ts の publishThreadsTextPost
 *   エントリ: 本ファイル / 通常フローは src/postThreads.ts
 *
 * Usage:
 *   npx tsx src/repostThreadsToday.ts --dry-run
 *   npx tsx src/repostThreadsToday.ts --apply
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createBloggerClient } from "./adapters/blogger.ts";
import { getConfig, loadEnv } from "./config/env.ts";
import type { BloggerPostSummary } from "./types/index.ts";
import {
  buildThreadsTextFromBeauty,
  buildThreadsTrackUrl,
  isThreadsEnabled,
  listRecentThreadsPosts,
  loadThreadsEnvFromFile,
  publishThreadsTextPost,
  readThreadsCredentialsFromEnv,
  threadsTextMentionsBlogUrl,
} from "./services/threads.ts";
import { describeUtm } from "./utils/utm.ts";

loadThreadsEnvFromFile(process.cwd());

const articlePath = path.resolve("input/article.json");
const instaPath = path.resolve("input/instagram-post.json");
const lastThreadsPath = path.resolve("output/last-threads-publish.json");
const outDir = path.resolve("output");

function parseArgs(argv: string[]) {
  const out = { dryRun: true, apply: false, help: false, force: false };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      out.dryRun = true;
      out.apply = false;
    } else if (arg === "--apply") {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function tokyoDayBounds(now = new Date()): {
  day: string;
  startIso: string;
  endIso: string;
} {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${day}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day, startIso: start.toISOString(), endIso: end.toISOString() };
}

function publishedInRange(published: string, startIso: string, endIso: string): boolean {
  const t = Date.parse(published);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "") || u.origin;
  } catch {
    return (url || "").trim().replace(/\/+$/, "");
  }
}

function pickLatestTodayPost(posts: BloggerPostSummary[]): BloggerPostSummary | null {
  if (posts.length === 0) return null;
  return [...posts].sort(
    (a, b) => Date.parse(b.published) - Date.parse(a.published),
  )[0];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  npx tsx src/repostThreadsToday.ts --dry-run
  npx tsx src/repostThreadsToday.ts --apply
  npx tsx src/repostThreadsToday.ts --apply --force   # 重複判定を無視

Threads投稿担当:
  - publish: src/services/threads.ts :: publishThreadsTextPost
  - 本文生成: src/services/threads.ts :: buildThreadsTextFromBeauty
  - 通常フロー入口: src/postThreads.ts
  - 本CLI: src/repostThreadsToday.ts`);
    return;
  }

  loadEnv();
  const config = getConfig();
  const blogId = config.bloggerBlogId.trim();
  if (!blogId) throw new Error("BLOGGER_BLOG_ID が未設定です");

  if (!isThreadsEnabled() && process.env.THREADS_FORCE !== "true" && !args.apply) {
    // dry-run は確認のため通す。apply 時は THREADS_ENABLED か FORCE が必要
  }
  if (args.apply && !isThreadsEnabled() && process.env.THREADS_FORCE !== "true") {
    throw new Error(
      "Threads本番投稿には THREADS_ENABLED=true か THREADS_FORCE=true が必要です",
    );
  }

  const bounds = tokyoDayBounds();
  console.log(
    `repostThreadsToday: day=${bounds.day} mode=${args.apply ? "APPLY" : "DRY-RUN"}`,
  );

  // 1) 今日の最新 Blogger 記事を特定（insert はしない）
  const client = createBloggerClient();
  if (!client.listPosts) {
    throw new Error("Blogger client が listPosts 未対応です");
  }
  const listed = await client.listPosts({
    blogId,
    startDate: bounds.startIso,
    endDate: bounds.endIso,
    status: "LIVE",
    maxResults: 50,
  });
  const today = listed.filter((p) =>
    publishedInRange(p.published, bounds.startIso, bounds.endIso),
  );
  const target = pickLatestTodayPost(today);
  if (!target) {
    throw new Error(`今日(${bounds.day})の公開済み美容記事が見つかりません`);
  }

  console.log("========== 対象記事 ==========");
  console.log(`title: ${target.title}`);
  console.log(`postId: ${target.id}`);
  console.log(`url: ${target.url}`);
  console.log(`published: ${target.published}`);
  console.log("==============================");

  // 2) 既存データから本文・商品情報を取得（IG/Blogger は投稿しない）
  const article = readJson<{
    title?: string;
    body?: string;
    product?: {
      id?: string;
      name?: string;
      brand?: string;
      genre?: string;
      blogUrl?: string;
      imageUrl?: string;
      url?: string;
    };
  }>(articlePath);
  const insta = readJson<{
    caption?: string;
    blogUrl?: string;
    productName?: string;
    brand?: string;
    genre?: string;
    imageUrl?: string;
    productUrl?: string;
  }>(instaPath);

  const productId = (article?.product?.id || "").trim();
  const productName = (
    insta?.productName ||
    article?.product?.name ||
    ""
  ).trim();
  const brand = (insta?.brand || article?.product?.brand || "").trim();
  const genre = (insta?.genre || article?.product?.genre || "").trim();
  const imageUrl = (
    insta?.imageUrl ||
    article?.product?.imageUrl ||
    ""
  ).trim();
  const productPageUrl = (
    article?.product?.url ||
    insta?.productUrl ||
    ""
  ).trim();

  // Threads 導線は「今日の最新記事URL」を優先（instagram-post の古いURLより優先）
  const blogUrl = target.url.trim();

  console.log("既存データ:");
  console.log(`  productId=${productId || "-"}`);
  console.log(`  productName=${productName || "-"}`);
  console.log(`  brand=${brand || "-"}`);
  console.log(`  genre=${genre || "-"}`);
  console.log(`  imageUrl=${imageUrl || "(なし)"}`);
  console.log(`  productPageUrl=${productPageUrl || "(なし)"}`);
  console.log(`  captionSource=${insta?.caption ? "instagram-post.json" : "article.body/title"}`);

  const text = buildThreadsTextFromBeauty({
    caption: insta?.caption,
    body: article?.body,
    title: article?.title || target.title,
    blogUrl,
    productId,
    productName,
    brand,
    genre,
  });

  const utmUrl =
    blogUrl && productId
      ? buildThreadsTrackUrl({ blogUrl, productId })
      : blogUrl;

  console.log("---- Threads 投稿予定テキスト ----");
  console.log(text);
  console.log("--------------------------------");
  console.log("---- Threads Blogger UTM ----");
  console.log(`生成前URL: ${blogUrl}`);
  console.log(`生成後URL: ${utmUrl}`);
  console.log(`付与utm: ${JSON.stringify(describeUtm(utmUrl))}`);

  // 5) 重複判定
  let duplicate: { id: string; timestamp?: string; permalink?: string } | null =
    null;
  try {
    readThreadsCredentialsFromEnv();
    const recent = await listRecentThreadsPosts({ limit: 20 });
    const hit = recent.find((p) => threadsTextMentionsBlogUrl(p.text, blogUrl));
    if (hit) {
      duplicate = {
        id: hit.id,
        timestamp: hit.timestamp,
        permalink: hit.permalink,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`重複チェック（Threads一覧）失敗: ${msg}`);
  }

  const lastLocal = readJson<{
    post_id?: string;
    blogUrl?: string;
    text?: string;
    at?: string;
  }>(lastThreadsPath);
  if (
    !duplicate &&
    lastLocal?.blogUrl &&
    normalizeUrlKey(lastLocal.blogUrl) === normalizeUrlKey(blogUrl)
  ) {
    duplicate = {
      id: lastLocal.post_id || "(local-last-threads-publish)",
      timestamp: lastLocal.at,
    };
  }

  if (duplicate && !args.force) {
    console.log(
      `[skip:duplicate] 同URLの Threads 投稿が既にあります` +
        ` threadsId=${duplicate.id}` +
        (duplicate.timestamp ? ` at=${duplicate.timestamp}` : "") +
        (duplicate.permalink ? ` permalink=${duplicate.permalink}` : ""),
    );
    console.log("再投稿するには --force を付けてください");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `repost-threads-${bounds.day}-skipped.json`),
      `${JSON.stringify(
        {
          ok: false,
          reason: "duplicate",
          mode: args.apply ? "apply" : "dry-run",
          target: {
            title: target.title,
            postId: target.id,
            url: target.url,
            published: target.published,
          },
          duplicate,
          plannedText: text,
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return;
  }

  if (args.dryRun) {
    console.log(
      `[dry-run] Threads 投稿は行いません` +
        (duplicate ? "（--force なら重複でも投稿可）" : ""),
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `repost-threads-${bounds.day}-dry-run.json`),
      `${JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          target: {
            title: target.title,
            postId: target.id,
            url: target.url,
            published: target.published,
          },
          productId,
          productName,
          brand,
          imageUrl: imageUrl || null,
          productPageUrl: productPageUrl || null,
          plannedText: text,
          utmUrl,
          duplicate,
          threadsPublisher: "src/services/threads.ts::publishThreadsTextPost",
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log("dry-run ログを output/ に保存しました");
    return;
  }

  // 4) Threads のみ投稿
  console.log(
    "Threads投稿実行: publisher=src/services/threads.ts::publishThreadsTextPost",
  );
  const result = await publishThreadsTextPost({ text });
  console.log(
    JSON.stringify(
      {
        ok: true,
        post_id: result.postId,
        creation_id: result.creationId,
        bloggerPostId: target.id,
        blogUrl,
        utmUrl,
      },
      null,
      2,
    ),
  );

  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    ok: true,
    mode: "apply",
    post_id: result.postId,
    creation_id: result.creationId,
    text: result.text,
    blogUrl,
    utmUrl,
    productId: productId || null,
    productName: productName || null,
    imageUrl: imageUrl || null,
    blogger: {
      title: target.title,
      postId: target.id,
      url: target.url,
      published: target.published,
    },
    threadsPublisher: "src/services/threads.ts::publishThreadsTextPost",
    at: new Date().toISOString(),
  };
  fs.writeFileSync(
    lastThreadsPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, `repost-threads-${bounds.day}-apply.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  console.log(`成功ログ: ${lastThreadsPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("repostThreadsToday 失敗:", msg);
  fs.mkdirSync(outDir, { recursive: true });
  const day = tokyoDayBounds().day;
  fs.writeFileSync(
    path.join(outDir, `repost-threads-${day}-error.json`),
    `${JSON.stringify(
      {
        ok: false,
        error: msg,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.exit(1);
});
