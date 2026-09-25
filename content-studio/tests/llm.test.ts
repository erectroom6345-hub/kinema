import assert from "node:assert/strict";
import { test } from "node:test";
import { createLlmClient, OllamaClient, TemplateLlmClient } from "../src/adapters/llm.ts";
import { OLLAMA_BLOG_PREFIX } from "../src/prompts/blog.ts";

test("LLM_PROVIDER=ollama のとき OllamaClient を返す", () => {
  const client = createLlmClient({
    llmProvider: "ollama",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-4o-mini",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "gemma3:4b",
    ollamaTimeoutMs: 600_000,
  });
  assert.ok(client instanceof OllamaClient);
});

test("OPENAI_API_KEY が空でも ollama 指定ならテンプレートに落ちない", () => {
  const client = createLlmClient({
    llmProvider: "ollama",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-4o-mini",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "gemma3:4b",
    ollamaTimeoutMs: 600_000,
  });
  assert.equal(client instanceof TemplateLlmClient, false);
});

test("固定指示文が定義されている", () => {
  assert.match(OLLAMA_BLOG_PREFIX, /美容ブログを書く編集者/);
  assert.match(OLLAMA_BLOG_PREFIX, /見出し記号 # は使わないでください/);
  assert.match(OLLAMA_BLOG_PREFIX, /Markdown記法は使わないでください/);
});
