export type Genre = "beauty" | "living" | "lifestyle" | "gadget" | "food" | "drink" | "generic";

export type StockProviderName = "pixabay" | "pexels";

export interface ArticleJobInput {
  blog_name?: string;
  blog_url?: string;
  article_url?: string;
  article_title?: string;
  article_body?: string;
  topic?: string;
  genre?: Genre | string;
  is_pr?: boolean;
  publish_date?: string;
  /** 許可済み商品画像の照合キー（ファイル名ステム）。未設定時は topic などで照合 */
  instagram_image_key?: string;
  asp_image?: AspImageSlot;
}

export interface AspImageSlot {
  url: string;
  alt?: string;
  credit?: string;
}

export interface InputSummary {
  blog_name: string;
  blog_url: string;
  article_url: string;
  article_title: string;
  topic: string;
  genre: string;
  is_pr: boolean;
  publish_date: string;
  has_source_body: boolean;
}

export interface ArticleAnalysis {
  is_product_oriented: boolean;
  reason: string;
  suggested_hooks: string[];
  image_keywords: string[];
  title_candidates: string[];
  tone: "product" | "concern";
}

export interface StockImage {
  source: StockProviderName | "asp" | "none";
  url: string;
  previewUrl?: string;
  alt: string;
  credit: string;
  pageUrl?: string;
  query?: string;
}

export interface BlogDraft {
  title: string;
  outline: string[];
  /** 互換用。公開本文と同じ内容（#なし） */
  body_markdown: string;
  body_html: string;
  /** 公開用本文（保存・投稿に使う） */
  public_body: string;
}

export interface ImageBundle {
  hero: StockImage;
  inline: StockImage[];
}

export interface SnsOutputs {
  instagram: { caption: string };
  threads: string[];
  x: string[];
}

export interface ArticleJobResult {
  input_summary: InputSummary;
  analysis: ArticleAnalysis;
  blog_draft: BlogDraft;
  images: ImageBundle;
  outputs: SnsOutputs;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  complete(messages: LlmMessage[], options?: { json?: boolean }): Promise<string>;
}

export interface StockSearchQuery {
  query: string;
  perPage?: number;
  locale?: string;
}

export interface StockImageAdapter {
  readonly name: StockProviderName;
  search(query: StockSearchQuery): Promise<StockImage[]>;
}

export interface BloggerDraftRequest {
  blogId: string;
  title: string;
  contentHtml: string;
  labels?: string[];
  /** true=下書き / false=即公開（beauty自動投稿は false） */
  isDraft?: boolean;
}

export interface BloggerDraftResult {
  postId: string;
  /** 公開時は個別記事URL。下書きでは空になりうる */
  url?: string;
}

export interface BloggerPostSummary {
  id: string;
  title: string;
  url: string;
  content: string;
  published: string;
  updated?: string;
  labels?: string[];
}

export interface BloggerListPostsParams {
  blogId: string;
  /** RFC3339 inclusive lower bound */
  startDate?: string;
  /** RFC3339 exclusive-ish upper bound (API: endDate) */
  endDate?: string;
  maxResults?: number;
  status?: "LIVE" | "DRAFT" | "SCHEDULED";
}

export interface BloggerClient {
  /** posts.insert。isDraft=false で公開し、レスポンスの url を返す */
  saveDraft(request: BloggerDraftRequest): Promise<BloggerDraftResult>;
  /** 公開済み投稿一覧（本文付き）。後追い更新用 */
  listPosts?(params: BloggerListPostsParams): Promise<BloggerPostSummary[]>;
  /** 本文だけ更新（title/published/url は変えない） */
  patchPostContent?(
    blogId: string,
    postId: string,
    contentHtml: string,
  ): Promise<BloggerPostSummary>;
}

export interface PipelineOptions {
  llm?: LlmClient;
  stock?: StockImageAdapter;
  blogger?: BloggerClient;
  skipImages?: boolean;
}
