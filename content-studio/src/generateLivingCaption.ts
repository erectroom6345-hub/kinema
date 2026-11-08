/**
 * living SNS文生成（Instagram caption / Threads / X）
 *
 * 構成: 悩み → 変化 → 根拠 → 行動
 * - 毎回 ※PR
 * - Instagram: 投稿内完結（保存CTA・URLなし）
 * - Threads / X: 楽天アフィリエイト直載せ（SNS完結。ブログ誘導はしない）
 * - ブログはカテゴリまとめ専用（SNSからの誘導先にしない）
 * - DM/コメント/リプライ誘導なし
 */
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { normalizeCaption } from "./utils/normalizeCaption.ts";

const require = createRequire(import.meta.url);
const { cleanLivingProductName } = require("../scripts/lib/living-product-name.cjs") as {
  cleanLivingProductName: (raw: string, opts?: { maxLen?: number }) => string;
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
const opsPath = "policy/living-ops.json";

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
    process.env.LIVING_FIXED_PAGE_URL ||
    process.env.LIVING_BLOG_FIXED_PAGE_URL ||
    ""
  ).trim();
  return { requirePr, prToken, fixedPageUrl };
}

function resolveFixedPageUrl(configured: string): string {
  if (configured) return configured;
  // dry-run / 未設定時の仮値（本番は LIVING_FIXED_PAGE_URL 必須）
  if (
    process.env.LIVING_ALLOW_SAMPLE_CTA === "true" ||
    process.env.SAMPLE_BLOG_BODY === "1" ||
    process.argv.includes("--dry-run-cta")
  ) {
    return "https://living-notes-sample.blogspot.com/p/living.html";
  }
  return "";
}

function worryLine(category: string): string {
  switch ((category || "").trim().toLowerCase()) {
    case "kitchen":
      return "キッチン、使うたびに少し散らかってストレスになっていませんか。";
    case "storage":
      return "しまう場所が決まらず、同じものを探し直していませんか。";
    case "cleaning":
      return "掃除、後回しにするほど面倒に感じていませんか。";
    default:
      return "暮らしの動線、ちょっとした詰まりで疲れていませんか。";
  }
}

function pointOffer(pointRate?: number | null): string | null {
  const n = Number(pointRate);
  if (!Number.isFinite(n) || n < 2) return null;
  return `ポイント${Math.round(n)}倍`;
}

function changeLine(
  name: string,
  category: string,
  interrupt?: string | null,
  tip?: boolean,
  pointRate?: number | null,
): string {
  if (tip) {
    const tipTitle = name || "この習慣";
    return `${tipTitle}。これを意識すると、散らかりの発生源がひとつ減りそうです。`;
  }
  const product = name ? `「${name}」` : "便利グッズ";
  const offer = pointOffer(pointRate);
  if ((interrupt === "campaign" || interrupt === "sale") && offer) {
    return `${product}、いま${offer}です。買い足しもしやすいタイミングです。`;
  }
  if (interrupt === "campaign" || interrupt === "sale") {
    return `${product}。気になったら、一度試してみてください。`;
  }
  switch ((category || "").trim().toLowerCase()) {
    case "kitchen":
      return `${product}に変えると、取り出しと片付けが一息楽になりそうです。`;
    case "storage":
      return `${product}なら、置き場所が決まって探し物が減りそうです。`;
    case "cleaning":
      return `${product}なら、毎日のちょい掃除が続きやすくなりそうです。`;
    default:
      return `${product}で、動線の引っかかりがひとつ減りそうです。`;
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
  if (
    (params.interrupt === "campaign" || params.interrupt === "sale") &&
    offer &&
    price
  ) {
    return `${price}。${offer}なので、普段より買い足しやすいです。`;
  }
  if ((params.interrupt === "campaign" || params.interrupt === "sale") && offer) {
    return `${offer}なので、買い足しやすいタイミングです。`;
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
    genre: "living",
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
}): string {
  return [
    worryLine(params.category),
    changeLine(
      params.name,
      params.category,
      params.interrupt,
      params.tip,
      params.pointRate,
    ),
    reasonLine(params),
    actionLine(params.prToken, params.requirePr),
  ].join("\n");
}

/** Threads: 保存CTAを外し、楽天アフィURLを末尾に（tipはURLなし）。ブログ誘導はしない */
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
}): string {
  const line1 = worryLine(params.category).replace(/。$/, "");
  const line2 = changeLine(
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

  // 固定ページはブログまとめ用。SNS本文には載せない（未設定でもSNS生成は続行）
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
    : cleanLivingProductName((article.product?.name || nameRaw).trim(), {
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
        (article.product?.labels?.campaign
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
        }),
  );

  const threadsText = buildThreadsText(caption, affiliateUrl, {
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

  console.log("---- living SNS CTA ----");
  console.log(`productId: ${productId}`);
  console.log(`postType: ${tip ? "tip" : "product"}`);
  console.log(
    `cta: ${tip ? "tip_self_contained" : "ig_self_contained + threads/x rakuten affiliate"}`,
  );
  if (affiliateUrl) console.log(`rakutenAffiliate: ${affiliateUrl.slice(0, 80)}...`);
  console.log(`pr: ${requirePr}`);
  if (fixedPageUrl) {
    console.log(`blogFixedPage(not in SNS): ${fixedPageUrl}`);
  }

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
    genre: "living",
    productName: name,
    productNameRaw: nameRaw || undefined,
    category,
    productId,
    cta: tip ? "tip_self_contained" : "ig_self_contained",
    pr: requirePr,
    affiliate: !tip,
    postType: tip ? "tip" : article.product?.postType || "main",
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-living-sns-draft.json",
    JSON.stringify(result, null, 2) + "\n",
    "utf-8",
  );

  console.log("caption生成成功 (living 4-beat + PR)");
  console.log(caption);
  console.log("--- Threads ---");
  console.log(threadsText);
  console.log("--- X ---");
  console.log(xText);
  console.log("saved:", outputPath);
}

main();
