import { AppError } from "../utils/errors.ts";
import type { BloggerClient, BloggerDraftRequest, BloggerDraftResult } from "../types/index.ts";

export class UnimplementedBloggerClient implements BloggerClient {
  async saveDraft(_request: BloggerDraftRequest): Promise<BloggerDraftResult> {
    throw new AppError(
      "Blogger API 連携は未実装です。現時点では HTML/Markdown 下書き出力のみ対応しています。",
      "BLOGGER_NOT_IMPLEMENTED",
    );
  }
}

export function createBloggerClient(): BloggerClient {
  return new UnimplementedBloggerClient();
}
