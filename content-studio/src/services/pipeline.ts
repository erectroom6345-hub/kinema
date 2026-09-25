import { getConfig, loadEnv } from "../config/env.ts";
import { createBloggerClient } from "../adapters/blogger.ts";
import { createLlmClient } from "../adapters/llm.ts";
import { createStockAdapter } from "../adapters/stock.ts";
import { getPublicBodyText, toMarkdownPreview } from "../formatters/outputs.ts";
import { analyzeArticle } from "./analyze.ts";
import { createBlogDraft } from "./blog.ts";
import { selectImages } from "./images.ts";
import { normalizeInput, parseJobInput } from "./input.ts";
import { createSnsOutputs } from "./sns.ts";
import { logger } from "../utils/logger.ts";
import type { ArticleJobInput, ArticleJobResult, PipelineOptions } from "../types/index.ts";

export async function runPipeline(rawInput: ArticleJobInput, options: PipelineOptions = {}): Promise<ArticleJobResult> {
  loadEnv();
  const config = getConfig();
  const input = normalizeInput(parseJobInput(rawInput), config.defaultGenre);

  logger.debug("pipeline start", { topic: input.topic, genre: input.genre });

  const analysis = analyzeArticle({
    title: input.article_title,
    body: input.article_body,
    topic: input.topic,
    genre: input.genre,
  });

  const llm = options.llm ?? createLlmClient(config);
  const stock = options.stock ?? createStockAdapter(config.defaultStockProvider, config);

  const title = input.article_title || analysis.title_candidates[0] || input.topic;
  const images = await selectImages({
    adapter: stock,
    genre: input.genre,
    keywords: analysis.image_keywords,
    title,
    aspImage: rawInput.asp_image,
    skip: options.skipImages,
  });

  const blogDraft = await createBlogDraft({
    llm,
    title,
    topic: input.topic,
    genre: input.genre,
    sourceBody: input.article_body,
    analysis,
    images,
    isPr: input.is_pr,
    blogName: input.blog_name,
  });

  const outputs = await createSnsOutputs({
    llm,
    title: blogDraft.title,
    topic: input.topic,
    genre: input.genre,
    analysis,
    articleUrl: input.article_url,
    isPr: input.is_pr,
  });

  const result: ArticleJobResult = {
    input_summary: {
      blog_name: input.blog_name,
      blog_url: input.blog_url,
      article_url: input.article_url,
      article_title: blogDraft.title,
      topic: input.topic,
      genre: input.genre,
      is_pr: input.is_pr,
      publish_date: input.publish_date,
      has_source_body: Boolean(input.article_body),
    },
    analysis,
    blog_draft: blogDraft,
    images,
    outputs,
  };

  logger.debug("pipeline done", { title: blogDraft.title, hero: Boolean(images.hero.url) });
  return result;
}

export function formatResult(result: ArticleJobResult, format: "json" | "markdown" | "both" | "public"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "markdown") return toMarkdownPreview(result);
  if (format === "public") return getPublicBodyText(result);
  return getPublicBodyText(result);
}

export { createBloggerClient };
