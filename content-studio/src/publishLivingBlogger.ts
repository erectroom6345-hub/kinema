/**
 * living 経路用: article.json のメモ本文を膨らませて Blogger 公開し、URL を blogUrl に書き戻す。
 * - 楽天アフィリエイトURL（rakutenUrl）を本文に載せる
 * - beauty の publishBeautyBlogger を流用（入出力パスとジャンルだけ分離）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createBloggerClient } from "./adapters/blogger.ts";
import { createLlmClient, TemplateLlmClient } from "./adapters/llm.ts";
import { getConfig, loadEnv } from "./config/env.ts";
import { analyzeArticle } from "./services/analyze.ts";
import {
  buildFallbackBlogBody,
  createBlogDraft,
  isUsableBlogBody,
  type BlogGenerationSource,
} from "./services/blog.ts";
import { publicBodyToHtml } from "./formatters/polish.ts";
import {
  enrichContentHtml,
  isUsableAffiliateUrl,
  isUsableImageUrl,
} from "./services/bloggerContentEnrich.ts";

const articlePath = "input/article.json";
const productsPath = "input/products-living.json";
const outBodyPath = path.resolve("output", "last-blogger-body.txt");
const blogReadyPath = path.resolve("output", "blog-ready.json");
const BLOG_NAME = "暮らし便利メモ";
const PIPELINE_GENRE = "living";

function writeBlogReady(payload: {
  ok: boolean;
  mode: "published" | "reused" | "sample" | "failed";
  blogUrl?: string;
  productId?: string;
  reason?: string;
}): void {
  fs.mkdirSync(path.dirname(blogReadyPath), { recursive: true });
  fs.writeFileSync(
    blogReadyPath,
    `${JSON.stringify(
      {
        ...payload,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

interface ArticleFile {
  title?: string;
  body?: string;
  /** Blogger公開用の厚い本文（IG用の短い body とは分離） */
  blogBody?: string;
  affiliateNote?: string;
  product?: {
    id?: string;
    name?: string;
    brand?: string;
    genre?: string;
    pipelineGenre?: string;
    category?: string;
    postType?: string;
    blogUrl?: string;
    /** 楽天アフィリエイトURL */
    url?: string;
    rakutenUrl?: string;
    imageUrl?: string;
  };
}

interface ProductsFile {
  sale?: ProductItem[];
  main?: ProductItem[];
  niche?: ProductItem[];
  routine?: ProductItem[];
  [key: string]: ProductItem[] | undefined;
}

interface ProductItem {
  id: string;
  blogUrl?: string;
  [key: string]: unknown;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** ブログトップ・仮値は不可。個別記事URLのみ可 */
function isUnusableBlogUrl(blogUrl: string): boolean {
  const raw = blogUrl.trim();
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bodyToHtml(body: string, affiliateNote?: string): string {
  const text = body.replace(/\r\n/g, "\n").trim();
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>\n")}</p>`);

  const note = (affiliateNote || "").trim();
  if (note) {
    paragraphs.push(`<p><em>${escapeHtml(note)}</em></p>`);
  }
  return paragraphs.join("\n") || "<p></p>";
}

function writeBackProductBlogUrl(productId: string, blogUrl: string): void {
  if (!fs.existsSync(productsPath)) {
    console.warn(`在庫JSONが無いため書き戻しスキップ: ${productsPath}`);
    return;
  }
  const products = readJson<ProductsFile>(productsPath);
  let updated = false;
  for (const key of Object.keys(products)) {
    const list = products[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item?.id === productId) {
        item.blogUrl = blogUrl;
        updated = true;
      }
    }
  }
  if (!updated) {
    console.warn(`在庫JSONに id=${productId} が見つかりません（書き戻しスキップ）`);
    return;
  }
  writeJson(productsPath, products);
  console.log(`products-living.json に blogUrl を書き戻しました: ${productId}`);
}

function savePostedBody(publicBody: string, source: BlogGenerationSource): void {
  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outBodyPath, `${publicBody.trim()}\n`, "utf8");
  console.log(`投稿用本文を保存: ${outBodyPath} (source=${source})`);
}

function buildForcedFallback(
  article: ArticleFile,
  reason: string,
): {
  title: string;
  publicBody: string;
  contentHtml: string;
  generationSource: BlogGenerationSource;
} {
  const config = getConfig();
  const title = (article.title || "").trim() || "暮らし便利メモ";
  const sourceBody = (article.body || "").trim();
  const genre = PIPELINE_GENRE;
  const topic =
    (article.product?.name || title || genre).trim() || "暮らし便利グッズ";
  const isPr = Boolean(article.affiliateNote && article.affiliateNote.trim());
  const analysis = analyzeArticle({ title, body: sourceBody, topic, genre });

  console.warn(`Blogger本文: フォールバック強制 (${reason})`);
  const publicBody = buildFallbackBlogBody({
    title,
    topic,
    genre,
    sourceBody,
    analysis,
    isPr,
    blogName: BLOG_NAME,
  });
  const outline = ["気になりやすいところ", "選び方のヒント", "自分に合いそうかの目安"];
  const note = (article.affiliateNote || "").trim();
  let contentHtml = publicBodyToHtml(publicBody, outline);
  if (note) contentHtml += `\n<p><em>${escapeHtml(note)}</em></p>`;

  if (!isUsableBlogBody(publicBody)) {
    throw new Error("フォールバック本文が短すぎます（実装バグ）");
  }

  return {
    title,
    publicBody,
    contentHtml: contentHtml || bodyToHtml(publicBody, article.affiliateNote),
    generationSource: "fallback",
  };
}

/**
 * Ollama成功/失敗どちらでも必ず厚い本文を返す。生成失敗で throw しない。
 */
async function generateBloggerBody(article: ArticleFile): Promise<{
  title: string;
  publicBody: string;
  contentHtml: string;
  generationSource: BlogGenerationSource;
}> {
  const config = getConfig();
  const title = (article.title || "").trim();
  const sourceBody = (article.body || "").trim();
  const genre = PIPELINE_GENRE;
  const productName = (article.product?.name || "").trim();
  const category = (article.product?.category || "").trim();
  const topic = productName || title || genre || "暮らし便利グッズ";
  const isPr = Boolean(article.affiliateNote && article.affiliateNote.trim());
  console.log(`Blogger題材: productName=${productName || "-"} category=${category || "-"} topic=${topic}`);

  const analysis = analyzeArticle({
    title,
    body: sourceBody,
    topic,
    genre,
  });

  try {
    const llm = createLlmClient(config);
    const modeHint =
      llm instanceof TemplateLlmClient ? "template→フォールバック" : "Ollama優先（失敗時フォールバック）";
    console.log(`Blogger本文を生成します (${modeHint})...`);

    const draft = await createBlogDraft({
      llm,
      title,
      topic,
      genre,
      sourceBody,
      analysis,
      images: {
        hero: { source: "none", url: "", alt: "", credit: "" },
        inline: [],
      },
      isPr,
      blogName: BLOG_NAME,
    });

    const publicBody = draft.public_body.trim();
    if (!isUsableBlogBody(publicBody)) {
      return buildForcedFallback(article, "生成結果が短すぎる");
    }

    const note = (article.affiliateNote || "").trim();
    const contentHtml = note
      ? `${draft.body_html}\n<p><em>${escapeHtml(note)}</em></p>`
      : draft.body_html;

    const label =
      draft.generationSource === "ollama" ? "Ollama生成" : "フォールバック生成";
    console.log(`Blogger本文生成完了: ${label} / ${[...publicBody].length}字`);
    return {
      title: draft.title,
      publicBody,
      contentHtml,
      generationSource: draft.generationSource,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return buildForcedFallback(article, msg);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const config = getConfig();

  if (!fs.existsSync(articlePath)) {
    throw new Error(`${articlePath} がありません。先に商品選択を実行してください。`);
  }

  const article = readJson<ArticleFile>(articlePath);
  const title = (article.title || "").trim();
  const body = (article.body || "").trim();
  const productId = (article.product?.id || "").trim();
  const existing = (article.product?.blogUrl || "").trim();

  if (!title || !body) {
    throw new Error("article.json に title / body が必要です");
  }
  if (!productId) {
    throw new Error("article.json に product.id が必要です");
  }

  // 本文生成は公開スキップ時も実行可（SAMPLE_BLOG_BODY=1）
  const forceSample = process.env.SAMPLE_BLOG_BODY === "1";
  const reuseExisting =
    String(process.env.BLOGGER_REUSE_EXISTING_URL || "").toLowerCase() === "true" &&
    !isUnusableBlogUrl(existing);
  const needPublish = !reuseExisting && !forceSample;

  if (reuseExisting && !forceSample) {
    console.log(`BLOGGER_REUSE_EXISTING_URL=true のため公開スキップ: ${existing}`);
    console.log("※ Instagram caption には URL を入れません（X/Threads 用に保持）");
    writeBlogReady({
      ok: true,
      mode: "reused",
      blogUrl: existing,
      productId,
      reason: "BLOGGER_REUSE_EXISTING_URL",
    });
    return;
  }

  const generated = await generateBloggerBody(article);
  article.blogBody = generated.publicBody;
  writeJson(articlePath, article);
  console.log("article.json に blogBody を保存しました（body は IG用メモのまま）");
  savePostedBody(generated.publicBody, generated.generationSource);

  if (!needPublish) {
    console.log("SAMPLE_BLOG_BODY=1 のため公開はスキップ（本文サンプルのみ保存）");
    writeBlogReady({
      ok: false,
      mode: "sample",
      productId,
      reason: "SAMPLE_BLOG_BODY=1（公開なし→SNS不可）",
    });
    return;
  }

  if (existing && !isUnusableBlogUrl(existing)) {
    console.log(`既存 blogUrl あり → 新規記事を公開して差し替えます: ${existing}`);
  }

  const blogId = config.bloggerBlogId.trim();
  if (!blogId) {
    throw new Error("BLOGGER_BLOG_ID が未設定です");
  }

  const client = createBloggerClient();
  const baseHtml =
    generated.contentHtml.trim() || bodyToHtml(generated.publicBody, article.affiliateNote);
  const contentHtml = enrichContentHtml(baseHtml, {
    productId,
    productName: (article.product?.name || "").trim(),
    productUrl: (
      article.product?.rakutenUrl ||
      article.product?.url ||
      ""
    ).trim(),
    imageUrl: (article.product?.imageUrl || "").trim(),
    // affiliateNote は enrich 側でリンク直下に付ける（baseHtml 側の重複は許容）
    affiliateNote: "",
    allowRakuten: true,
    genre: PIPELINE_GENRE,
  });
  const labels = ["living", article.product?.category, article.product?.postType]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  console.log("Blogger 公開を開始します...");
  console.log(`blogId=${blogId}`);
  console.log(`title=${generated.title}`);
  console.log(`bodySource=${generated.generationSource}`);
  console.log(
    `affiliateUrl=${isUsableAffiliateUrl(article.product?.rakutenUrl || article.product?.url || "", { allowRakuten: true }) ? "yes" : "no"}` +
      ` productImage=${isUsableImageUrl(article.product?.imageUrl || "") ? "yes" : "no"}`,
  );

  const result = await client.saveDraft({
    blogId,
    title: generated.title,
    contentHtml,
    labels,
    isDraft: false,
  });

  const blogUrl = (result.url || "").trim();
  if (isUnusableBlogUrl(blogUrl)) {
    throw new Error(`公開後の URL が不正です: ${blogUrl || "(空)"} / postId=${result.postId}`);
  }

  // 公開に使った本文を再保存（最終確定）
  savePostedBody(generated.publicBody, generated.generationSource);

  article.product = { ...article.product, id: productId, blogUrl };
  writeJson(articlePath, article);
  writeBackProductBlogUrl(productId, blogUrl);

  console.log("Blogger公開成功");
  console.log(`postId: ${result.postId}`);
  console.log(`blogUrl: ${blogUrl}`);
  console.log(`bodySource=${generated.generationSource}`);
  console.log("article.json の product.blogUrl を更新しました");
  console.log("※ Instagram caption には URL を入れません（X/Threads 用に保持）");

  fs.writeFileSync(
    path.join(path.resolve("output"), "last-blogger-publish.json"),
    `${JSON.stringify(
      {
        postId: result.postId,
        blogUrl,
        productId,
        title: generated.title,
        blogBodyChars: [...generated.publicBody].length,
        bodySource: generated.generationSource,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeBlogReady({
    ok: true,
    mode: "published",
    blogUrl,
    productId,
  });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Blogger公開エラー:", msg);
  try {
    writeBlogReady({
      ok: false,
      mode: "failed",
      reason: msg.slice(0, 300),
    });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
