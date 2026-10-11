import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildInstagramCardSvg } from "./services/instagramCardTemplate.ts";
import {
  buildPatternCarouselSlides,
  pickBeautyPostPattern,
  patternLabel,
  type BeautyPostPatternId,
} from "./templates/beautyPostPatterns.ts";

const articlePath = "input/article.json";
const instaPath = "input/instagram-post.json";

type ArticleInput = {
  title?: string;
  body?: string;
  product?: {
    id?: string;
    genre?: string;
    name?: string;
    brand?: string;
    imageUrl?: string;
  };
};

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

function buildPitch(caption: string, body: string): string {
  const fromCaption = caption
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line && !/^https?:\/\//i.test(line) && !line.includes("ブログ"));
  const source = (fromCaption || body || "").replace(/\s+/g, " ").trim();
  if (!source) return "気になったら、ブログで詳しく紹介しています。";
  return source.length > 42 ? `${source.slice(0, 41)}…` : source;
}

/** 公式商品画像をカルーセルに使えるか（VC LinkSwitch 前提の通常URL画像） */
function usableProductImageUrl(raw: string): string {
  const url = String(raw || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
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
  const isBeautyPipeline =
    !pipelineGenre.includes("living") &&
    !String(article.product?.id || "").startsWith("living-");
  const pattern: BeautyPostPatternId | null = isBeautyPipeline
    ? pickBeautyPostPattern({ productId: article.product?.id })
    : null;
  const patternName = pattern ? patternLabel(pattern) : "";
  const productImageUrl = usableProductImageUrl(article.product?.imageUrl || "");

  type SlideOut = {
    title: string;
    pitch: string;
    kind: "template" | "product";
    externalUrl?: string;
  };

  const slides: SlideOut[] = (() => {
    if (!carouselEnabled) {
      return [
        {
          kind: "template" as const,
          title: (article.title || article.product?.name || "Beauty Notes").trim(),
          pitch: buildPitch(insta.caption || "", article.body || ""),
        },
      ];
    }
    if (pattern) {
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
            ? { ...s, externalUrl: productImageUrl }
            : { ...s, kind: "template" as const },
        );
    }
    // living など: 汎用3枚
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

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i]!;
    if (slide.externalUrl) {
      imageUrls.push(slide.externalUrl);
      continue;
    }
    const fileName =
      slides.length === 1
        ? `${productId}-${ts}.png`
        : `${productId}-${ts}-s${i + 1}.png`;
    const svg = buildInstagramCardSvg({
      title: slide.title,
      pitch: slide.pitch,
      genre,
      width,
      height,
      slideLabel: slides.length > 1 ? `${i + 1}/${slides.length}` : undefined,
    });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const outPath = path.join(publicDir, fileName);
    fs.writeFileSync(outPath, png);
    fs.writeFileSync(path.join(localDir, fileName), png);
    fileNames.push(fileName);
    imageUrls.push(`${publicBase}/${fileName}`);
  }

  insta.imageUrl = imageUrls[0];
  insta.imageUrls = imageUrls;
  insta.mediaType = imageUrls.length > 1 ? "carousel" : "image";
  insta.imageSource = "template-card";
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
  console.log(`genre: ${genre || "(未設定)"}`);
  console.log(`mediaType: ${insta.mediaType}`);
  console.log(
    `productImageSlide: ${productImageUrl ? "yes" : "no (テンプレで代替)"}`,
  );
  for (const url of imageUrls) console.log(`imageUrl: ${url}`);
  console.log("imageSource: template-card");
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
