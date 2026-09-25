/**
 * caption 本文に残った「\n」「\r\n」などの見た目文字列を、
 * 実際の改行文字へ必ず変換する（共通・最終ゲート）。
 */
export function normalizeCaption(text: string): string {
  let t = String(text ?? "");

  for (let pass = 0; pass < 8; pass++) {
    let out = "";
    let changed = false;

    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      const n1 = t[i + 1];
      const n2 = t[i + 2];
      const n3 = t[i + 3];

      // \r\n（バックスラッシュ + r + バックスラッシュ + n）
      if (ch === "\\" && n1 === "r" && n2 === "\\" && n3 === "n") {
        out += "\n";
        i += 3;
        changed = true;
        continue;
      }

      // \n
      if (ch === "\\" && n1 === "n") {
        out += "\n";
        i += 1;
        changed = true;
        continue;
      }

      // \r
      if (ch === "\\" && n1 === "r") {
        out += "\n";
        i += 1;
        changed = true;
        continue;
      }

      // 実改行の直前に余ったバックスラッシュ
      if (ch === "\\" && n1 === "\n") {
        out += "\n";
        i += 1;
        changed = true;
        continue;
      }

      out += ch;
    }

    t = out;
    if (!changed) break;
  }

  return t;
}
