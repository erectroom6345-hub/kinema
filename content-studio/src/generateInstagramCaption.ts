import fs from "node:fs";
import { normalizeCaption } from "./utils/normalizeCaption.ts";

const inputPath = "input/article.json";
const outputPath = "input/instagram-post.json";

type ArticleInput = {
  title?: string;
  body?: string;
  articleTitle?: string;
  articleBody?: string;
  imageUrl?: string;
  product?: {
    name?: string;
    brand?: string;
    genre?: string;
    postType?: string;
    imageUrl?: string;
    url?: string;
  };
};

const raw = fs.readFileSync(inputPath, "utf-8");
const article = JSON.parse(raw) as ArticleInput;

function buildToneGuidance(postType: string, genre: string, brand = "", productName = ""): string {
  const type = postType.trim().toLowerCase();
  const g = genre.trim();

  const genreAxis = resolveGenreAxis(g);
  const postTypeAxis = resolvePostTypeAxis(type);
  const useFindTone = shouldUseFindTone(type, g, brand, productName);

  const lines = [
    "トーン指定（必須）",
    `・genre（商品タイプ）: ${g || "(未設定)"} → ${genreAxis}`,
    `・postType（補正）: ${type || "(未設定)"} → ${postTypeAxis}`,
    "・まず genre の商品タイプを崩さないこと",
    "・そのうえで postType の補正を重ねること",
    "・caption には、少しだけ「見つけてうれしい」「早めに見ておきたい」気持ちを自然に足してよい",
    "・押し売りや効果効能の断定はしない",
    "・別ジャンルの話には寄せない",
    "・ブランド名は角括弧付き（例: [hince]）で書かない",
    "・ブランド名を出す場合は、日本語の文の中で自然につなげる",
    "・基本形: 「ブランド名のアイテム」「ブランド名らしい雰囲気」「ブランド名で気になる一品」",
    "・1つのcaption内でブランド名の出現は多くても1回か2回まで",
    "・無理に入れなくて自然なら、ブランド名は省略してよい",
  ];

  // サプリ × main だけ、定番の習慣寄りを優先（ほかの組み合わせは変えない）
  if (type === "main" && g === "サプリ") {
    lines.push(
      "・今回の優先: 毎日の習慣、取り入れやすさ、続けやすさ",
      "・啓発調や一般論の美しさ論より、定番として続けやすい感じを出す",
    );
  }

  if (useFindTone) {
    lines.push(
      "・補助トーン（掘り出し物）: 今回は少しだけ使ってよい",
      "・「見つけられてうれしい」「気になったら早めに見ておきたい」を、genre / postType を壊さない範囲で薄く乗せる",
      "・掘り出し物感を主役にしない。自慢や煽りにはしない",
    );
  } else {
    lines.push("・補助トーン（掘り出し物）: 今回は使わない");
  }

  return lines.join("\n");
}

/** genre = 商品タイプの軸 */
function resolveGenreAxis(genre: string): string {
  switch (genre.trim()) {
    case "メイク用品":
      return "仕上がりと使いやすさ（毎日のメイク視点）";
    case "スキンケア":
      return "継続と心地よさ";
    case "韓国コスメ":
      return "話題性とチェック欲";
    case "サプリ":
      return "内側ケアと習慣";
    case "特別ケア":
      return "ご褒美感と丁寧さ";
    default:
      return "商品タイプに合う自然な視点";
  }
}

/** postType = genre を壊さない補正 */
function resolvePostTypeAxis(postType: string): string {
  switch (postType.trim().toLowerCase()) {
    case "sale":
      return "条件確認とお得感（対象か・詳細を見て判断）";
    case "routine":
      return "日常使い";
    case "main":
      return "定番感と続けやすさ（啓発調より、無理なく続く感じ）";
    case "special":
      return "特別感";
    case "niche":
      return "人とかぶりにくい良品感（さりげなく）";
    default:
      return "商品に合う自然な補正";
  }
}

/**
 * 掘り出し物は genre とは別の補助トーン。
 * セール / 韓国コスメ / 知名度が高すぎない良品 にだけ、時々乗せる。
 */
function shouldUseFindTone(postType: string, genre: string, brand: string, productName: string): boolean {
  const type = postType.trim().toLowerCase();
  const g = genre.trim();
  const eligible =
    type === "sale" ||
    g === "韓国コスメ" ||
    type === "niche" ||
    (isLessFamousGood(brand, productName) && (type === "main" || type === "routine" || type === "special"));

  if (!eligible) return false;

  // 毎回ではなく時々（商品キーで安定した約4割）
  const key = `${type}|${g}|${brand}|${productName}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash + key.charCodeAt(i) * (i + 1)) % 100;
  }
  return hash < 40;
}

function isLessFamousGood(brand: string, productName: string): boolean {
  const text = `${brand} ${productName}`;
  // 知名度が高めの定番ブランドは掘り出し物補助の対象外
  if (/コスメデコルテ|デコルテ|イプサ|IPSA|ファンケル|FANCL|SK-?II|エスケーツー|資生堂|SHISEIDO|カネボウ|KOSE|コーセー|ポーラ|POLA|アルビオン|ALBION/i.test(text)) {
    return false;
  }
  return Boolean(brand.trim() || productName.trim());
}

async function generateCaption() {
  const title = (article.title || article.articleTitle || "").trim();
  const body = (article.body || article.articleBody || "").trim();
  const postType = (article.product?.postType || "").trim();
  const genre = (article.product?.genre || "").trim();
  const productName = (article.product?.name || "").trim();
  const brand = (article.product?.brand || "").trim();
  const imageUrl = article.product?.imageUrl || article.imageUrl || "";

  if (!postType || !genre) {
    throw new Error("product.postType と product.genre が article.json に必要です");
  }

  const toneGuidance = buildToneGuidance(postType, genre, brand, productName);

  const prompt = `
あなたは美容ブログのInstagram運用担当です。
次の商品・記事をもとに、Instagram投稿用のcaptionを1本だけ作ってください。

条件
・ですます調
・やわらかい文体
・短め
・100文字から180文字程度
・ハッシュタグ不要
・本文だけ返す
・誇張しない
・押し売りしない
・ブランド名を [ブランド] の形で書かない
・ブランド名を出すなら「◯◯のアイテム」「◯◯らしい雰囲気」「◯◯で気になる一品」など、日本語の文中で自然につなげる
・ブランド名の出現は1回か2回までに抑える
・なくても自然ならブランド名は無理に入れない
・[コスメデコルテらしい雰囲気] のように、文の一部を角括弧で囲まない

${toneGuidance}

商品情報
・商品名: ${productName || "(未設定)"}
・ブランド: ${brand || "(未設定)"}
・postType: ${postType}
・genre: ${genre}

記事タイトル
${title || "(未設定)"}

記事本文
${body || "(未設定)"}
`;

  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemma3:4b",
      prompt,
      stream: false,
    }),
  });

  const data = (await res.json()) as { response?: string };
  const caption = sanitizeCaption(data.response ?? "");

  if (!caption) {
    throw new Error("caption生成に失敗しました");
  }

  return { caption, imageUrl };
}

/** LLM出力の前後のかぎ括弧・引用符を除去し、改行と角括弧挿入を整える */
function sanitizeCaption(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  // 前後の空白を挟んで繰り返し剥がす（「「本文」」や "「本文」" にも対応）
  for (let i = 0; i < 4; i++) {
    const next = text
      .replace(/^[\s「『"'\u201c\u2018]+/u, "")
      .replace(/[\s」』"'\u201d\u2019]+$/u, "")
      .trim();
    if (next === text) break;
    text = next;
  }

  text = normalizeCaption(text);
  text = unwrapCaptionBrackets(text);
  return text.trim();
}

/** [コスメデコルテらしい雰囲気] のような角括弧付き挿入を外す */
function unwrapCaptionBrackets(text: string): string {
  return text.replace(/\[([^\[\]]+)\]/g, "$1");
}

async function main() {
  const { caption, imageUrl } = await generateCaption();

  const result = {
    imageUrl,
    caption: normalizeCaption(caption),
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log("caption生成成功");
  console.log(`postType: ${article.product?.postType ?? ""}`);
  console.log(`genre: ${article.product?.genre ?? ""}`);
  console.log(result.caption);
  console.log("saved:", outputPath);
}

main().catch((err) => {
  console.error("生成エラー:", err);
  process.exit(1);
});
