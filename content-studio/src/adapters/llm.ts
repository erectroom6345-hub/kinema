import type { LlmClient, LlmMessage } from "../types/index.ts";
import { logger } from "../utils/logger.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { buildOllamaBlogPrefix } from "../prompts/blog.ts";
import { resolveOllamaRuntime } from "../config/ollamaRuntime.ts";

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async complete(messages: LlmMessage[], options?: { json?: boolean }): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.debug("LLM request failed", { status: response.status, body: body.slice(0, 500) });
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM returned empty content");
    }
    return content;
  }
}

export class OllamaClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs?: number,
    private readonly blogNumPredict?: number,
  ) {}

  async complete(messages: LlmMessage[], options?: { json?: boolean }): Promise<string> {
    const runtime = resolveOllamaRuntime();
    const timeoutMs = this.timeoutMs ?? runtime.generateTimeoutMs;
    const blogNumPredict = this.blogNumPredict ?? runtime.blogNumPredict;
    const bodyPrompt = messagesToPrompt(messages);
    const prompt = options?.json
      ? bodyPrompt
      : `${buildOllamaBlogPrefix()}\n\n${bodyPrompt}`;

    const url = `${this.baseUrl.replace(/\/$/, "")}/api/generate`;
    logger.debug("Ollama generate start", {
      model: this.model,
      json: Boolean(options?.json),
      timeoutMs,
      profile: runtime.profile,
    });
    console.log(
      `Ollama本文生成開始 (model=${this.model}, timeout=${timeoutMs / 1000}s, profile=${runtime.profile}, num_predict=${options?.json ? 800 : blogNumPredict})`,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          // 朝ランは短め。手動は中程度。旧 3500 は遅延の温床だった。
          num_predict: options?.json ? 800 : blogNumPredict,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text();
      logger.debug("Ollama request failed", { status: response.status, body: body.slice(0, 500) });
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = (await response.json()) as { response?: string };
    const content = data.response?.trim();
    if (!content) {
      throw new Error("Ollama returned empty response");
    }
    logger.debug("Ollama generate done", { chars: content.length });
    return content;
  }
}

export class TemplateLlmClient implements LlmClient {
  async complete(messages: LlmMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    logger.debug("Template LLM fallback in use");
    return user;
  }
}

export type LlmProvider = "ollama" | "openai" | "template";

export function createLlmClient(config: {
  llmProvider: LlmProvider;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
}): LlmClient {
  if (config.llmProvider === "ollama") {
    const runtime = resolveOllamaRuntime();
    // 朝/手動は runtime を正とする（.env の 600s が朝に効いて遅延するのを防ぐ）
    const timeoutMs = runtime.generateTimeoutMs;
    logger.debug("LLM provider: ollama", {
      model: config.ollamaModel,
      baseUrl: config.ollamaBaseUrl,
      timeoutMs,
      profile: runtime.profile,
    });
    return new OllamaClient(
      config.ollamaBaseUrl,
      config.ollamaModel,
      timeoutMs,
      runtime.blogNumPredict,
    );
  }

  if (config.llmProvider === "openai") {
    if (!config.openaiApiKey) {
      logger.debug("OPENAI_API_KEY が未設定のため、テンプレート生成にフォールバックします");
      return new TemplateLlmClient();
    }
    logger.debug("LLM provider: openai", { model: config.openaiModel });
    return new OpenAiCompatibleClient(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel);
  }

  logger.debug("LLM provider: template");
  return new TemplateLlmClient();
}

export async function safeComplete(
  llm: LlmClient,
  messages: LlmMessage[],
  fallback: string,
  options?: { json?: boolean },
): Promise<string> {
  try {
    if (llm instanceof TemplateLlmClient) return fallback;
    return await llm.complete(messages, options);
  } catch (error) {
    logger.debug("LLM生成に失敗したためフォールバックします", toErrorMessage(error));
    return fallback;
  }
}

function messagesToPrompt(messages: LlmMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === "system") return message.content;
      if (message.role === "user") return message.content;
      return `Assistant:\n${message.content}`;
    })
    .join("\n\n");
}
