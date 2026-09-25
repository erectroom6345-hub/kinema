import type { StockImage, StockImageAdapter, StockSearchQuery } from "../types/index.ts";
import { logger } from "../utils/logger.ts";
import { toErrorMessage } from "../utils/errors.ts";

interface PixabayHit {
  id: number;
  pageURL?: string;
  largeImageURL?: string;
  webformatURL?: string;
  tags?: string;
  user?: string;
}

interface PixabayResponse {
  hits?: PixabayHit[];
}

export class PixabayAdapter implements StockImageAdapter {
  readonly name = "pixabay" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: StockSearchQuery): Promise<StockImage[]> {
    if (!this.apiKey) {
      logger.debug("PIXABAY_API_KEY が未設定のため画像検索をスキップします");
      return [];
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      q: query.query,
      image_type: "photo",
      safesearch: "true",
      per_page: String(query.perPage ?? 8),
      lang: query.locale === "ja" ? "ja" : "en",
    });

    try {
      const response = await fetch(`https://pixabay.com/api/?${params.toString()}`);
      if (!response.ok) {
        logger.debug("Pixabay API error", { status: response.status, query: query.query });
        return [];
      }
      const data = (await response.json()) as PixabayResponse;
      return (data.hits ?? []).map((hit) => ({
        source: "pixabay" as const,
        url: hit.largeImageURL ?? hit.webformatURL ?? "",
        previewUrl: hit.webformatURL,
        alt: hit.tags?.split(",")[0]?.trim() || query.query,
        credit: `Image by ${hit.user ?? "Pixabay user"} from Pixabay`,
        pageUrl: hit.pageURL,
        query: query.query,
      })).filter((image) => Boolean(image.url));
    } catch (error) {
      logger.debug("Pixabay search failed", toErrorMessage(error));
      return [];
    }
  }
}

export class PexelsAdapter implements StockImageAdapter {
  readonly name = "pexels" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: StockSearchQuery): Promise<StockImage[]> {
    if (!this.apiKey) {
      logger.debug("Pexels adapter is stubbed until PEXELS_API_KEY is set", { query: query.query });
      return [];
    }
    logger.debug("Pexels adapter is reserved for a later phase", { query: query.query });
    return [];
  }
}

export function createStockAdapter(name: "pixabay" | "pexels", keys: { pixabayApiKey: string }): StockImageAdapter {
  if (name === "pexels") return new PexelsAdapter("");
  return new PixabayAdapter(keys.pixabayApiKey);
}
