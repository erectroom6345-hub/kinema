import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmProvider } from "../adapters/llm.ts";
import type { Genre, StockProviderName } from "../types/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv(cwd = process.cwd()): void {
  loadDotenv({ path: resolve(cwd, ".env") });
  loadDotenv({ path: resolve(here, "../../.env") });
}

export interface AppConfig {
  pixabayApiKey: string;
  llmProvider: LlmProvider;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  bloggerApiKey: string;
  bloggerBlogId: string;
  defaultGenre: Genre;
  defaultStockProvider: StockProviderName;
  /** Instagram投稿用の固定画像（相対パス可・文字なし想定） */
  instagramFixedImage: string;
  /** 許可済み商品画像だけを置くフォルダ（ここ以外は参照しない） */
  instagramApprovedDir: string;
}

function resolveLlmProvider(raw?: string): LlmProvider {
  const value = (raw ?? "ollama").trim().toLowerCase();
  if (value === "openai" || value === "ollama" || value === "template") return value;
  return "template";
}

export function getConfig(): AppConfig {
  const genre = process.env.DEFAULT_GENRE ?? "beauty";
  const provider = process.env.DEFAULT_STOCK_PROVIDER ?? "pixabay";
  return {
    pixabayApiKey: process.env.PIXABAY_API_KEY ?? "",
    llmProvider: resolveLlmProvider(process.env.LLM_PROVIDER),
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "gemma3:4b",
    ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? "600000") || 600_000,
    bloggerApiKey: process.env.BLOGGER_API_KEY ?? "",
    bloggerBlogId: process.env.BLOGGER_BLOG_ID ?? "",
    defaultGenre: (genre as Genre) || "beauty",
    defaultStockProvider: provider === "pexels" ? "pexels" : "pixabay",
    instagramFixedImage: (process.env.INSTAGRAM_FIXED_IMAGE ?? "assets/instagram-fixed.jpg").trim(),
    instagramApprovedDir: (process.env.INSTAGRAM_APPROVED_DIR ?? "assets/instagram-approved").trim(),
  };
}
