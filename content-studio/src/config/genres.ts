export interface GenreProfile {
  label: string;
  heroQueries: string[];
  inlineQueries: string[];
  caution: string;
}

export const GENRE_PROFILES: Record<string, GenreProfile> = {
  beauty: {
    label: "美容",
    heroQueries: ["skincare still life", "soft sunlight bathroom", "natural skin care"],
    inlineQueries: ["notebook planning", "minimal desk notes", "checklist paper"],
    caution: "医薬的な効果効能の断定、即効性の断言、過度なビフォーアフター誇張は避ける。",
  },
  living: {
    label: "暮らし便利グッズ",
    heroQueries: ["tidy home organization", "kitchen convenience tools", "minimal living room"],
    inlineQueries: ["storage tips notebook", "simple home desk"],
    caution:
      "効果の断定や過度な誇張は避ける。美容・スキンケア用語は使わない。押し売りや煽りは禁止。",
  },
  lifestyle: {
    label: "ライフスタイル",
    heroQueries: ["cozy morning coffee", "natural light interior"],
    inlineQueries: ["journal writing", "simple workspace"],
    caution: "断定的な人生訓や煽りは避け、体験ベースで書く。",
  },
  gadget: {
    label: "ガジェット",
    heroQueries: ["minimal tech desk", "smartphone workspace"],
    inlineQueries: ["notebook comparison", "clean desk setup"],
    caution: "スペックの誤記と過度なランキング煽りを避ける。",
  },
  food: {
    label: "旬・手土産の食べ物",
    heroQueries: ["simple homemade meal", "tea table still life"],
    inlineQueries: ["recipe notes", "kitchen ingredients"],
    caution: "効能の断定や過度な健康効果の主張は避ける。ご当地・観光ガイド化はしない。",
  },
  drink: {
    label: "銘酒・季節酒",
    heroQueries: ["sake bottle still life", "evening table drink"],
    inlineQueries: ["wine tasting notes", "simple bar cart"],
    caution: "過度な煽り・多飲勧奨は避ける。蔵めぐり・観光ガイド化はしない。",
  },
  generic: {
    label: "汎用",
    heroQueries: ["soft natural light", "minimal lifestyle"],
    inlineQueries: ["notebook paper", "planning notes"],
    caution: "誇張・断定・押し売りを避ける。",
  },
};

export function resolveGenreProfile(genre?: string): GenreProfile {
  const key = (genre ?? "generic").toLowerCase();
  return GENRE_PROFILES[key] ?? GENRE_PROFILES.generic;
}
