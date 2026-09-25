import type { AspImageSlot, ImageBundle, StockImage, StockImageAdapter } from "../types/index.ts";
import { resolveGenreProfile } from "../config/genres.ts";
import { logger } from "../utils/logger.ts";

const EMPTY_IMAGE: StockImage = {
  source: "none",
  url: "",
  alt: "",
  credit: "",
};

export async function selectImages(params: {
  adapter: StockImageAdapter;
  genre: string;
  keywords: string[];
  title: string;
  aspImage?: AspImageSlot;
  skip?: boolean;
}): Promise<ImageBundle> {
  if (params.skip) {
    return { hero: EMPTY_IMAGE, inline: [] };
  }

  const profile = resolveGenreProfile(params.genre);
  const heroQuery = params.keywords[0] || profile.heroQueries[0];
  const inlineQuery = params.keywords[1] || profile.inlineQueries[0];

  const [heroHits, inlineHits] = await Promise.all([
    params.adapter.search({ query: heroQuery, perPage: 5 }),
    params.adapter.search({ query: inlineQuery, perPage: 5 }),
  ]);

  const hero = withAlt(heroHits[0] ?? EMPTY_IMAGE, `${params.title || "記事"}の雰囲気画像`);
  const inlinePrimary = withAlt(
    distinctFrom(inlineHits, hero) ?? EMPTY_IMAGE,
    "内容を整理するためのイメージ",
  );

  const inline: StockImage[] = [];
  if (inlinePrimary.url) inline.push(inlinePrimary);

  if (params.aspImage?.url) {
    inline.push({
      source: "asp",
      url: params.aspImage.url,
      alt: params.aspImage.alt || "紹介アイテムの参考画像",
      credit: params.aspImage.credit || "ASP提供素材",
    });
  }

  if (!hero.url) {
    logger.debug("アイキャッチ画像を取得できませんでした。記事生成は続行します。");
  }
  if (!inlinePrimary.url) {
    logger.debug("挿入用画像を取得できませんでした。記事生成は続行します。");
  }

  return { hero, inline };
}

function distinctFrom(hits: StockImage[], hero: StockImage): StockImage | undefined {
  return hits.find((hit) => hit.url && hit.url !== hero.url) ?? hits[0];
}

function withAlt(image: StockImage, alt: string): StockImage {
  if (!image.url) return image;
  return { ...image, alt: image.alt || alt };
}
