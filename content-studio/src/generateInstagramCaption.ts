import fs from "node:fs";
import { normalizeCaption } from "./utils/normalizeCaption.ts";
import { buildBeautyTrackUrl, describeUtm } from "./utils/utm.ts";
import {
  logOllamaRuntime,
  resolveOllamaRuntime,
} from "./config/ollamaRuntime.ts";
import {
  buildBeautyInstagramCaption,
  describeBeautyPostPattern,
} from "./templates/beautySocialCopy.ts";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionCopyClean,
} = require("../scripts/lib/beauty-copy-guard.cjs") as {
  assertProductionCopyClean: (texts: unknown, label?: string) => boolean;
};

const inputPath = "input/article.json";
const outputPath = "input/instagram-post.json";

type ArticleInput = {
  title?: string;
  body?: string;
  articleTitle?: string;
  articleBody?: string;
  imageUrl?: string;
  product?: {
    id?: string;
    name?: string;
    brand?: string;
    genre?: string;
    postType?: string;
    imageUrl?: string;
    url?: string;
    blogUrl?: string;
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
    "・Instagramは集客用。購入・広告リンクの直訴求はしない",
    "・「商品ページへ」「今すぐ購入」「公式でチェック」など直リンク誘導の言い回しは使わない",
    "・記事URLやhttpリンクは caption に書かない（末尾はプロフィール誘導に固定する）",
    "・「詳しくはプロフィールのリンクから」につながる自然な一文でよい",
    "・冒頭か2行目までに、具体的な一言を必ず入れる（例: 良い乳液を見つけました／使いやすい化粧下が気になっています）",
    "・商品名（productName）を本文中に必ず1回は書く。ぼかした一般論だけで終わらない",
    "・ブランド名も自然な日本語で1回は触れる（角括弧は禁止）",
    "・caption には、少しだけ「見つけてうれしい」「早めに見ておきたい」気持ちを自然に足してよい",
    "・押し売りや効果効能の断定はしない",
    "・別ジャンルの話には寄せない",
    "・ブランド名は角括弧付き（例: [hince]）で書かない",
    "・基本形: 「ブランド名の〇〇」「〇〇を見つけました」「〇〇が気になっています」",
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

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:4b";
/** 起動確認用。短い時間で落ちる */
const OLLAMA_HEALTH_TIMEOUT_MS = Number(process.env.OLLAMA_HEALTH_TIMEOUT_MS ?? "5000") || 5_000;
/** Ollama失敗時にテンプレcaptionへ落とす（既定ON。止めるなら false） */
const OLLAMA_CAPTION_FALLBACK =
  String(process.env.OLLAMA_CAPTION_FALLBACK ?? "true").toLowerCase() !== "false";

function captionRuntime() {
  return resolveOllamaRuntime();
}

function isAbortError(error: unknown): boolean {
  // Node の AbortSignal.timeout() は name=TimeoutError / message="The operation was aborted due to timeout"
  return (
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = `${error.message} ${("cause" in error && error.cause instanceof Error) ? error.cause.message : ""}`;
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|network/i.test(msg);
}

/** ブログトップ・仮値は不可。個別記事URLのみ可 */
function isUnusableBlogUrl(blogUrl: string): boolean {
  const raw = blogUrl.trim();
  if (!raw) return true;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG/i.test(raw) || /REPLACE-/i.test(raw)) {
    return true;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/";
  } catch {
    return true;
  }
}

/** Ollama が生きているか確認してから generate する */
async function assertOllamaAlive(): Promise<void> {
  const url = `${OLLAMA_BASE_URL}/api/tags`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Ollamaは応答しましたがヘルスチェックに失敗しました (HTTP ${res.status})。` +
          ` URL: ${url}`,
      );
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Ollamaに接続できませんでした（ヘルスチェック ${OLLAMA_HEALTH_TIMEOUT_MS / 1000}秒タイムアウト）。` +
          ` 未起動か、応答が極端に遅い可能性があります。` +
          ` 確認: curl ${OLLAMA_BASE_URL}/api/tags  / 起動例: ollama serve`,
      );
    }
    if (isConnectionError(error)) {
      throw new Error(
        `Ollamaが未起動です（${OLLAMA_BASE_URL} に接続できません）。` +
          ` 起動例: ollama serve  / 確認: curl ${OLLAMA_BASE_URL}/api/tags`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Ollamaの起動確認に失敗しました: ${detail}`);
  }
}

/**
 * 冷起動対策: 本生成前に極短プロンプトでモデルを起こす。
 * 失敗しても本生成へ進む（本生成側の timeout / エラーに任せる）。
 */
async function warmUpOllamaModel(): Promise<boolean> {
  const runtime = captionRuntime();
  if (runtime.skipWarmup) {
    console.log(
      `Ollamaウォームアップスキップ (profile=${runtime.profile} / 朝は first try に時間を使わない)`,
    );
    return false;
  }
  const url = `${OLLAMA_BASE_URL}/api/generate`;
  const warmTimeoutMs = runtime.warmupTimeoutMs;
  try {
    console.log(
      `Ollamaウォームアップ開始 (model=${OLLAMA_MODEL}, timeout=${warmTimeoutMs / 1000}s, profile=${runtime.profile})`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: "OK",
        stream: false,
        keep_alive: "45m",
        options: { num_predict: 8 },
      }),
      signal: AbortSignal.timeout(warmTimeoutMs),
    });
    if (!res.ok) {
      console.warn(`Ollamaウォームアップ失敗 (HTTP ${res.status})。本生成を続行します。`);
      return false;
    }
    console.log("Ollamaウォームアップ完了");
    return true;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`Ollamaウォームアップ失敗 (${detail})。本生成を続行します。`);
    return false;
  }
}

/** genre に合わせた具体フック（乳液・化粧下地など）— Ollama プロンプト用 */
function genreFindHook(genre: string): string {
  switch (genre.trim()) {
    case "スキンケア":
      return "朝晩のスキンケアに取り入れやすそうな乳液を見つけました";
    case "メイク用品":
      return "毎日メイクに合わせやすいベースアイテムが気になっています";
    case "韓国コスメ":
      return "仕上がりの雰囲気がきれいな韓国コスメをチェックしています";
    case "サプリ":
      return "続けやすそうな美容サプリを見ています";
    case "特別ケア":
      return "ご褒美にしたくなるケアアイテムを見つけました";
    default:
      return "使い心地が気になるコスメを見つけました";
  }
}

/** Ollama不通でも投稿を止めない — 美容専用テンプレのみ参照 */
function buildFallbackCaption(params: {
  title: string;
  body: string;
  brand: string;
  productName: string;
  genre: string;
}): string {
  return buildBeautyInstagramCaption({
    brand: params.brand,
    productName: params.productName,
    genre: params.genre,
    title: params.title,
    body: params.body,
    productId: article.product?.id,
  });
}

async function callOllamaGenerate(prompt: string): Promise<string> {
  const runtime = captionRuntime();
  const timeoutMs = runtime.generateTimeoutMs;
  const url = `${OLLAMA_BASE_URL}/api/generate`;
  console.log(
    `Ollama caption生成開始 (model=${OLLAMA_MODEL}, timeout=${timeoutMs / 1000}s, profile=${runtime.profile}, promptChars=${prompt.length})`,
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        keep_alive: "45m",
        options: {
          num_predict: runtime.captionNumPredict,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollamaのcaption生成APIがエラーを返しました (HTTP ${res.status})。` +
          ` model=${OLLAMA_MODEL}` +
          (body ? ` body=${body.slice(0, 300)}` : ""),
      );
    }

    const data = (await res.json()) as { response?: string };
    return data.response ?? "";
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Ollamaのcaption生成がタイムアウトしました（${timeoutMs / 1000}秒）。` +
          ` model=${OLLAMA_MODEL} profile=${runtime.profile}。` +
          ` 朝ランは短時間でフォールバックへ切替します。`,
      );
    }
    if (isConnectionError(error)) {
      throw new Error(
        `Ollamaへの接続が切れました（生成中）。未起動になったか、プロセスが落ちた可能性があります。` +
          ` URL: ${url}`,
      );
    }
    throw error;
  }
}

async function generateCaption() {
  logOllamaRuntime();
  const title = (article.title || article.articleTitle || "").trim();
  const body = (article.body || article.articleBody || "").trim();
  const postType = (article.product?.postType || "").trim();
  const genre = (article.product?.genre || "").trim();
  const productName = (article.product?.name || "").trim();
  const brand = (article.product?.brand || "").trim();
  const imageUrl = article.product?.imageUrl || article.imageUrl || "";
  const rawBlogUrl = (article.product?.blogUrl || "").trim();
  const blogUrlUsable = !isUnusableBlogUrl(rawBlogUrl);
  const blogUrl = blogUrlUsable ? rawBlogUrl : "";

  if (!postType || !genre) {
    throw new Error("product.postType と product.genre が article.json に必要です");
  }
  if (!blogUrlUsable) {
    throw new Error(
      `blogUrl 未整備のため SNS 用 caption 生成を中止します: ${rawBlogUrl || "(空)"}` +
        `（先に Blogger 公開が成功している必要があります）`,
    );
  }

  const toneGuidance = buildToneGuidance(postType, genre, brand, productName);

  const findHook = genreFindHook(genre);
  const prompt = `
あなたは美容BloggerのInstagram運用担当です。
次の商品・記事をもとに、Instagram投稿用のcaption本文を1本だけ作ってください。
Instagramは集客用です。購入・広告リンクはInstagramに直貼りしません。
${blogUrlUsable
  ? "詳しい紹介はブログにあります。ただし caption 本文や末尾にURLは書かないでください。誘導はプロフィールリンク向けにします。"
  : "今回は記事URL未設定でも、caption にURLは書かず、雰囲気紹介のみにする。"}

条件
・ですます調
・やわらかい文体
・短め
・110文字から180文字程度
・ハッシュタグ不要
・本文だけ返す（URLは書かない）
・改行は実際の改行（Enter）だけで書く。バックスラッシュ付きの改行記号（\\n）は絶対に書かない
・誇張しない
・押し売りしない
・商品ページ・公式サイト・購入リンク・広告リンクへの直誘導はしない
・http/https のURL文字列は出力しない
・1行目は具体フックで始める（例: 「${findHook}。」）
・商品名「${productName || "(商品名)"}」を必ず本文に1回書く（一般論だけで終わらない）
・ブランド「${brand || "(ブランド)"}」も自然な日本語で1回触れる
・末尾に「プロフィールのリンクからご覧ください」につながる自然な一文を入れてよい（URLは付けない）
・ブランド名を [ブランド] の形で書かない
・[コスメデコルテらしい雰囲気] のように、文の一部を角括弧で囲まない
・「上質なアイテム」「雰囲気が整う」だけのふわっと表現は禁止。何の商品かが伝わる文にする

${toneGuidance}

商品情報
・商品名: ${productName || "(未設定)"}  ← 必須で言及
・ブランド: ${brand || "(未設定)"}  ← 必須で言及
・postType: ${postType}
・genre: ${genre}
・推奨フック例: ${findHook}

記事タイトル
${title || "(未設定)"}

記事本文
${body || "(未設定)"}
`;

  let caption = "";
  let usedFallback = false;
  try {
    await assertOllamaAlive();
    const runtime = captionRuntime();
    // 朝は skipWarmup。手動のみウォーム失敗時に1回再試行
    if (!runtime.skipWarmup) {
      const warmed = await warmUpOllamaModel();
      if (!warmed) {
        console.warn("Ollamaウォーム再試行...");
        await warmUpOllamaModel();
      }
    } else {
      await warmUpOllamaModel(); // ログのみ（内部で即スキップ）
    }
    const rawCaption = await callOllamaGenerate(prompt);
    caption = sanitizeCaption(rawCaption);
    if (!caption) {
      throw new Error(
        `Ollamaからcaptionが空で返されました (model=${OLLAMA_MODEL})。` +
          ` モデル未取得の可能性: ollama pull ${OLLAMA_MODEL}`,
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!OLLAMA_CAPTION_FALLBACK) throw error;
    usedFallback = true;
    caption = sanitizeCaption(
      buildFallbackCaption({ title, body, brand, productName, genre }),
    );
    console.warn(`Ollama caption失敗のためフォールバックを使用: ${detail}`);
    console.warn(`fallback caption:\n${caption}`);
  }
  if (usedFallback) {
    console.log("captionSource: fallback");
  } else {
    console.log("captionSource: ollama");
  }

  // テスト用: CAPTION_AUTO_FILL_PRODUCT=true のときだけ商品名を自動補完（本番既定OFF）
  if (String(process.env.CAPTION_AUTO_FILL_PRODUCT || "").toLowerCase() === "true") {
    caption = ensureProductMention(caption, { brand, productName, genre });
  }

  const productId = (article.product?.id || "").trim();
  const blogUtmUrl =
    blogUrlUsable && productId
      ? buildBeautyTrackUrl({
          blogUrl,
          productId,
          source: "instagram",
        })
      : "";

  if (blogUrlUsable) {
    console.log("---- Instagram Blogger UTM ----");
    console.log(`productId: ${productId || "-"}`);
    console.log(`channel: instagram`);
    console.log(`生成前URL: ${blogUrl}`);
    console.log(`生成後URL: ${blogUtmUrl || "(なし)"}`);
    console.log(`付与utm: ${JSON.stringify(describeUtm(blogUtmUrl))}`);
    // 既定: caption にはURLを入れない（プロフィール誘導）。必要ならフラグで末尾追加。
    if ((process.env.INSTAGRAM_CAPTION_BLOG_UTM || "").trim().toLowerCase() === "true") {
      console.log("INSTAGRAM_CAPTION_BLOG_UTM=true → caption 末尾に UTM URL を追加");
    } else {
      console.log("blogUrl/blogUtmUrl は保持のみ（caption にはURLなし）");
    }
  }

  caption = normalizeCaption(appendProfileLead(caption));
  if (
    blogUtmUrl &&
    (process.env.INSTAGRAM_CAPTION_BLOG_UTM || "").trim().toLowerCase() === "true"
  ) {
    caption = normalizeCaption(`${caption}\n${blogUtmUrl}`);
  }

  return { caption, imageUrl, blogUrl, blogUrlUsable, blogUtmUrl, productId };
}

/** caption に商品名/ブランドが無ければ先頭へ補う */
function ensureProductMention(
  caption: string,
  params: { brand: string; productName: string; genre: string },
): string {
  const text = (caption || "").trim();
  const brand = params.brand.trim();
  const name = params.productName.trim();
  const hasName = name ? text.includes(name) : true;
  const hasBrand = brand ? text.includes(brand) : true;
  if (hasName && hasBrand) return text;

  const hook = genreFindHook(params.genre);
  const productBit = name
    ? brand && !name.includes(brand)
      ? `${brand}の「${name}」`
      : `「${name}」`
    : brand
      ? `${brand}のアイテム`
      : "";
  if (!productBit) return text;
  const lead = buildBeautyInstagramCaption({
    brand,
    productName: name,
    genre: params.genre,
    productId: article.product?.id,
  })
    .split("\n")[0]
    ?.replace(/。$/, "") || `${productBit}`;
  console.warn(`caption に商品名が不足していたため補完: ${productBit}`);
  return `${lead}。\n${text}`.trim();
}

/** Instagram末尾はURLなしのプロフィール誘導に統一する */
function appendProfileLead(caption: string): string {
  const base = caption
    .trim()
    // LLMが付けたURL行を除去
    .replace(/\n*https?:\/\/\S+/gi, "")
    .replace(/\n*詳しくはブログ記事で紹介しています\s*$/u, "")
    .trim();
  const profileLine = "詳しくは、プロフィールのリンクからご覧ください";
  if (base.includes("プロフィールのリンク")) return base;
  return `${base}\n\n${profileLine}`;
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
  const { caption, imageUrl, blogUrl, blogUrlUsable, blogUtmUrl } = await generateCaption();
  const finalCaption = normalizeCaption(caption);
  try {
    assertProductionCopyClean(
      [finalCaption, article.title || "", article.product?.name || ""],
      "instagram-caption",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(3);
  }

  const patternInfo = describeBeautyPostPattern({
    brand: article.product?.brand || "",
    productName: article.product?.name || "",
    genre: article.product?.genre || "",
    productId: article.product?.id,
  });

  const result = {
    imageUrl,
    caption: finalCaption,
    blogUrl: blogUrlUsable ? blogUrl : "",
    blogUtmUrl: blogUrlUsable ? blogUtmUrl || "" : "",
    postPattern: patternInfo.id,
    postPatternLabel: patternInfo.label,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log("caption生成成功");
  console.log(
    blogUrlUsable
      ? `投稿モード: IGプロフィール誘導 / blogUrl保持=${blogUrl}`
      : "投稿モード: IGプロフィール誘導 / blogUrl未整備",
  );
  console.log(`postPattern: ${patternInfo.id} (${patternInfo.label})`);
  console.log(`postType: ${article.product?.postType ?? ""}`);
  console.log(`genre: ${article.product?.genre ?? ""}`);
  console.log(result.caption);
  console.log("saved:", outputPath);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("生成エラー:", msg);
  process.exit(1);
});
