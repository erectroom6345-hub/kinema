import { getConfig, loadEnv } from "../config/env.ts";
import { AppError } from "../utils/errors.ts";
import type {
  BloggerClient,
  BloggerDraftRequest,
  BloggerDraftResult,
  BloggerListPostsParams,
  BloggerPostSummary,
} from "../types/index.ts";

export class UnimplementedBloggerClient implements BloggerClient {
  async saveDraft(_request: BloggerDraftRequest): Promise<BloggerDraftResult> {
    throw new AppError(
      "Blogger API 連携の認証が未設定です。" +
        " BLOGGER_BLOG_ID / BLOGGER_CLIENT_ID / BLOGGER_CLIENT_SECRET / BLOGGER_REFRESH_TOKEN を .env に設定してください。",
      "BLOGGER_NOT_CONFIGURED",
    );
  }

  async listPosts(_params: BloggerListPostsParams): Promise<BloggerPostSummary[]> {
    throw new AppError(
      "Blogger API 連携の認証が未設定です。",
      "BLOGGER_NOT_CONFIGURED",
    );
  }

  async patchPostContent(
    _blogId: string,
    _postId: string,
    _contentHtml: string,
  ): Promise<BloggerPostSummary> {
    throw new AppError(
      "Blogger API 連携の認証が未設定です。",
      "BLOGGER_NOT_CONFIGURED",
    );
  }
}

/** OAuth refresh token で Blogger posts.insert / list / patch する実装 */
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

  async listPosts(params: BloggerListPostsParams): Promise<BloggerPostSummary[]> {
    const accessToken = await this.refreshAccessToken();
    const out: BloggerPostSummary[] = [];
    let pageToken = "";
    const maxResults = Math.min(Math.max(params.maxResults || 20, 1), 50);

    do {
      const qs = new URLSearchParams({
        fetchBodies: "true",
        status: params.status || "LIVE",
        maxResults: String(maxResults),
      });
      if (params.startDate) qs.set("startDate", params.startDate);
      if (params.endDate) qs.set("endDate", params.endDate);
      if (pageToken) qs.set("pageToken", pageToken);

      const endpoint =
        `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(params.blogId)}/posts` +
        `?${qs.toString()}`;

      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        items?: Array<{
          id?: string;
          title?: string;
          url?: string;
          content?: string;
          published?: string;
          updated?: string;
          labels?: string[];
        }>;
        nextPageToken?: string;
        error?: { message?: string };
      };

      if (!res.ok) {
        const msg = data.error?.message || `HTTP ${res.status}`;
        throw new AppError(`Blogger posts.list 失敗: ${msg}`, "BLOGGER_LIST_FAILED");
      }

      for (const item of data.items || []) {
        const id = (item.id || "").trim();
        if (!id) continue;
        out.push({
          id,
          title: (item.title || "").trim(),
          url: (item.url || "").trim(),
          content: item.content || "",
          published: (item.published || "").trim(),
          updated: (item.updated || "").trim() || undefined,
          labels: Array.isArray(item.labels) ? item.labels : [],
        });
      }
      pageToken = (data.nextPageToken || "").trim();
    } while (pageToken);

    return out;
  }

  async patchPostContent(
    blogId: string,
    postId: string,
    contentHtml: string,
  ): Promise<BloggerPostSummary> {
    const accessToken = await this.refreshAccessToken();
    const endpoint =
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/` +
      `${encodeURIComponent(postId)}`;

    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      // 本文のみ。title / published / url は送らない（変更しない）
      body: JSON.stringify({
        content: contentHtml,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
      url?: string;
      content?: string;
      published?: string;
      updated?: string;
      labels?: string[];
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      throw new AppError(`Blogger posts.patch 失敗: ${msg}`, "BLOGGER_PATCH_FAILED");
    }

    const id = (data.id || postId).trim();
    return {
      id,
      title: (data.title || "").trim(),
      url: (data.url || "").trim(),
      content: data.content || contentHtml,
      published: (data.published || "").trim(),
      updated: (data.updated || "").trim() || undefined,
      labels: Array.isArray(data.labels) ? data.labels : [],
    };
  }

  /** 認証疎通・運用確認用（投稿フローからも内部利用） */
  async refreshAccessToken(): Promise<string> {
    const maskedRefresh = maskBloggerSecret(this.refreshToken);
    console.log(`[Blogger認証] access token 更新開始 refresh_token=${maskedRefresh}`);

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
      throw new AppError(
        `[Blogger認証] refresh token からの access token 更新に失敗: ${detail}。` +
          ` BLOGGER_REFRESH_TOKEN の再発行が必要な可能性があります。` +
          ` refresh_token=${maskedRefresh}`,
        "BLOGGER_OAUTH_FAILED",
      );
    }

    console.log(
      `[Blogger認証] access token 更新成功 access_token=${maskBloggerSecret(data.access_token)}`,
    );
    return data.access_token;
  }
}

function maskBloggerSecret(value: string, head = 6, tail = 4): string {
  const v = value.trim();
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
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
