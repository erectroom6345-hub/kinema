import { runPipeline } from "./pipeline.ts";
import { parseJobInput } from "./input.ts";
import type { ArticleJobResult } from "../types/index.ts";

export async function handleWebhookPayload(payload: unknown): Promise<ArticleJobResult> {
  return runPipeline(parseJobInput(payload));
}
