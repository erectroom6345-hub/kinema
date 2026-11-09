/**
 * 商品説明・SNS根拠行用。楽天SEOノイズを落とし、
 * 「体感＋誰向け」が残る短い文にする。
 */

const NOISE_RE =
  /ポイント\d+倍|送料無料|あす楽|即日発送|楽天総合ランキング|楽天\s*ランキング|ランキング\d*位|\d+位|適格請求書|インボイス|メーカー希望小売|関連キーワード|法事|仏事|還暦|帰省|感謝箱|化粧箱入り|ギフト包装|のし対応|のし紙|包装無料|業務用|卸売|税込|送料|クーポン|タイムセール|スーパーセール|お買い物マラソン/gi;

const KEYWORD_SOUP_RE =
  /^(?:[A-Za-z0-9\-_.]+|\d+w|\d+W|usb-?c|usb-?a|pd|gan|type-?c)(?:\s+(?:[A-Za-z0-9\-_.]+|\d+w|\d+W|usb-?c|usb-?a|pd|gan|type-?c)){4,}/i;

function scrubMerchantNoise(raw) {
  let s = String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(NOISE_RE, " ")
    .replace(/[|｜／/]+/g, " ")
    .replace(/[【】\[\]（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (KEYWORD_SOUP_RE.test(s)) {
    // スペック列は先頭の意味単位だけ残す
    const parts = s.split(/\s+/).filter(Boolean);
    s = parts.slice(0, 6).join(" ");
  }
  return s.trim();
}

function looksLikeKeywordSoup(s) {
  const t = String(s || "").trim();
  if (!t) return true;
  if (KEYWORD_SOUP_RE.test(t)) return true;
  const tokens = t.split(/\s+/);
  if (tokens.length >= 8 && tokens.filter((x) => x.length <= 4).length >= 5) {
    return true;
  }
  return false;
}

/**
 * @param {"living"|"gadget"|"food"|"drink"|"beauty"} genre
 * @param {string} category
 * @param {string} [name]
 */
function audienceFor(genre, category, name = "") {
  const cat = String(category || "").toLowerCase();
  const n = String(name || "");
  if (genre === "beauty") {
    if (/ファンデ|クッション|下地|ベース/.test(n) || /base|face|makeup/i.test(cat)) {
      return "朝の時短メイクを整えたい人";
    }
    if (/リップ|ティント|グロス/.test(n) || /lip/i.test(cat)) {
      return "色と塗り心地のバランスを見たい人";
    }
    if (/化粧液|化粧水|美容液|クリーム|乳液|スキン/.test(n) || /skin|care/i.test(cat)) {
      return "毎日のスキンケアを続けやすくしたい人";
    }
    return "自分のペースでコスメを選びたい人";
  }
  if (genre === "living") {
    if (cat === "kitchen") return "キッチンの取り出し・片付けを楽にしたい人";
    if (cat === "storage") return "置き場所を決めて探し物を減らしたい人";
    if (cat === "cleaning") return "毎日のちょい掃除を続けたい人";
    return "暮らしの動線の引っかかりを減らしたい人";
  }
  if (genre === "gadget") {
    if (cat === "power") return "充電まわりをコンパクトにしたい人";
    if (cat === "cable") return "配線のごちゃつきを減らしたい人";
    if (cat === "desk") return "デスク周りを整えたい人";
    if (/防災|停電|ソーラー|トイレ/.test(n)) return "もしもの備えを進めたい人";
    return "スマホ周りの不便を減らしたい人";
  }
  if (genre === "food") {
    if (cat === "gift" || cat === "sweets") return "手土産やちょっとした贈り物を選びたい人";
    if (cat === "seasonal") return "今の時期だけの味を楽しみたい人";
    if (/備蓄|非常|保存/.test(n)) return "日持ちする備えを増やしたい人";
    return "食卓やおやつに一品足したい人";
  }
  if (genre === "drink") {
    if (cat === "sake") return "晩酌やギフトで日本酒を選びたい人";
    if (cat === "shochu") return "キレのある一杯を楽しみたい人";
    if (cat === "seasonal") return "季節酒を一度味わってみたい人";
    if (cat === "fruit") return "果実酒を食後やギフトで楽しみたい人";
    return "お酒の飲み比べや贈り物を探している人";
  }
  return "気になる条件で選びたい人";
}

/**
 * @param {"living"|"gadget"|"food"|"drink"} genre
 */
function benefitFallback(genre, category, name) {
  const product = String(name || "この商品").trim() || "この商品";
  const cat = String(category || "").toLowerCase();
  if (genre === "living") {
    if (cat === "kitchen") {
      return `${product}は、取り出しやすさと片付けやすさがポイント。`;
    }
    if (cat === "storage") {
      return `${product}は、置き場所が決まって探し物が減りやすいタイプ。`;
    }
    if (cat === "cleaning") {
      return `${product}は、毎日のちょい掃除が続きやすい設計。`;
    }
    return `${product}は、動線のひと手間を減らす向き。`;
  }
  if (genre === "gadget") {
    if (cat === "power") {
      return `${product}は、充電の場所を取らずに済ませたい場面向け。`;
    }
    if (cat === "cable") {
      return `${product}は、配線のごちゃつきを抑える向き。`;
    }
    if (cat === "desk") {
      return `${product}は、デスクの作業スペースを残しやすいタイプ。`;
    }
    return `${product}は、持ち運びや置き場所のストレスを減らす向き。`;
  }
  if (genre === "food") {
    if (/備蓄|非常|保存/.test(product) || cat === "table") {
      return `${product}は、味と日持ちのバランスを見たい人向け。`;
    }
    if (cat === "sweets" || cat === "gift") {
      return `${product}は、食感と見た目の満足感を贈りやすい一品。`;
    }
    return `${product}は、食べる場面がはっきりしている一品。`;
  }
  if (genre === "drink") {
    if (cat === "sake") {
      return `${product}は、香りと飲み口のバランスを見たい人向け。`;
    }
    if (cat === "shochu") {
      return `${product}は、キレと飲みやすさを確かめたい人向け。`;
    }
    return `${product}は、合う料理や飲む場面から選びやすい一本。`;
  }
  return `${product}の使いどころがはっきりしています。`;
}

/**
 * カタログ用 description（体感寄り・誰向け付き）
 */
function buildBenefitDescription(opts = {}) {
  const genre = String(opts.genre || "living").toLowerCase();
  const category = String(opts.category || "").trim();
  const name = String(opts.name || opts.displayName || "").trim();
  const maxLen = Math.max(40, Number(opts.maxLen) || 120);
  const scrubbed = scrubMerchantNoise(
    opts.snippet || opts.catchcopy || opts.caption || "",
  );
  const audience = audienceFor(genre, category, name);

  let core = "";
  if (scrubbed && !looksLikeKeywordSoup(scrubbed) && scrubbed.length >= 10) {
    core = scrubbed;
  } else {
    core = benefitFallback(genre, category, name);
  }

  let out = core;
  if (!out.includes("向け") && !out.includes("人")) {
    out = `${out.replace(/[。．]?$/, "")}。${audience}向け。`;
  } else if (!/向け/.test(out)) {
    out = `${out.replace(/[。．]?$/, "")}（${audience}）。`;
  }

  out = out.replace(/\s+/g, " ").trim();
  if (out.length > maxLen) {
    return `${out.slice(0, maxLen - 1)}…`;
  }
  return out;
}

/**
 * SNS 根拠行（短い）
 */
function buildReasonLine(opts = {}) {
  const maxLen = Math.max(24, Number(opts.maxLen) || 48);
  const desc = buildBenefitDescription({ ...opts, maxLen: maxLen + 20 });
  if (desc.length <= maxLen) return desc;
  return `${desc.slice(0, maxLen - 1)}…`;
}

function cuePatternFor(genre) {
  if (genre === "drink") {
    return /産地|酒蔵|県|市|町|香り|飲み口|甘み|キレ|吟醸|純米|本醸造|仕込み|冷酒|燗/;
  }
  if (genre === "food") {
    return /香|匂い|におい|食感|味|甘|塩|旨|サク|もち|しっとり|濃厚|歯ごたえ|風味|タルト|ケーキ|チョコ|焼|揚|煮|炊|アソート/;
  }
  if (genre === "living") {
    return /取り出し|片付け|収納|置き|掃除|動線|しまう|定位置/;
  }
  if (genre === "gadget") {
    return /充電|配線|デスク|コンパクト|持ち運|差し替え|置き場|ケーブル/;
  }
  return /./;
}

function pickCueSentence(text, genre) {
  const t = String(text || "").trim();
  if (!t) return "";
  const cue = cuePatternFor(genre);
  const parts = t
    .split(/[。．！？\n]/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const hit = parts.find((p) => cue.test(p) && p.length >= 8);
  return hit || parts[0] || t;
}

function stripAudienceClause(raw) {
  return String(raw || "")
    .replace(/[（(][^）)]*向け[^）)]*[）)]/g, " ")
    .replace(/[^。．\n]*向け[。．]?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * IG長文化用の具体行（産地・食感・使いどころ）。「向け」は付けない。
 */
function buildDetailLine(opts = {}) {
  const genre = String(opts.genre || "living").toLowerCase();
  const category = String(opts.category || "").trim();
  const name = String(opts.name || opts.displayName || "").trim();
  const maxLen = Math.max(36, Number(opts.maxLen) || 72);
  const scrubbed = scrubMerchantNoise(
    opts.snippet || opts.catchcopy || opts.caption || "",
  );

  let core = "";
  if (scrubbed && !looksLikeKeywordSoup(scrubbed) && scrubbed.length >= 8) {
    core = pickCueSentence(scrubbed, genre);
  } else {
    core = stripAudienceClause(benefitFallback(genre, category, name));
  }
  core = stripAudienceClause(core)
    .replace(/[。．]+$/u, "")
    .trim();
  if (!core) {
    core = stripAudienceClause(benefitFallback(genre, category, name)).replace(
      /[。．]+$/u,
      "",
    );
  }
  let out = `${core}。`;
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen - 1)}…`;
  }
  return out;
}

/** IG長文化用の「誰向け」行 */
function buildAudienceLine(opts = {}) {
  const genre = String(opts.genre || "living").toLowerCase();
  const category = String(opts.category || "").trim();
  const name = String(opts.name || opts.displayName || "").trim();
  return `${audienceFor(genre, category, name)}向け。`;
}

/**
 * Threads用の短文（IGの長文をそのまま載せない）。
 * line1/line2 + ※PR + URL
 */
function buildShortAffiliateThreadsText(opts = {}) {
  const tip = Boolean(opts.tip);
  const requirePr = opts.requirePr !== false;
  const prToken = String(opts.prToken || "※PR").trim() || "※PR";
  const affiliateUrl = String(opts.affiliateUrl || "").trim();
  const line1 = String(opts.line1 || "").trim();
  const line2 = String(opts.line2 || "").trim();
  let body = [line1, line2].filter(Boolean).join("\n").trim();
  body = body
    .replace(/\n*気になったら、保存して見返してみてください\s*※?PR?\s*$/u, "")
    .replace(/\n*動画の最後は楽天QRです\s*※?PR?\s*$/u, "")
    .replace(/\n*https?:\/\/\S+/gi, "")
    .trim();
  if (tip || !affiliateUrl) {
    if (!tip && requirePr && body && !/※PR/.test(body)) {
      body = `${body} ${prToken}`;
    }
    return body;
  }
  if (requirePr && !/※PR/.test(body)) {
    body = `${body} ${prToken}`;
  }
  return `${body}\n${affiliateUrl}`.trim();
}

module.exports = {
  scrubMerchantNoise,
  looksLikeKeywordSoup,
  audienceFor,
  benefitFallback,
  buildBenefitDescription,
  buildReasonLine,
  buildDetailLine,
  buildAudienceLine,
  buildShortAffiliateThreadsText,
};
