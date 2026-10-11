/**
 * living SNS文生成（Instagram caption / Threads / X）
 *
 * 構成: 悩み → 変化 → 根拠 → 行動（固定ページ）
 * - 毎回 ※PR
 * - CTA は固定ページ一択（DM/コメント/リプライ誘導なし）
 * - 楽天一本（本文にモール直リンクは置かない）
 */
import fs from "node:fs";
import { normalizeCaption } from "./utils/normalizeCaption.ts";
import { buildTrackUrl, describeUtm } from "./utils/utm.ts";

const inputPath = "input/article.json";
const outputPath = "input/instagram-post.json";
const opsPath = "policy/living-ops.json";

type ArticleInput = {
  title?: string;
  body?: string;
  product?: {
    id?: string;
    name?: string;
    category?: string;
    description?: string;
    priceRange?: string;
    features?: string[];
    imageUrl?: string;
    rakutenUrl?: string;
    url?: string;
    interrupt?: string | null;
    labels?: {
      sale?: boolean;
      campaign?: boolean;
      popular?: boolean;
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

function changeLine(
  name: string,
  category: string,
  interrupt?: string | null,
): string {
  const product = name ? `「${name}」` : "便利グッズ";
  if (interrupt === "campaign") {
    return `${product}、いまのキャンペーン条件だけ先に見ておきたいです。`;
  }
  if (interrupt === "sale") {
    return `${product}、セール対象かを先に確認しておきたいです。`;
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
  description: string;
  features: string[];
  priceRange: string;
  interrupt?: string | null;
}): string {
  if (params.interrupt === "campaign") {
    return "期間と条件だけ、先に押さえておくメモです。";
  }
  if (params.interrupt === "sale") {
    return "対象かどうかは、詳細を見てからで大丈夫です。";
  }
  const feature = params.features.filter(Boolean)[0];
  if (feature) {
    // 「〜しやすい」等はそのまま、「名詞」なら「〜なのが」
    if (/[るくい]$/u.test(feature) || /やすい|にくい|できる/.test(feature)) {
      return `${feature}のがポイントです。`;
    }
    return `${feature}なのがポイントです。`;
  }
  const desc = params.description.replace(/\s+/g, " ").trim();
  if (desc) return `${desc.slice(0, 42)}${desc.length > 42 ? "…" : ""}`;
  if (params.priceRange) return `目安は${params.priceRange}で、試しやすい価格帯です。`;
  return "使う場面がはっきりしているのが安心材料です。";
}

function actionLine(prToken: string, requirePr: boolean): string {
  const base = "詳しくは、プロフィールのリンクからご覧ください";
  return requirePr ? `${base} ${prToken}` : base;
}

function buildFourBeatCaption(params: {
  name: string;
  category: string;
  description: string;
  features: string[];
  priceRange: string;
  requirePr: boolean;
  prToken: string;
  interrupt?: string | null;
}): string {
  return [
    worryLine(params.category),
    changeLine(params.name, params.category, params.interrupt),
    reasonLine(params),
    actionLine(params.prToken, params.requirePr),
  ].join("\n");
}

function buildThreadsText(caption: string, trackUrl: string): string {
  const body = caption
    .replace(/\n*詳しくは、プロフィールのリンクからご覧ください\s*※?PR?\s*$/u, "")
    .replace(/\n*https?:\/\/\S+/gi, "")
    .trim();
  return `${body}\n${trackUrl}`.trim();
}

function buildXText(params: {
  name: string;
  category: string;
  trackUrl: string;
  requirePr: boolean;
  prToken: string;
}): string {
  const line1 = worryLine(params.category).replace(/。$/, "");
  const line2 = changeLine(params.name, params.category);
  const pr = params.requirePr ? ` ${params.prToken}` : "";
  const text = `${line1}。\n${line2}${pr}\n${params.trackUrl}`;
  return text.length > 260 ? `${text.slice(0, 250)}…` : text;
}

function main() {
  const article = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as ArticleInput;
  const ops = readOps();
  const fixedPageUrl = resolveFixedPageUrl(ops.fixedPageUrl);
  if (!fixedPageUrl) {
    throw new Error(
      "LIVING_FIXED_PAGE_URL が未設定です。暮らし入口の固定ページURLを .env に設定してください。",
    );
  }

  const productId = (article.product?.id || "").trim();
  const name = (article.product?.name || "").trim();
  const category = (article.product?.category || "other").trim();
  const description = (article.product?.description || article.body || "").trim();
  const features = Array.isArray(article.product?.features)
    ? article.product!.features!
    : [];
  const priceRange = (article.product?.priceRange || "").trim();
  const imageUrl = (article.product?.imageUrl || "").trim();
  const interrupt =
    (article.product?.interrupt ||
      (article.product?.labels?.campaign
        ? "campaign"
        : article.product?.labels?.sale
          ? "sale"
          : null)) ||
    null;

  if (!productId || !name) {
    throw new Error("article.product.id / name が必要です");
  }

  const caption = normalizeCaption(
    buildFourBeatCaption({
      name,
      category,
      description,
      features,
      priceRange,
      requirePr: ops.requirePr,
      prToken: ops.prToken,
      interrupt,
    }),
  );

  const igUtm = buildTrackUrl({
    blogUrl: fixedPageUrl,
    productId,
    source: "instagram",
    genre: "living",
  });
  const threadsUtm = buildTrackUrl({
    blogUrl: fixedPageUrl,
    productId,
    source: "threads",
    genre: "living",
  });
  const xUtm = buildTrackUrl({
    blogUrl: fixedPageUrl,
    productId,
    source: "x",
    genre: "living",
  });

  const threadsText = buildThreadsText(caption, threadsUtm);
  const xText = buildXText({
    name,
    category,
    trackUrl: xUtm,
    requirePr: ops.requirePr,
    prToken: ops.prToken,
  });

  console.log("---- living SNS CTA (fixed page) ----");
  console.log(`productId: ${productId}`);
  console.log(`fixedPage: ${fixedPageUrl}`);
  console.log(`IG utm: ${JSON.stringify(describeUtm(igUtm))}`);
  console.log(`Threads utm: ${JSON.stringify(describeUtm(threadsUtm))}`);
  console.log(`X utm: ${JSON.stringify(describeUtm(xUtm))}`);

  const result = {
    imageUrl,
    caption,
    blogUrl: fixedPageUrl,
    blogUtmUrl: igUtm,
    threadsText,
    threadsUtmUrl: threadsUtm,
    xText,
    xUtmUrl: xUtm,
    genre: "living",
    productName: name,
    category,
    productId,
    cta: "fixed_page",
    pr: ops.requirePr,
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
