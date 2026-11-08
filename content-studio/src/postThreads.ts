/**
 * beauty / living 共通の Threads 投稿エントリ（薄い呼び出し層）
 * - 本文は instagram-post / article の既存生成結果から組み立て
 * - living は instagram-post.threadsText があれば優先（美容用語・DM誘導なし）
 * - 失敗時も process.exit(1) にしない選択は呼び出し側（run-*-sh のソフトSTEP）
 */
import fs from "node:fs";
import {
  buildThreadsTextFromBeauty,
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
      postType?: string;
    };
  }>(articlePath);
  const insta = readJson<{
    caption?: string;
    blogUrl?: string;
    productName?: string;
    brand?: string;
    genre?: string;
    postType?: string;
    threadsText?: string;
    threadsUtmUrl?: string;
    videoUrl?: string;
    mediaType?: string;
  }>(instaPath);

  const pipelineGenre = normalizePipelineGenre(
    article?.pipelineGenre ||
      article?.product?.pipelineGenre ||
      article?.product?.genre ||
      insta?.genre ||
      process.env.CONTENT_PIPELINE_GENRE,
  );

  const isTip = String(article?.product?.postType || insta?.postType || "").toLowerCase() === "tip";
  const blogUrl = isTip
    ? ""
    : (insta?.blogUrl || article?.product?.blogUrl || "").trim();
  const productId = (article?.product?.id || "").trim();
  const productName = (insta?.productName || article?.product?.name || "").trim();
  const brand = (insta?.brand || article?.product?.brand || "").trim();
  const genre = (insta?.genre || article?.product?.genre || "").trim();
  // 美容以外は SNS完結（ブログ誘導なし）。UTM は美容 or 明示 threadsUtmUrl のみ
  const snsSelfContained = ["living", "gadget", "food", "drink"].includes(
    pipelineGenre,
  );
  const utmUrl = snsSelfContained
    ? ""
    : (insta?.threadsUtmUrl || "").trim() ||
      (blogUrl && productId
        ? buildTrackUrl({
            blogUrl,
            productId,
            source: "threads",
            genre: pipelineGenre,
          })
        : blogUrl || "");

  // 事前生成 threadsText を優先。美容以外は caption 完結（URL付けない）
  let text = (insta?.threadsText || "").trim();
  if (isTip) {
    text = String(insta?.caption || text)
      .replace(/\n*https?:\/\/\S+/gi, "")
      .replace(/\n*詳しくは、プロフィールのリンクからご覧ください\s*$/u, "")
      .trim();
  } else if (!text) {
    if (snsSelfContained) {
      text = String(insta?.caption || "")
        .replace(/\n*https?:\/\/\S+/gi, "")
        .trim();
    } else {
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
    }
  }

  console.log(`Threads投稿文プレビュー (genre=${pipelineGenre}):`);
  console.log(text);
  console.log("---");
  if (isTip) {
    console.log("---- Threads CTA ----");
    console.log("mode: beauty_tip (URLなし。ブログ誘導なし)");
  } else if (snsSelfContained) {
    console.log("---- Threads CTA ----");
    const hasAffiliate = /afl\.rakuten|hb\.afl\.rakuten|item\.rakuten/i.test(text);
    const hasBlog = /blogspot\.com|blogger\.com/i.test(text);
    console.log(
      hasBlog
        ? "mode: sns_self_contained (備蓄期間ブログURL直載せ)"
        : hasAffiliate
          ? "mode: sns_self_contained (楽天アフィ直載せ。ブログ誘導なし)"
          : "mode: sns_self_contained (URLなし tip等。ブログ誘導なし)",
    );
  } else if (blogUrl) {
    console.log("---- Threads Blogger UTM ----");
    console.log(`productId: ${productId || "-"}`);
    console.log(`pipelineGenre: ${pipelineGenre}`);
    console.log("channel: threads");
    console.log(`生成前URL: ${blogUrl}`);
    console.log(`生成後URL: ${utmUrl || "(なし)"}`);
    console.log(`付与utm: ${JSON.stringify(describeUtm(utmUrl))}`);
  }

  readThreadsCredentialsFromEnv();

  // Threads は動画を付けるとリンクカードが出ず商品へ飛びにくい。
  // Instagram だけリールにし、Threads はテキスト＋URL（タップ可）を既定にする。
  // 例外: THREADS_ATTACH_VIDEO=true のときだけ videoUrl を付ける。
  const videoUrl = String(insta?.videoUrl || "").trim();
  const wantVideo =
    (process.env.THREADS_ATTACH_VIDEO || "").trim().toLowerCase() === "true" &&
    Boolean(videoUrl) &&
    ["reel", "reels", "video"].includes(String(insta?.mediaType || "").toLowerCase());
  if (videoUrl && !wantVideo) {
    console.log(
      "Threads動画は付けません（商品リンク優先）。付ける場合は THREADS_ATTACH_VIDEO=true",
    );
  }
  if (wantVideo) {
    console.log(`Threads動画: ${videoUrl}`);
  }
  const result = await publishThreadsTextPost({
    text,
    videoUrl: wantVideo ? videoUrl : undefined,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        post_id: result.postId,
        creation_id: result.creationId,
        utmUrl: utmUrl || null,
        genre: pipelineGenre,
        attachedVideo: wantVideo,
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
        attachedVideo: wantVideo,
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
