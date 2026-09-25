import type { ArticleJobResult, ImageBundle, SnsOutputs } from "../types/index.ts";

export function getPublicBodyText(result: ArticleJobResult): string {
  return (result.blog_draft.public_body || result.blog_draft.body_markdown || "").trim() + "\n";
}

export function formatImageMetadataJson(images: ImageBundle): string {
  const payload = {
    hero: {
      url: images.hero.url || "",
      credit: images.hero.credit || "",
      alt: images.hero.alt || "",
      source: images.hero.source,
      pageUrl: images.hero.pageUrl || "",
    },
    inline: images.inline.map((image) => ({
      url: image.url || "",
      credit: image.credit || "",
      alt: image.alt || "",
      source: image.source,
      pageUrl: image.pageUrl || "",
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** SNS下書き専用（公開本文の削除ルールは適用しない） */
export function formatSocialDraftsMarkdown(outputs: SnsOutputs, topic = ""): string {
  const hashtags = collectHashtags(outputs, topic);
  const threadsBlock = (outputs.threads.length ? outputs.threads : ["（下書きなし）"])
    .map((item, index) => `案${index + 1}\n${item.trim()}`)
    .join("\n\n");
  const xBlock = (outputs.x.length ? outputs.x : ["（下書きなし）"])
    .map((item, index) => `${index + 1}本目\n${item.trim()}`)
    .join("\n\n");

  return `SNS下書き

Instagram

${(outputs.instagram.caption || "（下書きなし）").trim()}

Threads

${threadsBlock}

X

${xBlock}

ハッシュタグ候補

${hashtags.length ? hashtags.map((tag) => `- ${tag}`).join("\n") : "- （なし）"}
`;
}

export function findMissingSocialDrafts(outputs: SnsOutputs): string[] {
  const missing: string[] = [];
  if (!outputs.instagram.caption?.trim()) missing.push("Instagram");
  if (!outputs.threads.length || !outputs.threads.some((item) => item.trim())) missing.push("Threads");
  if (!outputs.x.length || !outputs.x.some((item) => item.trim())) missing.push("X");
  return missing;
}

/** ターミナル用の短いプレビュー（公開本文） */
export function formatPublicPreview(result: ArticleJobResult): string {
  const body = getPublicBodyText(result).trim();
  const lines = body.split("\n").map((line) => line.trimEnd());
  const title = lines.find((line) => line.trim())?.trim() || result.blog_draft.title || "(タイトルなし)";

  const introIdx = lines.findIndex((line) => line.trim() === "はじめに");
  const introLines: string[] = [];
  if (introIdx >= 0) {
    for (let i = introIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (introLines.length >= 2) break;
        continue;
      }
      if (isLikelyHeading(line)) break;
      introLines.push(line);
      if (introLines.length >= 4) break;
    }
  }

  const bits = [`タイトル: ${title}`];
  if (introLines.length) {
    bits.push("はじめに:");
    bits.push(...introLines.map((line) => `  ${truncate(line, 80)}`));
  } else {
    const firstPara = lines.find((line, idx) => idx > 0 && line.trim() && !isLikelyHeading(line.trim()));
    if (firstPara) bits.push(`冒頭: ${truncate(firstPara.trim(), 80)}`);
  }
  return bits.join("\n");
}

/** ターミナル用の短いプレビュー（SNS）※公開用整形は適用しない */
export function formatSocialPreview(outputs: SnsOutputs): string {
  const ig = outputs.instagram.caption?.trim() || "(未生成)";
  const th = outputs.threads.find((item) => item.trim())?.trim() || "(未生成)";
  const x = outputs.x.find((item) => item.trim())?.trim() || "(未生成)";

  return [
    "Instagram",
    `  ${truncate(firstLine(ig), 90)}`,
    "Threads",
    `  ${truncate(firstLine(th), 90)}`,
    "X",
    `  ${truncate(firstLine(x), 90)}`,
  ].join("\n");
}

function firstLine(value: string): string {
  return value.split("\n").map((line) => line.trim()).find(Boolean) || value;
}

function truncate(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function isLikelyHeading(line: string): boolean {
  return [
    "はじめに",
    "よくあるつまずき",
    "考え方の整理",
    "今日からできること",
    "まとめ",
    "どんな人に向きやすいか",
    "見るべきポイント",
    "使い方のヒント",
  ].includes(line);
}

function collectHashtags(outputs: SnsOutputs, topic: string): string[] {
  const found = new Set<string>();
  const texts = [outputs.instagram.caption, ...outputs.threads, ...outputs.x];
  for (const text of texts) {
    for (const match of text.matchAll(/#[\p{Letter}\p{Number}_]+/gu)) {
      found.add(match[0]);
    }
  }
  if (found.size === 0 && topic.trim()) {
    const slug = topic.replace(/\s+/g, "");
    if (slug) found.add(`#${slug}`);
    found.add("#整理ノート");
  }
  return [...found];
}

export function toMarkdownPreview(result: ArticleJobResult): string {
  const { input_summary: input, analysis } = result;
  return `[内部レポート]

[内部] 入力サマリー
- ブログ: ${input.blog_name}
- テーマ: ${input.topic}
- ジャンル: ${input.genre}
- PR: ${input.is_pr ? "あり" : "なし"}

[内部] 解析メモ
- 商品紹介向き: ${analysis.is_product_oriented ? "はい" : "いいえ"}
- 判定理由: ${analysis.reason}

公開本文・画像・SNSはそれぞれ別ファイルを参照してください。
`;
}

/** 実行日時ベースのファイル接頭辞（例: 2026-09-20-0900） */
export function formatRunStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}-${hh}${mm}`;
}

function formatDisplayDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/** コピペ用 Instagram 本文（本文のみ） */
export function formatInstagramBodyText(outputs: SnsOutputs): string {
  return `${(outputs.instagram.caption || "").trim()}\n`;
}

/** コピペ用 Threads 本文（案ごとに空行区切り・ラベルなし） */
export function formatThreadsBodyText(outputs: SnsOutputs): string {
  const items = outputs.threads.map((item) => item.trim()).filter(Boolean);
  return `${items.join("\n\n")}\n`;
}

/** コピペ用 X 本文（投稿ごとに空行区切り・ラベルなし） */
export function formatXBodyText(outputs: SnsOutputs): string {
  const items = outputs.x.map((item) => item.trim()).filter(Boolean);
  return `${items.join("\n\n")}\n`;
}

export interface PlannedImageRef {
  role: string;
  fileName: string;
  path: string;
  sourceUrl: string;
}

/** 画像本体は保存せず、将来ダウンロード用の予定ファイル名・パスだけ作る */
export function buildPlannedImageRefs(
  images: ImageBundle,
  outDir: string,
  runStamp: string,
): PlannedImageRef[] {
  const refs: PlannedImageRef[] = [];
  if (images.hero.url) {
    const ext = extensionFromUrl(images.hero.url);
    const fileName = `${runStamp}-hero${ext}`;
    refs.push({
      role: "hero",
      fileName,
      path: resolvePath(outDir, fileName),
      sourceUrl: images.hero.url,
    });
  }
  images.inline.forEach((image, index) => {
    if (!image.url) return;
    const ext = extensionFromUrl(image.url);
    const fileName = `${runStamp}-inline-${index + 1}${ext}`;
    refs.push({
      role: `inline-${index + 1}`,
      fileName,
      path: resolvePath(outDir, fileName),
      sourceUrl: image.url,
    });
  });
  return refs;
}

export function formatPostingSummaryMarkdown(params: {
  result: ArticleJobResult;
  generatedAt: Date;
  savedFileNames: string[];
  plannedImages: PlannedImageRef[];
  instagramImage?: {
    mode: "product" | "fixed";
    fileName: string;
    path: string;
    reason: string;
  };
}): string {
  const { result, generatedAt, savedFileNames, plannedImages } = params;
  const igImage = params.instagramImage;
  const title = result.blog_draft.title || result.input_summary.topic || "(タイトルなし)";
  const ig = formatInstagramBodyText(result.outputs).trim() || "（下書きなし）";
  const threads = formatThreadsBodyText(result.outputs).trim() || "（下書きなし）";
  const x = formatXBodyText(result.outputs).trim() || "（下書きなし）";
  const fileList = savedFileNames.length
    ? savedFileNames.map((name) => `- ${name}`).join("\n")
    : "- （なし）";
  const imageNames = plannedImages.length
    ? plannedImages.map((ref) => `- ${ref.fileName}`).join("\n")
    : "- （なし）";
  const imagePaths = plannedImages.length
    ? plannedImages.map((ref) => `- ${ref.path}`).join("\n")
    : "- （なし）";
  const mode = igImage?.mode || "fixed";
  const usedName = igImage?.fileName?.trim() || "（未設定）";
  const usedPath = igImage?.path?.trim() || "（未設定）";
  const reason = igImage?.reason?.trim() || "fallback to fixed image";

  return `# 投稿まとめ

## 生成日時

${formatDisplayDateTime(generatedAt)}

## ブログタイトル

${title}

## public preview

\`\`\`
${formatPublicPreview(result)}
\`\`\`

## Instagram本文

${ig}

## Threads本文

${threads}

## X本文

${x}

## Instagram画像モード

${mode}

## Instagram使用画像ファイル名

${usedName}

## Instagram画像判定理由

${reason}

## Instagram使用画像パス

${usedPath}

## 保存ファイル名一覧

${fileList}

## 使用予定の画像ファイル名

${imageNames}

## 使用予定の画像パス

${imagePaths}
`;
}

export interface InstagramFixedImageRef {
  fileName: string;
  path: string;
}

/** .env の INSTAGRAM_FIXED_IMAGE から固定画像の名前と絶対パスを作る（画像自体はコピーしない） */
export function resolveInstagramFixedImage(
  configuredPath: string,
  cwd = process.cwd(),
): InstagramFixedImageRef {
  const raw = configuredPath.trim() || "assets/instagram-fixed.jpg";
  const absolute = resolveFsPath(cwd, raw);
  const parts = absolute.split(/[/\\]/).filter(Boolean);
  const fileName = parts[parts.length - 1] || "instagram-fixed.jpg";
  return { fileName, path: absolute };
}

function resolveFsPath(cwd: string, value: string): string {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return value;
  const base = cwd.replace(/\/+$/, "");
  return `${base}/${value.replace(/^\/+/, "")}`;
}

function extensionFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    const match = name.match(/(\.[a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // ignore
  }
  return ".jpg";
}

function resolvePath(outDir: string, fileName: string): string {
  const base = outDir.replace(/\/+$/, "");
  return `${base}/${fileName}`;
}
