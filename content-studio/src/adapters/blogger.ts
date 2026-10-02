import { getConfig, loadEnv } from "../config/env.ts";
import { AppError } from "../utils/errors.ts";
import type { BloggerClient, BloggerDraftRequest, BloggerDraftResult } from "../types/index.ts";

export class UnimplementedBloggerClient implements BloggerClient {
  async saveDraft(_request: BloggerDraftRequest): Promise<BloggerDraftResult> {
    throw new AppError(
      "Blogger API 連携の認証が未設定です。" +
        " BLOGGER_BLOG_ID / BLOGGER_CLIENT_ID / BLOGGER_CLIENT_SECRET / BLOGGER_REFRESH_TOKEN を .env に設定してください。",
      "BLOGGER_NOT_CONFIGURED",
    );
  }
}

/** OAuth refresh token で Blogger posts.insert する実装 */
export class ApiBloggerClient implements BloggerClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
  ) {}

  async saveDraft(request: BloggerDraftRequest): Promise<BloggerDraftResult> {
    const accessToken = await this.refreshAccessToken();
    const isDraft = request.isDraft === true;
    const endpoint =
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(request.blogId)}/posts` +
      `?isDraft=${isDraft ? "true" : "false"}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "blogger#post",
        title: request.title,
        content: request.contentHtml,
        labels: request.labels ?? [],
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string; code?: number };
    };

    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      throw new AppError(`Blogger posts.insert 失敗: ${msg}`, "BLOGGER_INSERT_FAILED");
    }

    const postId = (data.id || "").trim();
    const url = (data.url || "").trim();
    if (!postId) {
      throw new AppError("Blogger応答に post id がありません", "BLOGGER_NO_POST_ID");
    }
    if (!isDraft && !url) {
      throw new AppError(
        "Blogger公開応答に url がありません（個別記事URLを取得できませんでした）",
        "BLOGGER_NO_URL",
      );
    }

    return { postId, url: url || undefined };
  }

  private async refreshAccessToken(): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !data.access_token) {
      const detail = data.error_description || data.error || `HTTP ${res.status}`;
      throw new AppError(`Blogger OAuth token 更新失敗: ${detail}`, "BLOGGER_OAUTH_FAILED");
    }
    return data.access_token;
  }
}

export function createBloggerClient(): BloggerClient {
  loadEnv();
  const config = getConfig();
  const blogId = config.bloggerBlogId.trim();
  const clientId = config.bloggerClientId.trim();
  const clientSecret = config.bloggerClientSecret.trim();
  const refreshToken = config.bloggerRefreshToken.trim();

  if (blogId && clientId && clientSecret && refreshToken) {
    return new ApiBloggerClient(clientId, clientSecret, refreshToken);
  }
  return new UnimplementedBloggerClient();
}
