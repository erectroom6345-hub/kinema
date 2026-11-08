/**
 * food SNS文生成（Instagram caption / Threads / X）
 *
 * 構成: 場面 → 特別さ → 根拠 → 行動
 * - 毎回 ※PR（tip除く）
 * - Instagram: 投稿内完結（保存CTA・URLなし）。ブログ誘導なし
 * - Threads / X: SNS完結 = 楽天アフィリエイト直載せ（ブログ誘導はしない）
 * - ブログはカテゴリまとめ専用（SNSからの誘導先にしない。美容だけブログ誘導）
 * - ご当地・希少語は limited/arrival のときだけ
 */
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { normalizeCaption } from "./utils/normalizeCaption.ts";
import { buildTrackUrl } from "./utils/utm.ts";

const require = createRequire(import.meta.url);
const { cleanFoodProductName } = require("../scripts/lib/food-product-name.cjs") as {
  cleanFoodProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const { buildReasonLine: buildBenefitReason } = require("../scripts/lib/product-benefit-copy.cjs") as {
  buildReasonLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
    snippet?: string;
    maxLen?: number;
  }) => string;
};

const inputPath = "input/article.json";
const outputPath = "input/instagram-post.json";
const opsPath = "policy/food-ops.json";

type ArticleInput = {
  title?: string;
  body?: string;
  product?: {
    id?: string;
    name?: string;
    nameRaw?: string;
    category?: string;
    description?: string;
    ask?: string;
    aside?: string;
    priceRange?: string;
    pointRate?: number;
    features?: string[];
    imageUrl?: string;
    rakutenUrl?: string;
    url?: string;
    postType?: string;
    affiliate?: boolean;
    interrupt?: string | null;
    labels?: {
      sale?: boolean;
      campaign?: boolean;
      popular?: boolean;
      limited?: boolean;
      arrival?: boolean;
      tip?: boolean;
    };
  };
};

function tokyoDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function envFlag(name: string): boolean | null {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function readOps(): {
  requirePr: boolean;
  prToken: string;
  fixedPageUrl: string;
  stockpileActive: boolean;
} {
  let requirePr = true;
  let prToken = "※PR";
  let stockpileEnabled = false;
  let stockpileStart = "";
  let stockpileEnd = "";
  try {
    const ops = JSON.parse(fs.readFileSync(opsPath, "utf8")) as {
      posting?: { requirePr?: boolean };
      snsCopy?: { prToken?: string };
      stockpilePeriod?: {
        enabled?: boolean;
        start?: string;
        end?: string;
      };
    };
    requirePr = ops.posting?.requirePr !== false;
    prToken = ops.snsCopy?.prToken || "※PR";
    stockpileEnabled = ops.stockpilePeriod?.enabled === true;
    stockpileStart = String(ops.stockpilePeriod?.start || "").slice(0, 10);
    stockpileEnd = String(ops.stockpilePeriod?.end || "").slice(0, 10);
  } catch {
    /* default */
  }
  const forced = envFlag("FOOD_STOCKPILE_MODE");
  const start =
    String(process.env.FOOD_STOCKPILE_START || "").slice(0, 10) || stockpileStart;
  const end =
    String(process.env.FOOD_STOCKPILE_END || "").slice(0, 10) || stockpileEnd;
  const today = tokyoDayKey();
  const inWindow =
    Boolean(start && end) && today >= start && today <= end;
  const stockpileActive =
    forced === true ? true : forced === false ? false : stockpileEnabled && inWindow;
  const fixedPageUrl = (
    (stockpileActive
      ? process.env.FOOD_STOCKPILE_PAGE_URL || process.env.FOOD_FIXED_PAGE_URL
      : process.env.FOOD_FIXED_PAGE_URL) ||
    process.env.FOOD_BLOG_FIXED_PAGE_URL ||
    ""
  ).trim();
  return { requirePr, prToken, fixedPageUrl, stockpileActive };
}

function resolveFixedPageUrl(configured: string): string {
  if (configured) return configured;
  // dry-run / 未設定時の仮値（本番は FOOD_FIXED_PAGE_URL 必須）
  if (
    process.env.FOOD_ALLOW_SAMPLE_CTA === "true" ||
    process.env.SAMPLE_BLOG_BODY === "1" ||
    process.argv.includes("--dry-run-cta")
  ) {
    return "https://food-notes-sample.blogspot.com/p/food.html";
  }
  return "";
}

function sceneLine(category: string, stockpile?: boolean): string {
  if (stockpile) {
    switch ((category || "").trim().toLowerCase()) {
      case "gift":
        return "手土産にもなる、日持ちする常備食を探していませんか。";
      case "sweets":
        return "備蓄用なのに美味しい、甘い常備を探していませんか。";
      case "seasonal":
        return "いまのうちに、日持ちする季節の常備を足しておきませんか。";
      case "table":
      default:
        return "家庭の常備備蓄、日持ちするものを少し多めに、と思っていませんか。";
    }
  }
  switch ((category || "").trim().toLowerCase()) {
    case "seasonal":
      return "季節のご褒美、何を選ぶか迷っていませんか。";
    case "gift":
      return "手土産、無難すぎず派手すぎない一品を探していませんか。";
    case "sweets":
      return "甘いもの、いつもの定番以外も気になっていませんか。";
    case "table":
      return "食卓の常備、もう一品あると安心、と思っていませんか。";
    default:
      return "いまの食卓や手土産、少し特別なものが気になっていませんか。";
  }
}

function pointOffer(pointRate?: number | null): string | null {
  const n = Number(pointRate);
  if (!Number.isFinite(n) || n < 2) return null;
  return `ポイント${Math.round(n)}倍`;
}

function specialLine(
  name: string,
  category: string,
  interrupt?: string | null,
  tip?: boolean,
  pointRate?: number | null,
  stockpile?: boolean,
): string {
  if (tip) {
    const tipTitle = name || "この選び方";
    return `${tipTitle}。選ぶときの基準がひとつ増えます。`;
  }
  const product = name ? `「${name}」` : "このフード";
  const offer = pointOffer(pointRate);
  if (stockpile) {
    if ((interrupt === "campaign" || interrupt === "sale") && offer) {
      return `${product}、いま${offer}です。ローリングストック向きの一品です。`;
    }
    return `${product}。日持ちする常備として、一度試してみてください。`;
  }
  if (interrupt === "arrival") {
    return `${product}、いま届く一品です。食卓で一度試してみてください。`;
  }
  if (interrupt === "limited") {
    return `${product}。いまの季節に食べるなら、一度試してみてください。`;
  }
  if ((interrupt === "campaign" || interrupt === "sale") && offer) {
    return `${product}、いま${offer}です。買い置きもしやすい一品です。`;
  }
  if (interrupt === "campaign" || interrupt === "sale") {
    return `${product}。食卓で、一度試してみてください。`;
  }
  switch ((category || "").trim().toLowerCase()) {
    case "seasonal":
      return `${product}。いまの季節に、一度試してみてください。`;
    case "gift":
      return `${product}。手土産として、一度試してみてください。`;
    case "sweets":
      return `${product}。甘いご褒美に、一度試してみてください。`;
    case "table":
      return `${product}。食卓の一品として、一度試してみてください。`;
    default:
      return `${product}。食卓で、一度試してみてください。`;
  }
}

function reasonLine(params: {
  name?: string;
  category?: string;
  description: string;
  features: string[];
  priceRange: string;
  interrupt?: string | null;
  pointRate?: number | null;
}): string {
  const offer = pointOffer(params.pointRate);
  const price = params.priceRange ? `税込${params.priceRange}` : "";
  if (params.interrupt === "arrival") {
    return "届いているうちの一品です。味と食感を自分のペースで確かめやすいタイミングです。";
  }
  if (params.interrupt === "limited") {
    return "季節のあいだに手に取りやすい一品。今の味を楽しみたい人向けです。";
  }
  if (
    (params.interrupt === "campaign" || params.interrupt === "sale") &&
    offer &&
    price
  ) {
    return `${price}。${offer}なので、普段より買い置きしやすいです。`;
  }
  if ((params.interrupt === "campaign" || params.interrupt === "sale") && offer) {
    return `${offer}なので、買い置きもしやすいタイミングです。`;
  }
  if (params.interrupt === "campaign" || params.interrupt === "sale") {
    return price || "気になったら、一度試してみてください。";
  }
  const feature = params.features
    .map((f) => String(f || "").trim())
    .find(
      (f) =>
        f &&
        !/^ショップ[:：]/u.test(f) &&
        !/^税込目安/u.test(f) &&
        !/^ポイント\d+倍$/u.test(f) &&
        !/ランキング|送料|ギフト包装|法事/.test(f),
    );
  const snippet = [feature, params.description].filter(Boolean).join(" ");
  return buildBenefitReason({
    genre: "food",
    category: params.category,
    name: params.name,
    snippet,
    maxLen: 52,
  });
}

/** Instagram 完結用。プロフィール/ブログへ送らない（ワンクリックは Threads 本文URL） */
function actionLine(prToken: string, requirePr: boolean): string {
  const base = "気になったら、保存して見返してみてください";
  return requirePr ? `${base} ${prToken}` : base;
}

function buildTipCaption(ask: string, aside: string, name: string): string {
  const question = ask.trim() || `${name}。みなさんはどうしていますか？`;
  const mine = aside.trim();
  return mine ? `${question}\n${mine}` : question;
}

function buildFourBeatCaption(params: {
  name: string;
  category: string;
  description: string;
  features: string[];
  priceRange: string;
  pointRate?: number | null;
  requirePr: boolean;
  prToken: string;
  interrupt?: string | null;
  tip?: boolean;
  stockpile?: boolean;
}): string {
  return [
    sceneLine(params.category, params.stockpile),
    specialLine(
      params.name,
      params.category,
      params.interrupt,
      params.tip,
      params.pointRate,
      params.stockpile,
    ),
    reasonLine(params),
    actionLine(params.prToken, params.requirePr),
  ].join("\n");
}

/** Threads: 保存CTAを外し、楽天アフィURLを末尾に（tipはURLなし） */
function buildThreadsText(
  caption: string,
  affiliateUrl: string,
  opts: { tip?: boolean; requirePr?: boolean; prToken?: string },
): string {
  let body = caption
    .replace(/\n*気になったら、保存して見返してみてください\s*※?PR?\s*$/u, "")
    .replace(/\n*気になったら、動画の最後のQRからどうぞ\s*※?PR?\s*$/u, "")
    .replace(/\n*詳しくは、プロフィールのリンクからご覧ください\s*※?PR?\s*$/u, "")
    .replace(/\n*https?:\/\/\S+/gi, "")
    .trim();
  if (opts.tip || !affiliateUrl) {
    if (!opts.tip && opts.requirePr && !/※PR/.test(body)) {
      body = `${body} ${opts.prToken || "※PR"}`;
    }
    return body;
  }
  if (opts.requirePr && !/※PR/.test(body)) {
    body = `${body} ${opts.prToken || "※PR"}`;
  }
  return `${body}\n${affiliateUrl}`.trim();
}

function buildXText(params: {
  name: string;
  category: string;
  requirePr: boolean;
  prToken: string;
  affiliateUrl?: string;
  interrupt?: string | null;
  pointRate?: number | null;
  stockpile?: boolean;
}): string {
  const line1 = sceneLine(params.category, params.stockpile).replace(/。$/, "");
  const line2 = specialLine(
    params.name,
    params.category,
    params.interrupt,
    false,
    params.pointRate,
    params.stockpile,
  );
  const pr = params.requirePr ? ` ${params.prToken}` : "";
  const url = (params.affiliateUrl || "").trim();
  const text = url
    ? `${line1}。\n${line2}${pr}\n${url}`
    : `${line1}。\n${line2}${pr}`;
  return text.length > 260 ? `${text.slice(0, 250)}…` : text;
}

function main() {
  const article = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as ArticleInput;
  const ops = readOps();
  const tip =
    article.product?.affiliate === false ||
    String(article.product?.postType || "").toLowerCase() === "tip" ||
    Boolean(article.product?.labels?.tip);

  const fixedPageUrl = resolveFixedPageUrl(ops.fixedPageUrl);
  const stockpile = !tip && ops.stockpileActive;

  const productId = (article.product?.id || "").trim();
  const nameRaw = (
    article.product?.nameRaw ||
    article.product?.name ||
    ""
  ).trim();
  // tip は短いタイトルをそのまま。商品は整形名
  const name = tip
    ? (article.product?.name || nameRaw).trim().slice(0, 32)
    : cleanFoodProductName((article.product?.name || nameRaw).trim(), {
        maxLen: 28,
      });
  const category = (article.product?.category || "other").trim();
  const description = (article.product?.description || article.body || "").trim();
  const features = Array.isArray(article.product?.features)
    ? article.product!.features!
    : [];
  const priceRange = (article.product?.priceRange || "").trim();
  const pointRate = Number(article.product?.pointRate);
  const imageUrl = (article.product?.imageUrl || "").trim();
  const affiliateUrl = tip
    ? ""
    : (article.product?.rakutenUrl || article.product?.url || "").trim();
  const interrupt = tip
    ? null
    : (article.product?.interrupt ||
        (article.product?.labels?.arrival
          ? "arrival"
          : article.product?.labels?.limited
            ? "limited"
            : article.product?.labels?.campaign
              ? "campaign"
              : article.product?.labels?.sale
                ? "sale"
                : null)) ||
      null;

  if (!productId || !name) {
    throw new Error("article.product.id / name が必要です");
  }
  if (stockpile && !fixedPageUrl) {
    throw new Error(
      "備蓄期間中は FOOD_STOCKPILE_PAGE_URL または FOOD_FIXED_PAGE_URL が必要です（Threads/X にブログURLを付けます）",
    );
  }
  if (!tip && !stockpile && !affiliateUrl) {
    throw new Error("article.product.rakutenUrl が空です（Threads/X にアフィURLを付けられません）");
  }
  if (!tip && stockpile && !affiliateUrl) {
    // 商品カード用。SNS誘導先はブログ
    console.warn("備蓄期間: rakutenUrl が空でもブログ誘導で続行します");
  }

  const requirePr = tip ? false : ops.requirePr;
  const ask = (article.product?.ask || "").trim();
  const aside = (article.product?.aside || "").trim();
  const caption = normalizeCaption(
    tip
      ? buildTipCaption(ask, aside, name)
      : buildFourBeatCaption({
          name,
          category,
          description,
          features,
          priceRange,
          pointRate: Number.isFinite(pointRate) ? pointRate : null,
          requirePr,
          prToken: ops.prToken,
          interrupt,
          tip,
          stockpile,
        }),
  );

  const blogUtmThreads =
    stockpile && fixedPageUrl
      ? buildTrackUrl({
          blogUrl: fixedPageUrl,
          productId,
          source: "threads",
          genre: "food",
        })
      : "";
  const blogUtmIg =
    stockpile && fixedPageUrl
      ? buildTrackUrl({
          blogUrl: fixedPageUrl,
          productId,
          source: "instagram",
          genre: "food",
        })
      : "";
  const blogUtmX =
    stockpile && fixedPageUrl
      ? buildTrackUrl({
          blogUrl: fixedPageUrl,
          productId,
          source: "x",
          genre: "food",
        })
      : "";
  const snsUrlThreads = tip ? "" : stockpile ? blogUtmThreads : affiliateUrl;
  const snsUrlX = tip ? "" : stockpile ? blogUtmX : affiliateUrl;
  // IGキャプションにURLは載せない（タップ不可）。Threads/X にだけ付ける。

  const threadsText = buildThreadsText(caption, snsUrlThreads, {
    tip,
    requirePr,
    prToken: ops.prToken,
  });
  const xText = tip
    ? caption
    : buildXText({
        name,
        category,
        requirePr,
        prToken: ops.prToken,
        affiliateUrl: snsUrlX,
        interrupt,
        pointRate: Number.isFinite(pointRate) ? pointRate : null,
        stockpile,
      });

  console.log("---- food SNS CTA ----");
  console.log(`productId: ${productId}`);
  console.log(`postType: ${tip ? "tip" : "product"}`);
  console.log(
    `cta: ${
      tip
        ? "tip_self_contained"
        : stockpile
          ? "ig_self_contained + threads/x blog (stockpile)"
          : "ig_self_contained + threads/x rakuten affiliate"
    }`,
  );
  console.log(`stockpilePeriod: ${stockpile}`);
  console.log(`pr: ${requirePr}`);
  if (stockpile && blogUtmThreads) {
    console.log(`blogUtm(threads): ${blogUtmThreads.slice(0, 80)}...`);
  } else if (affiliateUrl) {
    console.log(`rakutenAffiliate: ${affiliateUrl.slice(0, 80)}...`);
  }
  if (fixedPageUrl && !stockpile) {
    console.log(`blogFixedPage(not in SNS): ${fixedPageUrl}`);
  }

  const result = {
    imageUrl,
    caption,
    blogUrl: stockpile ? fixedPageUrl : "",
    blogUtmUrl: stockpile ? blogUtmIg : "",
    productUrl: affiliateUrl || "",
    threadsText,
    threadsUtmUrl: tip ? "" : snsUrlThreads,
    xText,
    xUtmUrl: tip ? "" : snsUrlX,
    genre: "food",
    productName: name,
    productNameRaw: nameRaw || undefined,
    category,
    productId,
    cta: tip ? "tip_self_contained" : stockpile ? "stockpile_blog" : "ig_self_contained",
    pr: requirePr,
    affiliate: !tip && !stockpile,
    stockpilePeriod: stockpile,
    postType: tip ? "tip" : article.product?.postType || "main",
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-food-sns-draft.json",
    JSON.stringify(result, null, 2) + "\n",
    "utf-8",
  );

  console.log("caption生成成功 (food 4-beat + PR)");
  console.log(caption);
  console.log("--- Threads ---");
  console.log(threadsText);
  console.log("--- X ---");
  console.log(xText);
  console.log("saved:", outputPath);
}

main();
