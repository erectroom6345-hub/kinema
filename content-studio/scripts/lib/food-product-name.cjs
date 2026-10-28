/**
 * 楽天 itemName のSEO長文を、SNS向けの短い表示名に整形する。
 *
 *   const { cleanFoodProductName } = require("./food-product-name.cjs");
 *   cleanFoodProductName("【MAX38%OFF】トラベルポーチ 吊り下げ …");
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

/** 商品らしさのヒント（優先して残す語）。部分一致で誤爆しやすい短語は避ける */
const PRODUCT_HINT =
  /炭火焼|焼き鳥|カレー|味噌汁|缶詰|レトルト|フリーズドライ|乾麺|そうめん|うどん|パスタ|パン|ご飯|ごはん|米|スープ|煮込|惣菜|おかず|漬物|調味料|チーズ|ケーキ|チョコ|スイーツ|饅頭|羊羹|ようかん|クッキー|ナッツ|フルーツ|野菜|肉|魚|水|飲料|セット/;

/** SEO末尾に付く備蓄タグ（表示名の起点にしない） */
const SEO_TAG_ONLY =
  /^(?:保存食|備蓄|非常食|防災食|ローリングストック|日持ち|常温保存|長期保存|保存用|お取り寄せ|九州グルメ|送料無料)$/;

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

  // SEO末尾タグだけを起点にしない（鶏の炭火焼き…防災食 ローリングストック 対策）
  const usable = tokens.filter((t) => !SEO_TAG_ONLY.test(t));
  const pool = usable.length ? usable : tokens;

  // ヒント語を含むトークンを起点に前後を取る
  const hintIdx = pool.findIndex((t) => PRODUCT_HINT.test(t));
  let ordered;
  if (hintIdx >= 0) {
    const start = Math.max(0, hintIdx - 1);
    ordered = pool.slice(start);
  } else {
    ordered = pool;
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
function cleanFoodProductName(raw, opts = {}) {
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
function cleanFoodSnippet(raw, maxLen = 40) {
  let s = stripDecor(String(raw || ""));
  s = stripPromoPhrases(s);
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

module.exports = {
  cleanFoodProductName,
  cleanFoodSnippet,
  stripDecor,
  DEFAULT_MAX,
};
