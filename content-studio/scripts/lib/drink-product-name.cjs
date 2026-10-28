/**
 * 楽天 itemName のSEO長文を、SNS向けの短い表示名に整形する。
 *
 *   const { cleanDrinkProductName } = require("./drink-product-name.cjs");
 *   cleanDrinkProductName("【MAX38%OFF】トラベルポーチ 吊り下げ …");
 *   // → "トラベルポーチ 吊り下げ"
 */
const DEFAULT_MAX = 28;

const PROMO_PHRASES = [
  /楽天(?:総合|ランキング)?\d*位/gi,
  /(?:総合|部門)\d+位/g,
  /MAX\s*\d+\s*%\s*OFF/gi,
  /\d+\s*%\s*OFF/gi,
  /圧倒的レビュー数\s*[&＆]?\s*高評価/g,
  /全店限定価格/g,
  /メーカー希望小売価格[^\s]*/g,
  /送料無料/g,
  /即日発送/g,
  /あす楽対応?/g,
  /レビュー特典[^\s　]*/g,
  /ヒルナンデス[!！]?で紹介/g,
  /インスタ(?:グラム)?で話題/g,
  /SNSで話題/g,
  /訳あり福袋\d*/g,
  /B級アウトレット/g,
  /旧品のため[^\s　]*/g,
  /箱汚れはご容赦[^\s　]*/g,
  /お一人様\d*回限り/g,
  /初回購入者様限定/g,
  /期間限定/g,
  /数量限定/g,
  /新生活応援/g,
  /ギフト対応/g,
  /ラッピング対応/g,
  /\d+件レビュー突破[!！]?/g,
  /レビュー突破[!！]?/g,
  /早く買えば良かった[!！]?/g,
];

/** 商品らしさのヒント（優先して残す語） */
const PRODUCT_HINT =
  /充電器|モバイルバッテリー|ケーブル|アダプタ|アダプター|スタンド|ホルダー|ケース|ポーチ|クリップ|トレー|トレイ|ハブ|ドック|イヤホン|ヘッドホン|スピーカー|DAC|MagSafe|マグネット|アーム|マット|リング|ストラップ|ガジェット|セット/;

function stripDecor(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    // ＼宣伝／【宣伝】［宣伝］（宣伝）を落とす
    .replace(/＼[^／]{0,40}／/g, " ")
    .replace(/[【\[][^】\]]{0,40}[】\]]/g, " ")
    .replace(/（[^）]{0,40}）/g, " ")
    .replace(/\([^)]{0,40}\)/g, " ")
    // 装飾記号
    .replace(/[★☆※◎○●◇◆■□▲△▼▽♪♫！!♪～〜…・\/／|｜]+/g, " ")
    .replace(/[＼／]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPromoPhrases(s) {
  let out = s;
  for (const re of PROMO_PHRASES) {
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * 空白区切りトークンから、短く意味のある表示名を組み立てる。
 */
function pickMeaningfulName(cleaned, maxLen) {
  const tokens = cleaned
    .split(/[\s　,，、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    // 記号だけ・数字だけのトークンは除外
    .filter((t) => !/^[\d.]+$/.test(t))
    .filter((t) => !/^(and|or|the|set|ver|type)$/i.test(t));

  if (!tokens.length) return "";

  // ヒント語を含むトークンを起点に前後を取る
  const hintIdx = tokens.findIndex((t) => PRODUCT_HINT.test(t));
  let ordered;
  if (hintIdx >= 0) {
    const start = Math.max(0, hintIdx - 1);
    ordered = tokens.slice(start);
  } else {
    ordered = tokens;
  }

  let out = "";
  for (const t of ordered) {
    const next = out ? `${out} ${t}` : t;
    if (next.length > maxLen) break;
    out = next;
    // ヒント語を含んで十分短く取れたら止める
    if (PRODUCT_HINT.test(out) && out.length >= 8) break;
    if (out.length >= Math.min(maxLen, 18) && ordered.indexOf(t) - (hintIdx >= 0 ? Math.max(0, hintIdx - 1) : 0) >= 2) {
      break;
    }
  }

  if (!out) out = tokens[0];
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1)}…`;
  return out.trim();
}

/**
 * @param {string} raw
 * @param {{ maxLen?: number }} [opts]
 * @returns {string}
 */
function cleanDrinkProductName(raw, opts = {}) {
  const maxLen = Math.max(8, Number(opts.maxLen) || DEFAULT_MAX);
  const original = String(raw || "").trim();
  if (!original) return "";

  let s = stripDecor(original);
  s = stripPromoPhrases(s);
  // 連続スペース
  s = s.replace(/\s+/g, " ").trim();

  if (!s) {
    // 全部落ちた場合は元から括弧だけ外して切る
    s = stripDecor(original).slice(0, maxLen);
  }

  const picked = pickMeaningfulName(s, maxLen);
  const result = (picked || s).trim();
  if (!result) return original.slice(0, maxLen);
  return result.length > maxLen ? `${result.slice(0, maxLen - 1)}…` : result;
}

/**
 * catchcopy / caption から SNS 用の短い根拠文を作る
 */
function cleanDrinkSnippet(raw, maxLen = 40) {
  let s = stripDecor(String(raw || ""));
  s = stripPromoPhrases(s);
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

module.exports = {
  cleanDrinkProductName,
  cleanDrinkSnippet,
  stripDecor,
  DEFAULT_MAX,
};
