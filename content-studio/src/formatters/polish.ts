/** 公開用本文向けの後処理（抽出優先・内部ラベルのみ除去・本文は削らない） */
export function polishBlogMarkdown(markdown: string): string {
  return buildPublicBody(markdown);
}

const KNOWN_HEADINGS = new Set([
  "はじめに",
  "よくあるつまずき",
  "考え方の整理",
  "今日からできること",
  "まとめ",
  "どんな人に向きやすいか",
  "見るべきポイント",
  "使い方のヒント",
]);

/** 公開用本文専用文字列を作る */
export function buildPublicBody(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  const ranged = extractPublicRange(text);
  // 常に弱い削除ルールのみ（日本語段落は残す）
  let cleaned = cleanWithinRange(ranged);

  if (!hasArticleStructure(cleaned)) {
    const broader = cleanWithinRange(extractArticleLikeRange(text));
    if (countContentChars(broader) >= countContentChars(cleaned)) {
      cleaned = broader;
    }
  }

  return collapseBlankLines(cleaned).trim() + "\n";
}

function hasArticleStructure(value: string): boolean {
  return /はじめに/.test(value) && /まとめ/.test(value);
}

function extractPublicRange(text: string): string {
  const startRe = /(?:\[?\s*公開本文のみ\s*(?:\/\s*)?開始\s*\]?|-----?\s*公開用本文\s*-----?)/;
  const endRe =
    /(?:\[?\s*公開本文のみ\s*(?:\/\s*)?終了\s*\]?|公開用本文ここまで|-----?\s*公開用本文ここまで\s*-----?)/;

  const startMatch = startRe.exec(text);
  if (startMatch) {
    const from = startMatch.index + startMatch[0].length;
    const rest = text.slice(from);
    const endMatch = endRe.exec(rest);
    if (endMatch) return rest.slice(0, endMatch.index);
    return rest;
  }

  return extractArticleLikeRange(text);
}

function extractArticleLikeRange(text: string): string {
  const lines = text.split("\n");
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = stripHeadingMarks(lines[i].trim());
    if (!line || isBoundaryOrInternalLabel(line) || isHardMetaLine(line) || isSnsSectionLabel(line)) continue;
    if (KNOWN_HEADINGS.has(line) || looksLikeTitleOrHeading(line) || hasJapaneseParagraph(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) start = 0;

  let summaryIdx = -1;
  for (let i = start; i < lines.length; i++) {
    if (stripHeadingMarks(lines[i].trim()) === "まとめ") {
      summaryIdx = i;
      break;
    }
  }

  let end = lines.length;
  const scanFrom = summaryIdx >= 0 ? summaryIdx + 1 : start;
  for (let j = scanFrom; j < lines.length; j++) {
    const next = stripHeadingMarks(lines[j].trim());
    if (!next) continue;
    // まとめ前の Instagram 等はノイズとして後で落とす。終端判定はまとめ後（またはまとめ無し時）のみ
    if (summaryIdx >= 0) {
      if (isBoundaryOrInternalLabel(next) || isHardMetaLine(next) || isSnsSectionLabel(next)) {
        end = j;
        break;
      }
      end = j + 1;
    } else if (isSnsSectionLabel(next) || (isBoundaryOrInternalLabel(next) && /終了|ここまで|画像メタ/i.test(next))) {
      end = j;
      break;
    }
  }

  if (summaryIdx >= 0) {
    end = Math.max(end, summaryIdx + 1);
  }

  return lines.slice(start, end).join("\n");
}

function cleanWithinRange(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trimEnd().trim();
    if (!line) {
      kept.push("");
      continue;
    }

    line = stripHeadingMarks(line);
    if (isBoundaryOrInternalLabel(line)) continue;

    // 日本語の通常段落はスクリプト掃除のみ（削除しない）
    if (hasJapaneseParagraph(line) && !isHardMetaLine(line)) {
      const cleaned = sanitizeScripts(line);
      if (cleaned) kept.push(stripInlineMarkdown(cleaned));
      continue;
    }

    if (KNOWN_HEADINGS.has(line) || looksLikeTitleOrHeading(line)) {
      kept.push(line);
      continue;
    }

    line = sanitizeScripts(line);
    if (!line) continue;
    if (shouldDropLine(line)) continue;

    const list = line.match(/^([*-]|\d+[.)])\s+(.+)$/);
    if (list) {
      const body = sanitizeScripts(list[2].trim());
      if (!body) continue;
      if (hasJapaneseParagraph(body)) {
        kept.push(stripInlineMarkdown(body));
        continue;
      }
      if (body.length <= 12 || /^(pixabay|source|reference)\b/i.test(body)) continue;
      kept.push(stripInlineMarkdown(body));
      continue;
    }

    kept.push(stripInlineMarkdown(line));
  }

  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join("\n");
}

function countContentChars(value: string): number {
  return value.replace(/\s+/g, "").length;
}

function stripHeadingMarks(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function stripInlineNoise(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\*?Image by [^*\n]+from Pixabay\*?/gi, "")
    .replace(/from Pixabay/gi, "");
}

export function sanitizeScripts(line: string): string {
  let value = stripInlineNoise(line)
    .replace(/\p{Script=Arabic}+/gu, "")
    .replace(/\p{Script=Cyrillic}+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (hasJapanese(value)) {
    value = stripStandaloneNoiseLatin(value);
  }

  return value.replace(/[ \t]{2,}/g, " ").replace(/^[、．\s]+/g, "").trim();
}

function hasJapanese(value: string): boolean {
  return /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(value);
}

/** 見出しではなく本文として残すべき日本語行 */
function hasJapaneseParagraph(line: string): boolean {
  if (!hasJapanese(line)) return false;
  if (isBoundaryOrInternalLabel(line)) return false;
  if (isHardMetaLine(line)) return false;
  if (/^(挿入画像|アイキャッチ|画像)$/u.test(line)) return false;
  if (/^\d+本目$/u.test(line)) return false;
  if (/^案\d+$/u.test(line)) return false;
  if (/^Day\s*\d+/i.test(line)) return false;
  return true;
}

function looksLikeTitleOrHeading(line: string): boolean {
  if (KNOWN_HEADINGS.has(line)) return true;
  if (!hasJapanese(line)) return false;
  if (line.length > 40) return false;
  if (/[。．！？]$/.test(line)) return false;
  if (/^(挿入画像|アイキャッチ|画像)$/u.test(line)) return false;
  if (/^\d+本目$/u.test(line)) return false;
  if (/^案\d+$/u.test(line)) return false;
  if (/^Day\s*\d+/i.test(line)) return false;
  return true;
}

function stripStandaloneNoiseLatin(line: string): string {
  return line.replace(
    /(^|[^\p{Script=Latin}0-9+])([A-Za-z][A-Za-z']{0,11})(?=$|[^\p{Script=Latin}0-9+])/gu,
    (full, left, word) => {
      if (isAllowedProductToken(word)) return full;
      if (/[A-Z]/.test(word) && word.length >= 2) return full;
      if (/^[a-z]+$/.test(word)) return left;
      return full;
    },
  );
}

function isAllowedProductToken(word: string): boolean {
  if (/\d/.test(word)) return true;
  if (/^(SPF|PA|UV|UVA|UVB|AHA|BHA|PHA|CICA|NMN|CBD|DNA|RNA|PR)$/i.test(word)) return true;
  if (/^[A-Z]{2,8}$/.test(word)) return true;
  if (/^[A-Za-z]+\d+[A-Za-z0-9+]*$/.test(word)) return true;
  return false;
}

function lettersOnly(value: string): string {
  return value.replace(/[^\p{L}]/gu, "");
}

function isArabicOnlyFragment(line: string): boolean {
  const letters = lettersOnly(line);
  if (!letters || letters.length > 48) return false;
  return /^\p{Script=Arabic}+$/u.test(letters);
}

function isCyrillicOnlyFragment(line: string): boolean {
  const letters = lettersOnly(line);
  if (!letters || letters.length > 48) return false;
  return /^\p{Script=Cyrillic}+$/u.test(letters);
}

const INTERNAL_LABELS = [
  "プレビュー",
  "入力サマリー",
  "解析",
  "公開用本文",
  "公開本文のみ",
  "公開用本文ここまで",
  "画像メタデータ",
  "本文外",
  "内部",
  "内部レポート",
  "開始",
  "終了",
  "Instagram",
  "Threads",
  "タイトル案",
  "画像キーワード",
  "理由",
  "ブログ下書き",
  "source",
  "reference",
  "Source",
  "Reference",
] as const;

function normalizeLabelLine(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^[-—=_\s]+/, "")
    .replace(/[-—=_\s]+$/, "")
    .replace(/[（）()【】]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .trim();
}

function isBoundaryOrInternalLabel(line: string): boolean {
  const core = normalizeLabelLine(line);
  if (!core) return false;

  if (/公開用本文ここまで|公開本文のみ|画像メタデータ|本文外|内部レポート/.test(core)) return true;
  if (/^(開始|終了)$/.test(core)) return true;

  for (const label of INTERNAL_LABELS) {
    if (core === label || core.toLowerCase() === label.toLowerCase()) return true;
    // 短い語（理由・解析・内部）は完全一致のみ。誤爆で本文を消さない
    if (label.length >= 5 && core.startsWith(label) && core.length <= label.length + 16) return true;
  }
  return false;
}

function isSnsSectionLabel(line: string): boolean {
  const core = normalizeLabelLine(line);
  return /^(Instagram|Threads|X|SNS下書き|SNS)/i.test(core);
}

function isHardMetaLine(line: string): boolean {
  if (/https?:\/\//i.test(line)) return true;
  if (/Image by/i.test(line)) return true;
  if (/from Pixabay/i.test(line)) return true;
  if (/pixabay\.com/i.test(line)) return true;
  if (/^!\[[^\]]*\]/.test(line)) return true;
  if (/^[-*]\s*(pixabay|hero|inline|asp|source|reference)\s*:/i.test(line)) return true;
  return false;
}

function shouldDropLine(line: string): boolean {
  if (isHardMetaLine(line)) return true;
  if (isBoundaryOrInternalLabel(line)) return true;
  if (/^(挿入画像|アイキャッチ|画像)([:：\s].*)?$/u.test(line)) return true;
  if (/^Day\s*\d+\b/i.test(line)) return true;
  if (/^\d+本目$/u.test(line)) return true;
  if (/^案\d+$/u.test(line)) return true;
  if (/^(\*|-)\s*$/.test(line)) return true;
  if (isArabicOnlyFragment(line)) return true;
  if (isCyrillicOnlyFragment(line)) return true;
  if (isEnglishOnlyNoise(line)) return true;
  if (hasJapanese(line)) return false;
  return false;
}

function isEnglishOnlyNoise(line: string): boolean {
  if (hasJapanese(line)) return false;
  if (/^※/.test(line)) return false;
  const compact = line.replace(/\s+/g, "");
  if (isAllowedProductToken(compact)) return false;
  if (/^(SPF|PA)\s*\d*/i.test(line)) return false;
  if (/\d/.test(line) && /^[A-Za-z0-9+\s\-]+$/.test(line)) return false;

  const letters = lettersOnly(line);
  if (!letters) return false;
  if (!/^\p{Script=Latin}+$/u.test(letters)) return false;

  if (/^(tempted|todo|note|draft|debug|null|undefined|n\/a|ok|yes|no)$/i.test(line.trim())) return true;
  if (letters.length <= 24 && /^[A-Za-z][A-Za-z0-9 _\-']{0,30}$/.test(line.trim())) return true;
  return false;
}

function collapseBlankLines(value: string): string {
  return value.replace(/\n{3,}/g, "\n\n");
}

export function publicBodyToHtml(body: string, outline: string[] = []): string {
  const headingSet = new Set(outline.map((item) => item.trim()).filter(Boolean));
  const defaultHeadings = new Set(KNOWN_HEADINGS);

  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let sawTitle = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (!sawTitle) {
      html.push(`<h1>${escapeHtml(line)}</h1>`);
      sawTitle = true;
      continue;
    }

    if (headingSet.has(line) || defaultHeadings.has(line)) {
      html.push(`<h2>${escapeHtml(line)}</h2>`);
      continue;
    }

    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  return html.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
