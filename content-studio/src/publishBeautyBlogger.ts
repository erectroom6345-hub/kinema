/**
 * beauty 経路用: article.json のメモ本文を膨らませて Blogger 公開し、URL を blogUrl に書き戻す。
 * - Blogger本文は createBlogDraft で生成（Ollama失敗時は必ずフォールバック）
 * - article.body（短いメモ）は Instagram 用に残し、blogBody に公開本文を保存
 * - 既に有効な blogUrl がある場合は公開をスキップ
 * - Instagram caption には URL を入れない（保持のみ。X/Threads 向け）
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

const articlePath = "input/article.json";
const productsPath = "input/products-beauty.json";
const outBodyPath = path.resolve("output", "last-blogger-body.txt");

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
    postType?: string;
    blogUrl?: string;
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
  console.log(`products-beauty.json に blogUrl を書き戻しました: ${productId}`);
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
  const title = (article.title || "").trim() || "Beauty Notes";
  const sourceBody = (article.body || "").trim();
  const genre = (article.product?.genre || config.defaultGenre || "beauty").trim();
  const topic =
    (article.product?.name || article.product?.brand || title || genre).trim() || "美容";
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
    blogName: "Beauty Notes",
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
  const genre = (article.product?.genre || config.defaultGenre || "beauty").trim();
  const topic =
    (article.product?.name || article.product?.brand || title || genre).trim() || "美容";
  const isPr = Boolean(article.affiliateNote && article.affiliateNote.trim());

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
      blogName: "Beauty Notes",
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

  // 本文生成は公開スキップ時も実行可（SAMPLE_BLOG_BODY=1 または 公開が必要なとき）
  const forceSample = process.env.SAMPLE_BLOG_BODY === "1";
  const needPublish = isUnusableBlogUrl(existing);

  if (!needPublish && !forceSample) {
    console.log(`既存の有効な blogUrl を使用（Blogger公開スキップ）: ${existing}`);
    console.log("※ Instagram caption には URL を入れません（X/Threads 用に保持）");
    console.log("※ 本文サンプルだけ欲しい場合は SAMPLE_BLOG_BODY=1 で実行");
    return;
  }

  const generated = await generateBloggerBody(article);
  article.blogBody = generated.publicBody;
  writeJson(articlePath, article);
  console.log("article.json に blogBody を保存しました（body は IG用メモのまま）");
  savePostedBody(generated.publicBody, generated.generationSource);

  if (!needPublish) {
    console.log("SAMPLE_BLOG_BODY=1 のため公開はスキップ（本文サンプルのみ保存）");
    return;
  }

  const blogId = config.bloggerBlogId.trim();
  if (!blogId) {
    throw new Error("BLOGGER_BLOG_ID が未設定です");
  }

  const client = createBloggerClient();
  const contentHtml =
    generated.contentHtml.trim() || bodyToHtml(generated.publicBody, article.affiliateNote);
  const labels = [article.product?.genre, article.product?.postType]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  console.log("Blogger 公開を開始します...");
  console.log(`blogId=${blogId}`);
  console.log(`title=${generated.title}`);
  console.log(`bodySource=${generated.generationSource}`);

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
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Blogger公開エラー:", msg);
  process.exit(1);
});
