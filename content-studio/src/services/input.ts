import { z } from "zod";
import type { ArticleJobInput } from "../types/index.ts";
import { AppError } from "../utils/errors.ts";

const aspSchema = z
  .object({
    url: z.string().url(),
    alt: z.string().optional(),
    credit: z.string().optional(),
  })
  .optional();

export const articleJobInputSchema = z
  .object({
    blog_name: z.string().optional(),
    blog_url: z.string().optional(),
    article_url: z.string().optional(),
    article_title: z.string().optional(),
    article_body: z.string().optional(),
    topic: z.string().optional(),
    genre: z.string().optional(),
    is_pr: z.boolean().optional(),
    publish_date: z.string().optional(),
    instagram_image_key: z.string().optional(),
    asp_image: aspSchema,
  })
  .refine(
    (value) => Boolean(value.topic?.trim() || value.article_title?.trim() || value.article_body?.trim()),
    { message: "topic / article_title / article_body のいずれかが必要です" },
  );

export function parseJobInput(raw: unknown): ArticleJobInput {
  const parsed = articleJobInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues.map((issue) => issue.message).join("; "), "INVALID_INPUT");
  }
  return parsed.data;
}

export function normalizeInput(input: ArticleJobInput, defaultGenre: string) {
  const topic = input.topic?.trim() || input.article_title?.trim() || "未設定テーマ";
  const title = input.article_title?.trim() || "";
  return {
    blog_name: input.blog_name?.trim() || "未設定ブログ",
    blog_url: input.blog_url?.trim() || "",
    article_url: input.article_url?.trim() || "",
    article_title: title,
    article_body: input.article_body?.trim() || "",
    topic,
    genre: (input.genre?.trim() || defaultGenre).toLowerCase(),
    is_pr: Boolean(input.is_pr),
    publish_date: input.publish_date?.trim() || "",
    asp_image: input.asp_image,
  };
}
