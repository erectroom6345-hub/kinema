/**
 * beauty / living 共通の Threads 投稿エントリ（薄い呼び出し層）
 * - 本文は instagram-post / article の既存生成結果から組み立て
 * - living は instagram-post.threadsText があれば優先（美容用語・DM誘導なし）
 * - 失敗時も process.exit(1) にしない選択は呼び出し側（run-*-sh のソフトSTEP）
 */
import fs from "node:fs";
import {
  buildThreadsTextFromBeauty,
  buildThreadsTrackUrl,
  isThreadsEnabled,
  loadThreadsEnvFromFile,
  publishThreadsTextPost,
  readThreadsCredentialsFromEnv,
} from "./services/threads.ts";
import { buildTrackUrl, describeUtm, normalizePipelineGenre } from "./utils/utm.ts";

// 既存シェル変数より .env を優先
loadThreadsEnvFromFile(process.cwd());

const articlePath = "input/article.json";
const instaPath = "input/instagram-post.json";

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!isThreadsEnabled() && process.env.THREADS_FORCE !== "true") {
    console.log("Threads投稿スキップ: THREADS_ENABLED!=true（強制は THREADS_FORCE=true）");
    return;
  }

  const article = readJson<{
    title?: string;
    body?: string;
    pipelineGenre?: string;
    product?: {
      id?: string;
      blogUrl?: string;
      name?: string;
      brand?: string;
      genre?: string;
      pipelineGenre?: string;
    };
  }>(articlePath);
  const insta = readJson<{
    caption?: string;
    blogUrl?: string;
    productName?: string;
    brand?: string;
    genre?: string;
    threadsText?: string;
    threadsUtmUrl?: string;
  }>(instaPath);

  const pipelineGenre = normalizePipelineGenre(
    article?.pipelineGenre ||
      article?.product?.pipelineGenre ||
      article?.product?.genre ||
      insta?.genre ||
      process.env.CONTENT_PIPELINE_GENRE,
  );

  const blogUrl = (insta?.blogUrl || article?.product?.blogUrl || "").trim();
  const productId = (article?.product?.id || "").trim();
  const productName = (insta?.productName || article?.product?.name || "").trim();
  const brand = (insta?.brand || article?.product?.brand || "").trim();
  const genre = (insta?.genre || article?.product?.genre || "").trim();
  const utmUrl =
    (insta?.threadsUtmUrl || "").trim() ||
    (blogUrl && productId
      ? buildTrackUrl({
          blogUrl,
          productId,
          source: "threads",
          genre: pipelineGenre,
        })
      : blogUrl || "");

  // living: 事前生成の threadsText を優先（なければ beauty 互換ビルダー）
  let text = (insta?.threadsText || "").trim();
  if (!text) {
    text = buildThreadsTextFromBeauty({
      caption: insta?.caption,
      body: article?.body,
      title: article?.title,
      blogUrl,
      productId,
      productName,
      brand,
      genre,
    });
    // living のときは campaign を living_ に差し替え（本文末尾URL）
    if (pipelineGenre === "living" && blogUrl && productId) {
      const livingUtm = buildTrackUrl({
        blogUrl,
        productId,
        source: "threads",
        genre: "living",
      });
      const beautyUtm = buildThreadsTrackUrl({ blogUrl, productId });
      if (text.includes(beautyUtm)) {
        text = text.split(beautyUtm).join(livingUtm);
      } else if (!text.includes(livingUtm)) {
        text = `${text.replace(/\n*https?:\/\/\S+\s*$/m, "").trim()}\n${livingUtm}`;
      }
    }
  }

  console.log(`Threads投稿文プレビュー (genre=${pipelineGenre}):`);
  console.log(text);
  console.log("---");
  if (blogUrl) {
    console.log("---- Threads Blogger UTM ----");
    console.log(`productId: ${productId || "-"}`);
    console.log(`pipelineGenre: ${pipelineGenre}`);
    console.log("channel: threads");
    console.log(`生成前URL: ${blogUrl}`);
    console.log(`生成後URL: ${utmUrl || "(なし)"}`);
    console.log(`付与utm: ${JSON.stringify(describeUtm(utmUrl))}`);
  }

  readThreadsCredentialsFromEnv();

  const result = await publishThreadsTextPost({ text });
  console.log(
    JSON.stringify(
      {
        ok: true,
        post_id: result.postId,
        creation_id: result.creationId,
        utmUrl: utmUrl || null,
        genre: pipelineGenre,
      },
      null,
      2,
    ),
  );

  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-threads-publish.json",
    `${JSON.stringify(
      {
        post_id: result.postId,
        creation_id: result.creationId,
        text: result.text,
        blogUrl: blogUrl || null,
        utmUrl: utmUrl || null,
        productId: productId || null,
        genre: pipelineGenre,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Threads投稿エラー（独立失敗）:", msg);
  process.exit(1);
});
