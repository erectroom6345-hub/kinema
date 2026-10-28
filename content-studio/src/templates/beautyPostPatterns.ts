/**
 * 美容IGで真似すべき投稿型 3パターン（自動化用テンプレ）。
 *
 * 1) choose   … 選び方（条件を絞る）
 * 2) compare  … 比較・見分け（何が違うか）
 * 3) checklist… これだけ見れば（保存向けチェック）
 *
 * VC一本運用でも型は同じ。商品画像は公式URLがあればカルーセル2枚目に使う。
 */

export type BeautyPostPatternId = "choose" | "compare" | "checklist";

export type BeautyPatternInput = {
  brand: string;
  productName: string;
  genre: string;
  title?: string;
  body?: string;
  productId?: string;
};

export type BeautyCarouselSlide = {
  title: string;
  pitch: string;
  /** product = 公式商品画像URLを優先 / template = 文字カード */
  kind: "template" | "product";
};

const PATTERN_IDS: BeautyPostPatternId[] = ["choose", "compare", "checklist"];

function clean(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ");
}

function productPhrase(brand: string, productName: string): string {
  const name = clean(productName);
  const b = clean(brand);
  if (!name) return b ? `${b}のアイテム` : "気になるコスメ";
  if (b && !name.includes(b)) return `${b}の「${name}」`;
  return `「${name}」`;
}

function tokyoDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * auto: 日付ローテ（毎日型が変わる）
 * 固定: BEAUTY_POST_PATTERN=choose|compare|checklist
 */
export function pickBeautyPostPattern(opts: {
  productId?: string;
  at?: Date;
} = {}): BeautyPostPatternId {
  const forced = String(process.env.BEAUTY_POST_PATTERN || "auto")
    .trim()
    .toLowerCase();
  if (forced === "choose" || forced === "compare" || forced === "checklist") {
    return forced;
  }
  const day = tokyoDayKey(opts.at);
  const seed = `${day}:${opts.productId || ""}`;
  return PATTERN_IDS[hashSeed(seed) % PATTERN_IDS.length]!;
}

export function patternLabel(id: BeautyPostPatternId): string {
  switch (id) {
    case "choose":
      return "選び方";
    case "compare":
      return "比較・見分け";
    case "checklist":
      return "これだけ見れば";
    default:
      return id;
  }
}

/** カルーセル3枚（1商品写真 / 2フック / 3CTA） */
export function buildPatternCarouselSlides(
  pattern: BeautyPostPatternId,
  input: BeautyPatternInput,
): BeautyCarouselSlide[] {
  const brand = clean(input.brand);
  const productName = clean(input.productName);
  const genre = clean(input.genre) || "美容";

  const productTitle = (productName || brand || "今日の候補").slice(0, 28);

  if (pattern === "choose") {
    return [
      {
        kind: "product",
        title: productTitle,
        pitch: brand ? `${brand}｜条件に当てて確認` : "条件に当てて確認",
      },
      {
        kind: "template",
        title: `${genre}、何を基準に選ぶ？`,
        pitch: "迷ったら条件を2つに絞る",
      },
      {
        kind: "template",
        title: "詳しくはプロフィールから",
        pitch: "選び方のポイントをブログに整理",
      },
    ];
  }

  if (pattern === "compare") {
    return [
      {
        kind: "product",
        title: productTitle,
        pitch: brand ? `${brand}｜違いを先に見る` : "違いを先に見る",
      },
      {
        kind: "template",
        title: "似たアイテム、何が違う？",
        pitch: "見た目より先に違いを見る",
      },
      {
        kind: "template",
        title: "詳しくはプロフィールから",
        pitch: "違いだけ短くブログにまとめました",
      },
    ];
  }

  // checklist
  return [
    {
      kind: "product",
      title: productTitle,
      pitch: "買う前チェック対象",
    },
    {
      kind: "template",
      title: "買う前に見る3点",
      pitch: "仕上がり・使い方・普段使い",
    },
    {
      kind: "template",
      title: "詳しくはプロフィールから",
      pitch: "チェック項目をブログに残しています",
    },
  ];
}

/** Instagram caption（URLなし・プロフィール誘導） */
export function buildPatternInstagramCaption(
  pattern: BeautyPostPatternId,
  input: BeautyPatternInput,
): string {
  const brand = clean(input.brand);
  const productName = clean(input.productName);
  const product = productPhrase(brand, productName);
  const genre = clean(input.genre);

  if (pattern === "choose") {
    return [
      `${genre || "コスメ"}を選ぶとき、私は「続けやすさ」と「仕上がりの好み」の2点だけ先に決めるようにしています。`,
      `${product}も、その条件に合いそうか見ながらチェック中です。`,
      "",
      "詳しくは、プロフィールのリンクからご覧ください",
    ].join("\n");
  }

  if (pattern === "compare") {
    return [
      `似たアイテムが多いときは、「何が違うのか」を先に見ると迷いが減ります。`,
      `${product}、仕上がりが気になったら一度試してみてください。`,
      "",
      "詳しくは、プロフィールのリンクからご覧ください",
    ].join("\n");
  }

  return [
    `買う前に見るなら、①仕上がり ②使い方 ③自分の普段使いに合うか、の3点だけで十分です。`,
    `${product}も、このチェックで見ています。`,
    "",
    "詳しくは、プロフィールのリンクからご覧ください",
  ].join("\n");
}

/** Threads固定導線のCTA行（URLの直前に付く） */
export function threadsFixedCtaLine(): string {
  const custom = String(process.env.BEAUTY_THREADS_FIXED_CTA || "").trim();
  return custom || "▼ ブログでポイントだけ整理";
}

/** Threads本文（URLは呼び出し側で付与。固定CTAは threads.ts 側で末尾直前に付与） */
export function buildPatternThreadsBody(
  pattern: BeautyPostPatternId,
  input: BeautyPatternInput,
): string {
  const product = productPhrase(clean(input.brand), clean(input.productName));

  if (pattern === "choose") {
    return `${product}、続けやすさと仕上がりで見ています。\n気になったら、一度試してみてください。`;
  }
  if (pattern === "compare") {
    return `${product}、似たものとの違いが気になります。\n一度試してみてください。`;
  }
  return `${product}、仕上がりと使い方と普段使いで見ています。\n気になったら、一度試してみてください。`;
}

export const BEAUTY_POST_PATTERN_IDS = PATTERN_IDS;
