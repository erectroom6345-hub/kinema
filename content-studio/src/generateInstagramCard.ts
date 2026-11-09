import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { buildInstagramCardSvg } from "./services/instagramCardTemplate.ts";
import {
  buildPatternCarouselSlides,
  pickBeautyPostPattern,
  patternLabel,
  type BeautyPostPatternId,
} from "./templates/beautyPostPatterns.ts";

const require = createRequire(import.meta.url);
const { cleanLivingProductName } = require("../scripts/lib/living-product-name.cjs") as {
  cleanLivingProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const { cleanGadgetProductName } = require("../scripts/lib/gadget-product-name.cjs") as {
  cleanGadgetProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const { cleanFoodProductName } = require("../scripts/lib/food-product-name.cjs") as {
  cleanFoodProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const { cleanDrinkProductName } = require("../scripts/lib/drink-product-name.cjs") as {
  cleanDrinkProductName: (raw: string, opts?: { maxLen?: number }) => string;
};
const { buildSlideReel } = require("../scripts/lib/slide-reel.cjs") as {
  buildSlideReel: (opts: {
    imagePaths: string[];
    outPath: string;
    linkUrl?: string;
    productName?: string;
  }) => Promise<{
    trackFile: string;
    outPath: string;
    seconds: number;
    qr: boolean;
  }>;
};
const { buildOverlayHookLine } = require("../scripts/lib/product-benefit-copy.cjs") as {
  buildOverlayHookLine: (opts: {
    genre: string;
    category?: string;
    name?: string;
    snippet?: string;
    maxLen?: number;
  }) => string;
};

const articlePath = "input/article.json";
const instaPath = "input/instagram-post.json";

type ArticleProductLabels = {
  sale?: boolean;
  campaign?: boolean;
  saleEndAt?: string;
  campaignEndAt?: string;
  [key: string]: unknown;
};

type ArticleInput = {
  title?: string;
  body?: string;
  product?: {
    id?: string;
    genre?: string;
    category?: string;
    name?: string;
    brand?: string;
    description?: string;
    imageUrl?: string;
    url?: string;
    rakutenUrl?: string;
    affiliate?: boolean;
    postType?: string;
    interrupt?: string | null;
    ask?: string;
    aside?: string;
    labels?: ArticleProductLabels;
    cardSlides?: { title?: string; pitch?: string }[];
  };
};

/** セール/キャンペーン中だけ「おトク」文言を使う */
function isActiveRakutenDeal(product?: ArticleInput["product"]): boolean {
  if (!product || product.affiliate === false) return false;
  const postType = String(product.postType || "").toLowerCase();
  if (postType === "sale" || postType === "campaign") return true;
  const interrupt = String(product.interrupt || "").toLowerCase();
  if (interrupt === "sale" || interrupt === "campaign") return true;
  const labels = product.labels || {};
  const now = Date.now();
  const endOk = (iso?: string) => {
    const raw = String(iso || "").trim();
    if (!raw) return true;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t >= now : true;
  };
  if (labels.sale === true && endOk(labels.saleEndAt)) return true;
  if (labels.campaign === true && endOk(labels.campaignEndAt)) return true;
  return false;
}

/** 2枚目: 定番「楽天｜商品名 / チェック」、セール時のみ「おトク」 */
function buildRakutenSlideCopy(displayName: string, onDeal: boolean): {
  title: string;
  pitch: string;
} {
  const name =
    cleanDisplayNameForRakutenSlide(displayName) || displayName || "この商品";
  return {
    title: `楽天｜${name}`,
    pitch: onDeal ? "おトク" : "チェック",
  };
}

function cleanDisplayNameForRakutenSlide(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

type InstaPost = {
  imageUrl?: string;
  imageUrls?: string[];
  mediaType?: string;
  caption?: string;
  blogUrl?: string;
  imageSource?: string;
  postPattern?: string;
  postPatternLabel?: string;
  [key: string]: unknown;
};

function envPath(name: string, fallback: string): string {
  const raw = (process.env[name] ?? "").trim();
  return raw || fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function buildPitch(caption: string, body: string, opts?: { living?: boolean }): string {
  const fromCaption = caption
    .split(/\n+/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !/^https?:\/\//i.test(line) &&
        !line.includes("ブログ") &&
        !line.includes("プロフィール") &&
        !line.includes("保存して見返"),
    );
  const source = (fromCaption || body || "").replace(/\s+/g, " ").trim();
  if (!source) {
    return opts?.living
      ? "スワイプでポイントを確認"
      : "気になったら、ブログで詳しく紹介しています。";
  }
  return source.length > 42 ? `${source.slice(0, 41)}…` : source;
}

/** 公式商品画像をカルーセルに使えるか（VC LinkSwitch 前提の通常URL画像） */
function usableProductImageUrl(raw: string): string {
  let url = String(raw || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    // 楽天サムネは小さく返ることが多い → IG向けに拡大指定
    if (/thumbnail\.image\.rakuten\.co\.jp/i.test(u.hostname)) {
      if (u.searchParams.has("_ex")) {
        u.searchParams.set("_ex", "800x800");
      } else {
        u.searchParams.set("_ex", "800x800");
      }
      url = u.toString();
    }
  } catch {
    return "";
  }
  if (/example\.com|YOURBLOG|placeholder|picsum\.photos|via\.placeholder/i.test(url)) {
    return "";
  }
  // 固定共有カード画像は商品写真扱いしない
  if (/instagram-post-01\.jpg|blogger\.googleusercontent\.com\/img\/b\/R29vZ2xl/i.test(url)) {
    return "";
  }
  return url;
}

function escapeXml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 商品写真を 1080 正方形カードに載せる（便利グッズ系は1枚目商品写真が定石）。
 * overlayText があるときは下余白帯に短文を載せ、商品本体とは重ねない。
 * 失敗時は null（呼び出し側でテンプレにフォールバック）。
 */
async function renderProductPhotoCard(
  productImageUrl: string,
  width: number,
  height: number,
  overlayText = "",
): Promise<Buffer | null> {
  try {
    const res = await fetch(productImageUrl, {
      headers: { "User-Agent": "content-studio-ig-card/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const src = Buffer.from(await res.arrayBuffer());
    const hook = String(overlayText || "").trim();
    const bandH = hook ? Math.max(120, Math.round(height * 0.12)) : 0;
    const sidePad = Math.round(width * 0.07);
    const topPad = Math.round(height * 0.07);
    const maxW = width - sidePad * 2;
    const maxH = height - topPad - Math.max(topPad, bandH + 16);
    const productPng = await sharp(src)
      .rotate()
      .resize(maxW, maxH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(productPng).metadata();
    const pw = meta.width || maxW;
    const ph = meta.height || maxH;
    const usableH = height - bandH;
    const left = Math.round((width - pw) / 2);
    const top = Math.round(Math.max(topPad * 0.5, (usableH - ph) / 2));
    const layers: sharp.OverlayOptions[] = [
      { input: productPng, left, top },
    ];
    if (hook && bandH > 0) {
      const font =
        "Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif";
      const fontSize = hook.length > 16 ? 34 : 38;
      const bandY = height - bandH;
      const textY = bandY + Math.round(bandH * 0.62);
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${bandY}" width="${width}" height="${bandH}" fill="#161311" fill-opacity="0.82"/>
  <text x="${Math.round(width / 2)}" y="${textY}" text-anchor="middle" fill="#F8F5F1" font-size="${fontSize}" font-weight="600" font-family="${font}">${escapeXml(hook)}</text>
</svg>`;
      layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 248, g: 245, b: 241 },
      },
    })
      .composite(layers)
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * 生成PNGを instagram-cards リポジトリへ反映（add/commit/push）。
 */
function publishCardsToGitHub(repoDir: string, fileNames: string[]): void {
  const enabled = (process.env.IG_CARD_GIT_PUSH ?? "true").trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "off") {
    console.log("git反映: スキップ（IG_CARD_GIT_PUSH=false）");
    return;
  }

  console.log("git反映: 開始", { repoDir, files: fileNames });

  try {
    git(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(
      `git反映で停止（リポジトリ判定）: ${repoDir} は git リポジトリではありません。` +
        ` Public の instagram-cards を clone した場所を IG_CARD_PUBLIC_DIR に指定してください。`,
    );
  }

  for (const fileName of fileNames) {
    const filePath = path.join(repoDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`git反映で停止（ファイル不在）: ${filePath}`);
    }
  }

  try {
    git(repoDir, ["add", "--", ...fileNames]);
    console.log("git反映: add OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git反映で停止（add）: ${detail}`);
  }

  try {
    execFileSync(
      "git",
      ["-C", repoDir, "diff", "--cached", "--quiet", "--", ...fileNames],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log("git反映: 変更なし → commit/push スキップ");
    return;
  } catch {
    // exit 1 = 差分あり
  }

  try {
    git(repoDir, [
      "commit",
      "-m",
      `Add Instagram card(s) ${fileNames[0]}${fileNames.length > 1 ? ` (+${fileNames.length - 1})` : ""}`,
    ]);
    console.log("git反映: commit OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git反映で停止（commit）: ${detail}`);
  }

  try {
    console.log("git反映: pull --rebase 開始");
    git(repoDir, ["pull", "--rebase", "--autostash", "origin", "main"]);
    console.log("git反映: pull --rebase OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `git反映で停止（pull --rebase）: ${detail}` +
        ` / ローカルと origin/main の履歴を確認してください`,
    );
  }

  try {
    git(repoDir, ["push", "origin", "HEAD:main"]);
    console.log("git反映: push OK → origin/main");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `git反映で停止（push）: ${detail}` +
        ` / 認証を確認: 以前通した HTTPS 資格情報（Keychain）または gh auth login`,
    );
  }
}

async function main() {
  const width = Number(process.env.IG_CARD_WIDTH ?? "1080") || 1080;
  const height = Number(process.env.IG_CARD_HEIGHT ?? "1080") || 1080;
  const publicDir = path.resolve(
    envPath("IG_CARD_PUBLIC_DIR", path.join("..", "instagram-cards")),
  );
  const publicBase = (process.env.IG_CARD_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  const carouselEnabled = envFlag("IG_CAROUSEL_ENABLED", true);
  const maxSlides = Math.min(
    10,
    Math.max(2, Number(process.env.IG_CAROUSEL_SLIDES ?? "3") || 3),
  );

  const article = JSON.parse(fs.readFileSync(articlePath, "utf-8")) as ArticleInput;
  const insta = JSON.parse(fs.readFileSync(instaPath, "utf-8")) as InstaPost;

  const genre = (article.product?.genre || "").trim();
  const productId = (article.product?.id || "beauty").replace(/[^\w-]+/g, "_");
  const ts = stamp();
  const pipelineGenre = String(
    process.env.CONTENT_PIPELINE_GENRE || article.product?.id || "",
  ).toLowerCase();
  const productIdRaw = String(article.product?.id || "");
  const genreLower = genre.toLowerCase();
  const isLivingPipeline =
    pipelineGenre.includes("living") ||
    productIdRaw.startsWith("living-") ||
    genreLower === "living";
  const isGadgetPipeline =
    pipelineGenre.includes("gadget") ||
    productIdRaw.startsWith("gadget-") ||
    genreLower === "gadget";
  const isFoodPipeline =
    pipelineGenre.includes("food") ||
    productIdRaw.startsWith("food-") ||
    genreLower === "food";
  const isDrinkPipeline =
    pipelineGenre.includes("drink") ||
    productIdRaw.startsWith("drink-") ||
    genreLower === "drink";
  /** living / gadget / food / drink: 1枚目商品写真 + 2枚目楽天CTA */
  const isProductFirstPipeline =
    isLivingPipeline || isGadgetPipeline || isFoodPipeline || isDrinkPipeline;
  const isBeautyPipeline = !isProductFirstPipeline;
  const pattern: BeautyPostPatternId | null = isBeautyPipeline
    ? pickBeautyPostPattern({ productId: article.product?.id })
    : null;
  const patternName = pattern ? patternLabel(pattern) : "";
  const productImageUrl = usableProductImageUrl(article.product?.imageUrl || "");
  const benefitGenre = isDrinkPipeline
    ? "drink"
    : isFoodPipeline
      ? "food"
      : isGadgetPipeline
        ? "gadget"
        : isLivingPipeline
          ? "living"
          : genreLower || "beauty";
  const productOverlayHook = productImageUrl
    ? buildOverlayHookLine({
        genre: benefitGenre,
        category: String(article.product?.category || "").trim(),
        name: String(article.product?.name || article.title || "").trim(),
        snippet: String(
          article.product?.description ||
            article.product?.aside ||
            insta.caption ||
            article.body ||
            "",
        ).trim(),
        maxLen: 18,
      })
    : "";

  type SlideOut = {
    title: string;
    pitch: string;
    kind: "template" | "product";
    /** 外部URL直載せ（レガシー） / 未設定ならテンプレまたは商品写真レンダ */
    externalUrl?: string;
    /** 商品写真を正方形カード化して Pages へ載せる（living / beauty） */
    renderProduct?: boolean;
  };

  const slides: SlideOut[] = (() => {
    const isTipPost = String(article.product?.postType || "").toLowerCase() === "tip";
    if (isTipPost) {
      const tipSlides = Array.isArray(article.product?.cardSlides)
        ? article.product.cardSlides
        : [];
      if (tipSlides.length) {
        return tipSlides.slice(0, maxSlides).map((s) => ({
          kind: "template" as const,
          title: String(s.title || article.product?.ask || article.title || "今日の話").trim(),
          pitch: String(s.pitch || "").trim(),
        }));
      }
      const ask = String(article.product?.ask || article.title || "今日の話").trim();
      return [
        { kind: "template" as const, title: ask, pitch: "商品リンクなし" },
        {
          kind: "template" as const,
          title: "ちなみに私は",
          pitch: String(article.product?.aside || "").trim(),
        },
        { kind: "template" as const, title: "よかったら教えてください", pitch: "商品リンクなし" },
      ].slice(0, maxSlides);
    }
    if (!carouselEnabled) {
      if (isProductFirstPipeline && productImageUrl) {
        return [
          {
            kind: "product" as const,
            title: (
              article.product?.name ||
              (isDrinkPipeline
                ? "銘酒・季節酒"
                : isFoodPipeline
                  ? "旬・手土産フード"
                  : isGadgetPipeline
                    ? "ガジェット小物"
                    : "便利グッズ")
            ).trim(),
            pitch: productOverlayHook,
            renderProduct: true,
          },
        ];
      }
      return [
        {
          kind: "template" as const,
          title: (article.title || article.product?.name || "Beauty Notes").trim(),
          pitch: buildPitch(insta.caption || "", article.body || "", {
            living: isProductFirstPipeline,
          }),
        },
      ];
    }
    if (pattern) {
      // 美容: 1枚目に商品写真（枠付きカード）、続く枚は型フック＋CTA
      // 生URL直載せはやめ、living と同じ renderProduct で見栄えを揃える
      return buildPatternCarouselSlides(pattern, {
        brand: article.product?.brand || "",
        productName: article.product?.name || "",
        genre,
        title: article.title,
        body: article.body,
        productId: article.product?.id,
      })
        .slice(0, maxSlides)
        .map((s) =>
          s.kind === "product" && productImageUrl
            ? {
                ...s,
                kind: "product" as const,
                pitch: productOverlayHook || s.pitch,
                renderProduct: true,
              }
            : { ...s, kind: "template" as const },
        );
    }
    // living/gadget/food/drink: tip=習慣メモ3枚 / 通常=1枚目商品 + 2枚目楽天CTA + 保存
    if (isProductFirstPipeline) {
      const defaultName = isDrinkPipeline
        ? "銘酒・季節酒"
        : isFoodPipeline
          ? "旬・手土産フード"
          : isGadgetPipeline
            ? "ガジェット小物"
            : "便利グッズ";
      const cleanName = isDrinkPipeline
        ? cleanDrinkProductName
        : isFoodPipeline
          ? cleanFoodProductName
          : isGadgetPipeline
            ? cleanGadgetProductName
            : cleanLivingProductName;
      const isTip =
        article.product?.affiliate === false ||
        String(article.product?.postType || "").toLowerCase() === "tip" ||
        String(insta.postType || "").toLowerCase() === "tip";
      const tipSlides = Array.isArray(article.product?.cardSlides)
        ? article.product!.cardSlides!
        : null;

      if (isTip) {
        if (tipSlides?.length) {
          return tipSlides.slice(0, maxSlides).map((s) => ({
            kind: "template" as const,
            title: String(s.title || article.product?.ask || article.product?.name || "今日の話").trim(),
            pitch: String(s.pitch || "保存して見返す").trim(),
          }));
        }
        const tipName = String(
          article.product?.ask || article.product?.name || "今日の話",
        ).trim();
        return [
          {
            kind: "template" as const,
            title: tipName,
            pitch: "商品リンクなし",
          },
          {
            kind: "template" as const,
            title: tipName,
            pitch: buildPitch(insta.caption || "", article.body || "", {
              living: true,
            }),
          },
          {
            kind: "template" as const,
            title: "よかったら教えてください",
            pitch: "アフィ無し",
          },
        ].slice(0, maxSlides);
      }

      const displayName =
        cleanName(
          article.product?.name || article.title || defaultName,
          { maxLen: 24 },
        ) || defaultName;
      const onDeal = isActiveRakutenDeal(article.product);
      const rakutenSlide = buildRakutenSlideCopy(displayName, onDeal);
      const productFirstSlides: SlideOut[] = [];
      if (productImageUrl) {
        productFirstSlides.push({
          kind: "product",
          title: displayName,
          pitch: productOverlayHook,
          renderProduct: true,
        });
      } else {
        productFirstSlides.push({
          kind: "template",
          title: displayName,
          pitch: isGadgetPipeline ? "今日のガジェット" : "今日の便利グッズ",
        });
      }
      // 2枚目: 楽天＋商品名（検索・視認用）。定番はチェック、セール/CP時のみおトク
      productFirstSlides.push({
        kind: "template",
        title: rakutenSlide.title,
        pitch: rakutenSlide.pitch,
      });
      productFirstSlides.push({
        kind: "template",
        title: "保存して見返す",
        pitch: "気になったらストックしておこう",
      });
      return productFirstSlides.slice(0, maxSlides);
    }
    // その他: 汎用3枚
    const title = (article.title || article.product?.name || "Notes").trim();
    const pitch = buildPitch(insta.caption || "", article.body || "");
    return [
      { kind: "template" as const, title, pitch: "気になるポイントを保存して見返そう" },
      {
        kind: "template" as const,
        title: (article.product?.name || title).trim(),
        pitch,
      },
      {
        kind: "template" as const,
        title: "詳しくはプロフィールから",
        pitch: "使い方のポイントをブログに整理",
      },
    ].slice(0, maxSlides);
  })();

  if (!publicBase) {
    throw new Error(
      "IG_CARD_PUBLIC_BASE_URL が未設定です。" +
        " 生成PNGを公開できるHTTPSベースURLを .env に設定してください。",
    );
  }

  fs.mkdirSync(publicDir, { recursive: true });
  const localDir = path.resolve("output", "instagram-cards");
  fs.mkdirSync(localDir, { recursive: true });

  const fileNames: string[] = [];
  const imageUrls: string[] = [];

  let usedProductPhoto = false;
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i]!;
    if (slide.externalUrl) {
      imageUrls.push(slide.externalUrl);
      usedProductPhoto = true;
      continue;
    }
    const fileName =
      slides.length === 1
        ? `${productId}-${ts}.png`
        : `${productId}-${ts}-s${i + 1}.png`;
    let png: Buffer | null = null;
    if (slide.renderProduct && productImageUrl) {
      png = await renderProductPhotoCard(
        productImageUrl,
        width,
        height,
        slide.pitch || productOverlayHook,
      );
      if (png) usedProductPhoto = true;
    }
    if (!png) {
      const svg = buildInstagramCardSvg({
        title: slide.title,
        pitch:
          slide.pitch ||
          (isDrinkPipeline
            ? "今日のお酒"
            : isFoodPipeline
              ? "今日のフード"
              : isGadgetPipeline
                ? "今日のガジェット"
                : "今日の便利グッズ"),
        genre: isDrinkPipeline
          ? "drink"
          : isFoodPipeline
            ? "food"
            : isGadgetPipeline
              ? "gadget"
              : isLivingPipeline
                ? "living"
                : genre,
        width,
        height,
        slideLabel: slides.length > 1 ? `${i + 1}/${slides.length}` : undefined,
      });
      png = await sharp(Buffer.from(svg)).png().toBuffer();
    }
    const outPath = path.join(publicDir, fileName);
    fs.writeFileSync(outPath, png);
    fs.writeFileSync(path.join(localDir, fileName), png);
    fileNames.push(fileName);
    imageUrls.push(`${publicBase}/${fileName}`);
  }

  insta.imageUrl = imageUrls[0];
  insta.imageUrls = imageUrls;
  insta.mediaType = imageUrls.length > 1 ? "carousel" : "image";
  if (envFlag("SLIDE_REEL", true) && fileNames.length) {
    try {
      const videoName = `${productId}-${ts}.mp4`;
      const videoPath = path.join(publicDir, videoName);
      const pipelineGenre = String(
        process.env.CONTENT_PIPELINE_GENRE || insta.genre || article.product?.genre || "",
      )
        .trim()
        .toLowerCase();
      // 試し運用: drink だけ楽天アフィURLのQR終端を付ける
      const drinkQrUrl =
        pipelineGenre === "drink"
          ? String(
              insta.productUrl ||
                article.product?.rakutenUrl ||
                article.product?.url ||
                "",
            ).trim()
          : "";
      const built = await buildSlideReel({
        imagePaths: fileNames.map((name) => path.join(publicDir, name)),
        outPath: videoPath,
        linkUrl: /^https?:\/\//i.test(drinkQrUrl) ? drinkQrUrl : undefined,
        productName: String(insta.productName || article.product?.name || "").trim(),
      });
      fs.copyFileSync(videoPath, path.join(localDir, videoName));
      fileNames.push(videoName);
      insta.videoUrl = `${publicBase}/${videoName}`;
      insta.mediaType = "reel";
      insta.audioTrack = built.trackFile;
      if (built.qr) insta.qrEndCard = "rakuten";
      console.log(
        `スライド動画: ${built.seconds.toFixed(1)}s track=${built.trackFile}` +
          `${built.qr ? " qr=楽天" : ""} ${videoName}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`スライド動画をスキップ（静止画のまま）: ${detail}`);
    }
  }
  insta.imageSource = usedProductPhoto
    ? isProductFirstPipeline
      ? "product-first-carousel"
      : isBeautyPipeline
        ? "beauty-product-carousel"
        : "template-card"
    : "template-card";
  if (isProductFirstPipeline) {
    insta.cta = "sns_self_contained";
  }
  if (pattern) {
    insta.postPattern = pattern;
    insta.postPatternLabel = patternName;
  }
  fs.writeFileSync(instaPath, `${JSON.stringify(insta, null, 2)}\n`, "utf-8");

  console.log(
    imageUrls.length > 1
      ? `Instagramカルーセル生成成功 slides=${imageUrls.length}`
      : "Instagramカード生成成功",
  );
  if (pattern) console.log(`postPattern: ${pattern} (${patternName})`);
  console.log(
    `genre: ${genre || "(未設定)"}${
      isGadgetPipeline ? " (gadget)" : isLivingPipeline ? " (living)" : ""
    }`,
  );
  console.log(`mediaType: ${insta.mediaType}`);
  console.log(
    `productImageSlide: ${
      usedProductPhoto
        ? isBeautyPipeline
          ? "yes (beauty: framed product first)"
          : "yes (1st preferred for product-first)"
        : "no (テンプレで代替)"
    }`,
  );
  for (const url of imageUrls) console.log(`imageUrl: ${url}`);
  console.log(`imageSource: ${insta.imageSource}`);
  // 音楽: カルーセル/静止画には Graph API で人気音を付けられない（Reels + Audio API のみ）
  if (imageUrls.length > 1) {
    console.log(
      "note: カルーセルに人気音楽の自動付与は API 非対応。音が必要なら将来 Reels 経路が必要です。",
    );
  }

  if (fileNames.length) {
    publishCardsToGitHub(publicDir, fileNames);
  } else {
    console.log("git反映: 生成PNGなし（外部商品画像のみ）→ スキップ");
  }
  console.log(
    "git反映完了。Pages反映まで1〜2分かかることがあります:",
    imageUrls[0],
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("カード生成エラー:", msg);
  process.exit(1);
});
