/**
 * gadget SNS文生成（Instagram caption / Threads / X）
 *
 * 構成: 悩み → 変化 → 根拠 → 行動
 * - 毎回 ※PR
 * - Instagram: 投稿内完結（保存CTA・URLなし）
 * - Threads / X: 通常は楽天アフィ直載せ。備蓄期間のみ備えまとめページURL
 * - ブログはカテゴリまとめ専用（備蓄期間だけSNS誘導先）
 * - DM/コメント/リプライ誘導なし
 */
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { normalizeCaption } from "./utils/normalizeCaption.ts";
import { buildTrackUrl } from "./utils/utm.ts";

const require = createRequire(import.meta.url);
const { cleanGadgetProductName } = require("../scripts/lib/gadget-product-name.cjs") as {
  cleanGadgetProductName: (raw: string, opts?: { maxLen?: number }) => string;
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
const opsPath = "policy/gadget-ops.json";

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
  const forced = envFlag("GADGET_STOCKPILE_MODE");
  const start =
    String(process.env.GADGET_STOCKPILE_START || "").slice(0, 10) || stockpileStart;
  const end =
    String(process.env.GADGET_STOCKPILE_END || "").slice(0, 10) || stockpileEnd;
  const today = tokyoDayKey();
  const inWindow = Boolean(start && end) && today >= start && today <= end;
  const stockpileActive =
    forced === true ? true : forced === false ? false : stockpileEnabled && inWindow;
  const fixedPageUrl = (
    (stockpileActive
      ? process.env.GADGET_STOCKPILE_PAGE_URL || process.env.GADGET_FIXED_PAGE_URL
      : process.env.GADGET_FIXED_PAGE_URL) ||
    process.env.GADGET_BLOG_FIXED_PAGE_URL ||
    ""
  ).trim();
  return { requirePr, prToken, fixedPageUrl, stockpileActive };
}

function resolveFixedPageUrl(configured: string): string {
  if (configured) return configured;
  // dry-run / 未設定時の仮値（本番は GADGET_FIXED_PAGE_URL 必須）
  if (
    process.env.GADGET_ALLOW_SAMPLE_CTA === "true" ||
    process.env.SAMPLE_BLOG_BODY === "1" ||
    process.argv.includes("--dry-run-cta")
  ) {
    return "https://gadget-notes-sample.blogspot.com/p/gadget.html";
  }
  return "";
}

function worryLine(category: string, stockpile?: boolean): string {
  if (stockpile) {
    switch ((category || "").trim().toLowerCase()) {
      case "power":
        return "停電や外出に備えるモバイルバッテリー、用意していますか。";
      case "other":
        return "家庭の備え、携帯トイレや電灯は足りていますか。";
      default:
        return "家庭の備えグッズ、いまのうちに見直していませんか。";
    }
  }
  switch ((category || "").trim().toLowerCase()) {
    case "power":
      return "充電まわり、差し替えが多くて毎回手間になっていませんか。";
    case "cable":
      return "デスクのケーブル、絡まって探す時間が増えていませんか。";
    case "desk":
      return "作業スペース、小物が増えて集中が途切れていませんか。";
    case "audio":
      return "音まわりの小物、しまう場所が決まらず散らかっていませんか。";
    case "phone":
      return "スマホ周辺、置く場所が決まらず手元が散らかっていませんか。";
    default:
      return "ガジェット小物、増えるほど管理が面倒になっていませんか。";
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
  stockpile?: boolean,
): string {
  if (tip) {
    const tipTitle = name || "この習慣";
    return `${tipTitle}。これを意識すると、デスク周りの詰まりがひとつ減りそうです。`;
  }
  const product = name ? `「${name}」` : "ガジェット小物";
  const offer = pointOffer(pointRate);
  if (stockpile) {
    if ((interrupt === "campaign" || interrupt === "sale") && offer) {
      return `${product}、いま${offer}です。家庭の備えにも置きやすい一本です。`;
    }
    return `${product}。家庭の備えとして、一度試してみてください。`;
  }
  if ((interrupt === "campaign" || interrupt === "sale") && offer) {
    return `${product}、いま${offer}です。買い足しもしやすいタイミングです。`;
  }
  if (interrupt === "campaign" || interrupt === "sale") {
    return `${product}。気になったら、一度試してみてください。`;
  }
  switch ((category || "").trim().toLowerCase()) {
    case "power":
      return `${product}なら、充電の差し替えが一段すっきりしそうです。`;
    case "cable":
      return `${product}なら、配線の迷いが減って取り出しやすくなりそうです。`;
    case "desk":
      return `${product}に変えると、作業スペースの余白が戻りそうです。`;
    case "audio":
      return `${product}なら、音まわりの置き場が決まって続きやすそうです。`;
    case "phone":
      return `${product}なら、スマホ周りの定位置ができそうです。`;
    default:
      return `${product}で、持ち運びと片付けの一手間が減りそうです。`;
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
        !/ランキング|送料|適格請求書|iPhone\d+/i.test(f),
    );
  const snippet = [feature, params.description].filter(Boolean).join(" ");
  return buildBenefitReason({
    genre: "gadget",
    category: params.category,
    name: params.name,
    snippet,
    maxLen: 52,
  });
}

/** Instagram 完結用。プロフィール/ブログへ送らない */
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
    worryLine(params.category, params.stockpile),
    changeLine(
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

/** Threads: 保存CTAを外し、楽天アフィURLを末尾に（tipはURLなし）。ブログ誘導はしない */
function buildThreadsText(
  caption: string,
  affiliateUrl: string,
  opts: { tip?: boolean; requirePr?: boolean; prToken?: string },
): string {
  let body = caption
    .replace(/\n*気になったら、保存して見返してみてください\s*※?PR?\s*$/u, "")
    .replace(/\n*https?:\/\/\S+/gi, "")
    .replace(/\n*詳しくは、プロフィールのリンクからご覧ください\s*※?PR?\s*$/u, "")
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
  const line1 = worryLine(params.category, params.stockpile).replace(/。$/, "");
  const line2 = changeLine(
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
  const stockpile = !tip && ops.stockpileActive;

  // 備蓄期間は備えまとめページをSNSへ。通常は固定ページをSNSに載せない
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
    : cleanGadgetProductName((article.product?.name || nameRaw).trim(), {
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
  if (stockpile && !fixedPageUrl) {
    throw new Error(
      "備蓄期間中は GADGET_STOCKPILE_PAGE_URL または GADGET_FIXED_PAGE_URL が必要です",
    );
  }
  if (!tip && !stockpile && !affiliateUrl) {
    throw new Error("article.product.rakutenUrl が空です（Threads/X にアフィURLを付けられません）");
  }
  if (!tip && stockpile && !affiliateUrl) {
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
          genre: "gadget",
        })
      : "";
  const blogUtmX =
    stockpile && fixedPageUrl
      ? buildTrackUrl({
          blogUrl: fixedPageUrl,
          productId,
          source: "x",
          genre: "gadget",
        })
      : "";
  const snsUrlThreads = tip ? "" : stockpile ? blogUtmThreads : affiliateUrl;
  const snsUrlX = tip ? "" : stockpile ? blogUtmX : affiliateUrl;

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

  console.log("---- gadget SNS CTA ----");
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
    blogUtmUrl: stockpile ? blogUtmThreads : "",
    threadsText,
    threadsUtmUrl: tip ? "" : snsUrlThreads,
    xText,
    xUtmUrl: tip ? "" : snsUrlX,
    genre: "gadget",
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
    "output/last-gadget-sns-draft.json",
    JSON.stringify(result, null, 2) + "\n",
    "utf-8",
  );

  console.log("caption生成成功 (gadget 4-beat + PR)");
  console.log(caption);
  console.log("--- Threads ---");
  console.log(threadsText);
  console.log("--- X ---");
  console.log(xText);
  console.log("saved:", outputPath);
}

main();
