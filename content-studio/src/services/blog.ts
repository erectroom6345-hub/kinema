import { resolveGenreProfile } from "../config/genres.ts";
import type { ArticleAnalysis, BlogDraft, ImageBundle, LlmClient } from "../types/index.ts";
import { safeComplete } from "../adapters/llm.ts";
import { buildBlogUserPrompt } from "../prompts/blog.ts";
import { buildPublicBody, publicBodyToHtml } from "../formatters/polish.ts";

export async function createBlogDraft(params: {
  llm: LlmClient;
  title: string;
  topic: string;
  genre: string;
  sourceBody: string;
  analysis: ArticleAnalysis;
  images: ImageBundle;
  isPr: boolean;
  blogName: string;
}): Promise<BlogDraft> {
  const title = params.title || params.analysis.title_candidates[0] || params.topic;
  const outline = defaultOutline(params.analysis.is_product_oriented);
  const fallbackBody = buildTemplateBody({
    title,
    topic: params.topic,
    genre: params.genre,
    sourceBody: params.sourceBody,
    analysis: params.analysis,
    isPr: params.isPr,
    blogName: params.blogName,
    outline,
  });

  const generated = await safeComplete(
    params.llm,
    [
      {
        role: "user",
        content: buildBlogUserPrompt({
          title,
          topic: params.topic,
          sourceBody: params.sourceBody,
          outline,
          analysis: params.analysis,
          isPr: params.isPr,
        }),
      },
    ],
    fallbackBody,
  );

  // 画像は result.images / *.images.json に分離。公開本文には混ぜない
  const publicBody = buildPublicBody(stripEmojis(generated));
  return {
    title,
    outline,
    public_body: publicBody,
    body_markdown: publicBody,
    body_html: publicBodyToHtml(publicBody, outline),
  };
}

export function defaultOutline(productOriented: boolean): string[] {
  if (productOriented) {
    return [
      "はじめに",
      "どんな人に向きやすいか",
      "見るべきポイント",
      "使い方のヒント",
      "まとめ",
    ];
  }
  return [
    "はじめに",
    "よくあるつまずき",
    "考え方の整理",
    "今日からできること",
    "まとめ",
  ];
}

function buildTemplateBody(params: {
  title: string;
  topic: string;
  genre: string;
  sourceBody: string;
  analysis: ArticleAnalysis;
  isPr: boolean;
  blogName: string;
  outline: string[];
}): string {
  const profile = resolveGenreProfile(params.genre);
  const prLine = params.isPr ? "※本記事にはPRを含みます。\n\n" : "";
  const sections = params.outline
    .map((heading, index) => {
      if (index === 0) {
        return `${heading}\n\n${params.topic}について、結論から先に整理します。${profile.caution}\n`;
      }
      if (heading === "まとめ") {
        return `${heading}\n\n完璧を目指すより、続けやすい選択を残しておく方が負担は小さくなります。詳細は${params.blogName}の本文で、判断の軸だけ先に持って帰れるようにしています。\n`;
      }
      return `${heading}\n\n${params.analysis.suggested_hooks[Math.min(index - 1, params.analysis.suggested_hooks.length - 1)]}\n`;
    })
    .join("\n");

  return `${params.title}\n\n${prLine}${sections}`;
}

export function stripEmojis(value: string): string {
  return value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/[✅✨🔥❤💕😊🙂🙏💡📌]/g, "");
}
