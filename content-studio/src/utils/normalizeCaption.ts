/**
 * caption 本文に残った「\n」「\r\n」などの見た目文字列を、
 * 実際の改行文字へ必ず変換する（共通・最終ゲート）。
 *
 * LLM や二重エスケープで `\\n` / `\\\\n` が残っても、
 * Instagram Graph API へ渡す前に実改行へ落とす。
 */
export function normalizeCaption(text: string): string {
  let t = String(text ?? "");

  for (let pass = 0; pass < 8; pass++) {
    const before = t;
    t = t
      // 二重以上のエスケープも順に剥がす
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      // 実改行直前の余剰バックスラッシュ
      .replace(/\\\r?\n/g, "\n")
      // 全角バックスラッシュ + n
      .replace(/\uFF3Cn/gi, "\n")
      .replace(/\uFF3Cr\uFF3Cn/gi, "\n");
    if (t === before) break;
  }

  // 実改行の正規化
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return t;
}

/** 投稿APIへ渡す直前の検証用。リテラル \n が残っていれば true */
export function hasLiteralNewlineEscape(text: string): boolean {
  return /\\n|\\r|\uFF3Cn/i.test(String(text ?? ""));
}
