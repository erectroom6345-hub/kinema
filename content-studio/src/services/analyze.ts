import { resolveGenreProfile } from "../config/genres.ts";
import type { ArticleAnalysis } from "../types/index.ts";

const PRODUCT_HINTS = [
  "商品",
  "レビュー",
  "おすすめ",
  "口コミ",
  "成分",
  "購入",
  "価格",
  "使い方",
  "アイテム",
  "比較",
  "公式",
];

const CONCERN_HINTS = [
  "悩み",
  "対策",
  "原因",
  "整え",
  "習慣",
  "ケア",
  "ゆらぎ",
  "乾燥",
  "疲れ",
  "まとめ",
];

export function analyzeArticle(params: {
  title: string;
  body: string;
  topic: string;
  genre: string;
}): ArticleAnalysis {
  const text = `${params.title}\n${params.topic}\n${params.body}`;
  const productHits = PRODUCT_HINTS.filter((word) => text.includes(word));
  const concernHits = CONCERN_HINTS.filter((word) => text.includes(word));
  const isProductOriented = productHits.length > concernHits.length && productHits.length > 0;

  const profile = resolveGenreProfile(params.genre);
  const topicWords = params.topic.replace(/[、。！？]/g, " ").split(/\s+/).filter(Boolean);
  const imageKeywords = Array.from(
    new Set([
      ...profile.heroQueries.slice(0, 2),
      ...profile.inlineQueries.slice(0, 1),
      ...topicWords.slice(0, 3),
    ]),
  );

  const hooks = isProductOriented
    ? [
        "実際に使って気づいたことを先に置く",
        "選び方の軸を2〜3個に絞る",
        "押し売りせず、合う人・合わない人を分ける",
      ]
    : [
        "よくある悩みから入る",
        "今日からできる小さな整え方を示す",
        "完璧を目指さない言い回しにする",
      ];

  const titleCandidates = buildTitleCandidates(params.topic, params.genre, isProductOriented);

  return {
    is_product_oriented: isProductOriented,
    reason: isProductOriented
      ? `商品紹介寄りの語彙（${productHits.join("、") || "なし"}）が目立ちます。`
      : `悩み整理寄りの語彙（${concernHits.join("、") || "なし"}）が目立ちます。`,
    suggested_hooks: hooks,
    image_keywords: imageKeywords,
    title_candidates: titleCandidates,
    tone: isProductOriented ? "product" : "concern",
  };
}

export function buildTitleCandidates(topic: string, genre: string, productOriented: boolean): string[] {
  const profile = resolveGenreProfile(genre);
  if (productOriented) {
    return [
      `${topic}の選び方｜${profile.label}で押さえておきたい視点`,
      `${topic}を試す前に知りたい、失敗しにくい考え方`,
      `${topic}は誰向け？合う人・合わない人の整理`,
    ];
  }
  return [
    `${topic}で整える、日常の小さな習慣`,
    `${topic}の悩みをやさしく分解してみる`,
    `${topic}に向き合う前に知っておきたい基本`,
  ];
}
