/**
 * drink SNS文生成（Instagram caption / Threads / X）
 *
 * 構成: 場面 → 特別さ → 根拠 → 行動
 * - 毎回 ※PR（tip除く）
 * - Instagram: 投稿内完結（保存CTA・URLなし）。ブログ誘導なし
 * - Threads / X: SNS完結 = 楽天アフィリエイト直載せ（ブログ誘導はしない）
 * - ブログはカテゴリまとめ専用（SNSからの誘導先にしない。美容だけブログ誘導）
 * - 産地自慢・希少語は limited/arrival のときだけ
 */
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { normalizeCaption } from "./utils/normalizeCaption.ts";

const require = createRequire(import.meta.url);
const { cleanDrinkProductName } = require("../scripts/lib/drink-product-name.cjs") as {
  cleanDrinkProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const {
  buildReasonLine: buildBenefitReason,
  buildDetailLine,
  buildAudienceLine,
  buildFutureLine,
  buildShortAffiliateThreadsText,
} = require("../scripts/lib/product-benefit-copy.cjs") as {
  buildReasonLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
    snippet?: string;
    maxLen?: number;
  }) => string;
  buildDetailLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
    snippet?: string;
    maxLen?: number;
  }) => string;
  buildAudienceLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
  }) => string;
  buildFutureLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
  }) => string;
  buildShortAffiliateThreadsText: (opts: {
    line1: string;
    line2: string;
    affiliateUrl?: string;
    tip?: boolean;
    requirePr?: boolean;
    prToken?: string;
  }) => string;
};

const inputPath = "input/article.json";
const outputPath = "input/instagram-post.json";
const opsPath = "policy/drink-ops.json";

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

function readOps(): { requirePr: boolean; prToken: string; fixedPageUrl: string } {
  let requirePr = true;
  let prToken = "※PR";
  try {
    const ops = JSON.parse(fs.readFileSync(opsPath, "utf8")) as {
      posting?: { requirePr?: boolean };
      snsCopy?: { prToken?: string };
    };
    requirePr = ops.posting?.requirePr !== false;
    prToken = ops.snsCopy?.prToken || "※PR";
  } catch {
    /* default */
  }
  const fixedPageUrl = (
    process.env.DRINK_FIXED_PAGE_URL ||
    process.env.DRINK_BLOG_FIXED_PAGE_URL ||
    ""
  ).trim();
  return { requirePr, prToken, fixedPageUrl };
}

function resolveFixedPageUrl(configured: string): string {
  if (configured) return configured;
  // dry-run / 未設定時の仮値（本番は DRINK_FIXED_PAGE_URL 必須）
  if (
    process.env.DRINK_ALLOW_SAMPLE_CTA === "true" ||
    process.env.SAMPLE_BLOG_BODY === "1" ||
    process.argv.includes("--dry-run-cta")
  ) {
    return "https://drink-notes-sample.blogspot.com/p/drink.html";
  }
  return "";
}

function sceneLine(category: string): string {
  switch ((category || "").trim().toLowerCase()) {
    case "sake":
      return "食卓の一杯、どんな日本酒にしようか迷っていませんか。";
    case "shochu":
      return "焼酎の一本、いつもと同じでいいか迷っていませんか。";
    case "fruit":
      return "甘めの一杯、手土産や食後用を探していませんか。";
    case "seasonal":
      return "季節酒、いまのタイミングで一本ほしいと思っていませんか。";
    default:
      return "いまの食卓や手土産の一杯、少し気になる銘柄はありませんか。";
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
): string {
  if (tip) {
    const tipTitle = name || "この選び方";
    return `${tipTitle}。選ぶときの基準がひとつ増えます。`;
  }
  const product = name ? `「${name}」` : "このお酒";
  const offer = pointOffer(pointRate);
  if (interrupt === "arrival") {
    return `${product}、いま届く一本です。食卓で試せます。`;
  }
  if (interrupt === "limited") {
    return `${product}。いまの季節に一杯試すなら、このタイミングです。`;
  }
  if ((interrupt === "campaign" || interrupt === "sale") && offer) {
    return `${product}、いま${offer}です。買いだめもしやすい一本です。`;
  }
  if (interrupt === "campaign" || interrupt === "sale") {
    return `${product}。食卓で一杯試すなら、いま手に取りやすいです。`;
  }
  switch ((category || "").trim().toLowerCase()) {
    case "sake":
      return `${product}。晩酌で一杯試すなら、この一本からでよさそうです。`;
    case "shochu":
      return `${product}。いつもの晩酌を一本変えてみるのに向いています。`;
    case "fruit":
      return `${product}。食後や手土産で、まず一杯試せます。`;
    case "seasonal":
      return `${product}。いまの季節に、一杯試すのに向いています。`;
    default:
      return `${product}。食卓で一杯試すのに向いています。`;
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
    return "入っているうちに、香りと飲み口を自分のペースで確かめられます。";
  }
  if (params.interrupt === "limited") {
    return "季節のうちに、香りや飲み口を一度味わってみたい人向けです。";
  }
  if (
    (params.interrupt === "campaign" || params.interrupt === "sale") &&
    offer &&
    price
  ) {
    return `${price}。${offer}なので、普段よりまとめ買いしやすいです。`;
  }
  if ((params.interrupt === "campaign" || params.interrupt === "sale") && offer) {
    return `${offer}なので、買いだめもしやすいタイミングです。`;
  }
  if (params.interrupt === "campaign" || params.interrupt === "sale") {
    return price
      ? `${price}。まず一本、食卓で試すのに向いています。`
      : "まず一本、食卓で試すのに向いています。";
  }
  const feature = params.features
    .map((f) => String(f || "").trim())
    .find(
      (f) =>
        f &&
        !/^ショップ[:：]/u.test(f) &&
        !/^税込目安/u.test(f) &&
        !/^ポイント\d+倍$/u.test(f) &&
        !/ランキング|送料|ギフト包装|法事|仏事|還暦|感謝箱/.test(f),
    );
  const snippet = [feature, params.description].filter(Boolean).join(" ");
  return buildBenefitReason({
    genre: "drink",
    category: params.category,
    name: params.name,
    snippet,
    maxLen: 52,
  });
}

/** Instagram: 試しでリール末尾に楽天QR。プロフィール誘導はしない */
function actionLine(prToken: string, requirePr: boolean): string {
  const base = "動画の最後は楽天QRです";
  return requirePr ? `${base} ${prToken}` : base;
}

function buildTipCaption(ask: string, aside: string, name: string): string {
  const question = ask.trim() || `${name}。みなさんはどうしていますか？`;
  const mine = aside.trim();
  return mine ? `${question}\n${mine}` : question;
}

/** Instagram: 場面→商品→具体→誰向け→理想の未来→（セール時）→楽天QR */
function buildIgCaption(params: {
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
}): string {
  const feature = params.features
    .map((f) => String(f || "").trim())
    .find(
      (f) =>
        f &&
        !/^ショップ[:：]/u.test(f) &&
        !/^税込目安/u.test(f) &&
        !/^ポイント\d+倍$/u.test(f) &&
        !/ランキング|送料|ギフト包装|法事|仏事|還暦|感謝箱/.test(f),
    );
  const snippet = [feature, params.description].filter(Boolean).join(" ");
  const lines = [
    sceneLine(params.category),
    specialLine(
      params.name,
      params.category,
      params.interrupt,
      params.tip,
      params.pointRate,
    ),
    buildDetailLine({
      genre: "drink",
      category: params.category,
      name: params.name,
      snippet,
      maxLen: 72,
    }),
    buildAudienceLine({
      genre: "drink",
      category: params.category,
      name: params.name,
    }),
    buildFutureLine({
      genre: "drink",
      category: params.category,
      name: params.name,
    }),
  ];
  if (params.interrupt === "campaign" || params.interrupt === "sale") {
    lines.push(reasonLine(params));
  }
  lines.push(actionLine(params.prToken, params.requirePr));
  return lines.join("\n");
}

function buildXText(params: {
  name: string;
  category: string;
  requirePr: boolean;
  prToken: string;
  affiliateUrl?: string;
  interrupt?: string | null;
  pointRate?: number | null;
}): string {
  const line1 = sceneLine(params.category).replace(/。$/, "");
  const line2 = specialLine(
    params.name,
    params.category,
    params.interrupt,
    false,
    params.pointRate,
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

  // 固定ページはブログまとめ用（SNS本文には載せない）
  const fixedPageUrl = resolveFixedPageUrl(ops.fixedPageUrl);

  const productId = (article.product?.id || "").trim();
  const nameRaw = (
    article.product?.nameRaw ||
    article.product?.name ||
    ""
  ).trim();
  // tip は短いタイトルをそのまま。商品は整形名
  const name = tip
    ? (article.product?.name || nameRaw).trim().slice(0, 32)
    : cleanDrinkProductName((article.product?.name || nameRaw).trim(), {
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
  if (!tip && !affiliateUrl) {
    throw new Error("article.product.rakutenUrl が空です（Threads/X にアフィURLを付けられません）");
  }

  const requirePr = tip ? false : ops.requirePr;
  const ask = (article.product?.ask || "").trim();
  const aside = (article.product?.aside || "").trim();
  const scene = sceneLine(category);
  const special = specialLine(
    name,
    category,
    interrupt,
    tip,
    Number.isFinite(pointRate) ? pointRate : null,
  );
  const caption = normalizeCaption(
    tip
      ? buildTipCaption(ask, aside, name)
      : buildIgCaption({
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
        }),
  );

  const threadsText = tip
    ? caption
    : buildShortAffiliateThreadsText({
        line1: scene,
        line2: special,
        affiliateUrl,
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
        affiliateUrl,
        interrupt,
        pointRate: Number.isFinite(pointRate) ? pointRate : null,
      });

  console.log("---- drink SNS CTA ----");
  console.log(`productId: ${productId}`);
  console.log(`postType: ${tip ? "tip" : "product"}`);
  console.log(
    `cta: ${tip ? "tip_self_contained" : "ig 楽天QR + threads/x rakuten affiliate"}`,
  );
  console.log(`pr: ${requirePr}`);
  if (affiliateUrl) console.log(`rakutenAffiliate: ${affiliateUrl.slice(0, 80)}...`);
  if (fixedPageUrl) console.log(`blogFixedPage(not in SNS): ${fixedPageUrl}`);

  const result = {
    imageUrl,
    caption,
    blogUrl: "",
    blogUtmUrl: "",
    productUrl: affiliateUrl || "",
    threadsText,
    threadsUtmUrl: tip ? "" : affiliateUrl,
    xText,
    xUtmUrl: tip ? "" : affiliateUrl,
    genre: "drink",
    productName: name,
    productNameRaw: nameRaw || undefined,
    category,
    productId,
    cta: tip ? "tip_self_contained" : "ig_rakuten_qr",
    pr: requirePr,
    affiliate: !tip,
    postType: tip ? "tip" : article.product?.postType || "main",
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-drink-sns-draft.json",
    JSON.stringify(result, null, 2) + "\n",
    "utf-8",
  );

  console.log("caption生成成功 (drink IG長文 + Threads短文 + PR)");
  console.log(caption);
  console.log("--- Threads ---");
  console.log(threadsText);
  console.log("--- X ---");
  console.log(xText);
  console.log("saved:", outputPath);
}

main();
