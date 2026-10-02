/**
 * Blogger本文のサンプル生成（公開はしない）
 * - デフォルト: 実LLM（失敗時フォールバック）
 * - FORCE_FALLBACK=1: フォールバックのみ
 * - FORCE_OLLAMA_OK=1: 成功経路をモック（公開フローが止まらないことの確認用）
 */
import fs from "node:fs";
import type { LlmClient, LlmMessage } from "../src/types/index.ts";
import { createLlmClient, TemplateLlmClient } from "../src/adapters/llm.ts";
import { getConfig, loadEnv } from "../src/config/env.ts";
import { analyzeArticle } from "../src/services/analyze.ts";
import {
  buildFallbackBlogBody,
  createBlogDraft,
  isUsableBlogBody,
} from "../src/services/blog.ts";

class FailingLlmClient implements LlmClient {
  async complete(): Promise<string> {
    throw new Error("simulated Ollama timeout");
  }
}

class OkMockLlmClient implements LlmClient {
  constructor(private readonly body: string) {}
  async complete(_messages: LlmMessage[]): Promise<string> {
    return this.body;
  }
}

async function runOnce(label: string, llm: LlmClient) {
  loadEnv();
  const config = getConfig();
  const article = JSON.parse(fs.readFileSync("input/article.json", "utf8")) as {
    title?: string;
    body?: string;
    affiliateNote?: string;
    product?: { name?: string; genre?: string };
  };

  const title = (article.title || "").trim();
  const sourceBody = (article.body || "").trim();
  const genre = (article.product?.genre || "メイク用品").trim();
  const topic = (article.product?.name || title).trim();
  const analysis = analyzeArticle({ title, body: sourceBody, topic, genre });

  console.log(`\n=== ${label} ===`);
  const draft = await createBlogDraft({
    llm,
    title,
    topic,
    genre,
    sourceBody,
    analysis,
    images: { hero: { source: "none", url: "", alt: "", credit: "" }, inline: [] },
    isPr: Boolean(article.affiliateNote),
    blogName: "Beauty Notes",
  });

  const body = draft.public_body.trim();
  const ok = isUsableBlogBody(body);
  const hasBanned = /^(導入|本題|まとめ)$/m.test(body);
  console.log(
    JSON.stringify(
      {
        source: draft.generationSource,
        chars: [...body].length,
        usable: ok,
        hasBannedLabels: hasBanned,
        flowContinues: true,
      },
      null,
      2,
    ),
  );
  return { body, source: draft.generationSource, ok, hasBanned };
}

async function main() {
  loadEnv();
  const config = getConfig();
  const article = JSON.parse(fs.readFileSync("input/article.json", "utf8")) as {
    title?: string;
    body?: string;
    affiliateNote?: string;
    product?: { name?: string; genre?: string };
  };
  const title = (article.title || "").trim();
  const sourceBody = (article.body || "").trim();
  const genre = (article.product?.genre || "メイク用品").trim();
  const topic = (article.product?.name || title).trim();
  const analysis = analyzeArticle({ title, body: sourceBody, topic, genre });
  const fallback = buildFallbackBlogBody({
    title,
    topic,
    genre,
    sourceBody,
    analysis,
    isPr: Boolean(article.affiliateNote),
    blogName: "Beauty Notes",
  });

  const mode = process.env.SAMPLE_MODE || "both";

  if (mode === "fallback" || mode === "both") {
    await runOnce("フォールバック経路（失敗シミュレート）", new FailingLlmClient());
  }

  if (mode === "ollama-ok" || mode === "both") {
    // 成功経路: モックLLMが十分な本文を返す（実Ollamaの成否に依存しない確認）
    await runOnce("Ollama成功経路（モック）", new OkMockLlmClient(fallback));
  }

  if (mode === "live") {
    await runOnce("実LLM（失敗時は自動フォールバック）", createLlmClient(config));
  }

  // 最終サンプルはフォールバック品質をファイルへ（投稿相当本文）
  const result = await runOnce("最終サンプル保存", new TemplateLlmClient());
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync("output/last-blogger-body.txt", `${result.body}\n`, "utf8");
  console.log("\n保存: output/last-blogger-body.txt");
  console.log("---BODY---");
  console.log(result.body);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
