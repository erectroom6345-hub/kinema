export type Genre = "beauty" | "lifestyle" | "gadget" | "food" | "generic";

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
  isDraft?: boolean;
}

export interface BloggerDraftResult {
  postId: string;
  url?: string;
}

export interface BloggerClient {
  saveDraft(request: BloggerDraftRequest): Promise<BloggerDraftResult>;
}

export interface PipelineOptions {
  llm?: LlmClient;
  stock?: StockImageAdapter;
  blogger?: BloggerClient;
  skipImages?: boolean;
}
