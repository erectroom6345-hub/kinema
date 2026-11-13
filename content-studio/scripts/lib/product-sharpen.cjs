/**
 * 尖り選定・現場限定・発見フック・IGハッシュタグ。
 * 定番人気より「調べなさそうだが現場で役立つ／新しめ・未周知」を優先する。
 */

const GENERIC_NAME_RE =
  /急速充電器|モバイルバッテリー|パックご飯|日本酒 飲み比べ|ケーブル 整理|スマホ スタンド|掃除機|保存容器|ギフト スイーツ|ワイヤレスイヤホン/;

const NOVELTY_RE =
  /海外|本場|希少|限定|先行|新発売|入荷|職人|現場|鳶|足場|介護|介助|夜勤|防災|備蓄|差入|差し入れ|一人暮らし|狭小|キッチン狭い|北欧|韓国|台湾|欧州|ドイツ|アメリカ発|話題/;

const NICHE_RULES = {
  gadget: [
    { re: /鳶|足場|工事現場|ヘルメット|高所/, audience: "鳶職・現場仕事の人", env: "現場", tags: ["現場仕事", "鳶", "道具"] },
    { re: /介護|介助|ナース|医療/, audience: "介護や看護の現場に立つ人", env: "介護現場", tags: ["介護", "現場道具"] },
    { re: /夜勤|深夜|交代制/, audience: "夜勤のある働き方の人", env: "夜勤", tags: ["夜勤", "仕事道具"] },
    { re: /防災|停電|ソーラー|携帯トイレ|ランタン/, audience: "備えを進めたい家庭", env: "備え", tags: ["防災", "備え"] },
    { re: /デスク|在宅|リモート/, audience: "在宅やデスク作業が多い人", env: "在宅デスク", tags: ["デスク", "在宅ワーク"] },
  ],
  living: [
    { re: /介護|介助|手すり|見守り/, audience: "在宅介護をしている人", env: "在宅介護", tags: ["介護", "暮らし"] },
    { re: /一人暮らし|ワンルーム|狭小/, audience: "一人暮らしで場所を節約したい人", env: "一人暮らし", tags: ["一人暮らし", "収納"] },
    { re: /キッチン|シンク|蛇口|調理/, audience: "狭いキッチンを毎日使う人", env: "キッチン", tags: ["キッチン", "時短"] },
    { re: /掃除|ホコリ|水垢/, audience: "毎日のちょい掃除を続けたい人", env: "掃除動線", tags: ["掃除", "暮らし"] },
  ],
  food: [
    { re: /現場|差し入れ|弁当|昼飯/, audience: "現場や外出先で昼を済ませる人", env: "現場昼", tags: ["現場飯", "お弁当"] },
    { re: /介護|やわらか|嚥下|きざみ/, audience: "介護食や食べやすさを見ている人", env: "介護食", tags: ["介護食", "食事"] },
    { re: /夜食|深夜|夜勤/, audience: "夜食や夜勤明けの一品を探す人", env: "夜食", tags: ["夜食", "ごはん"] },
    { re: /手土産|ギフト|差し入れ/, audience: "手土産や差し入れを急いで選ぶ人", env: "手土産", tags: ["手土産", "ギフト"] },
    { re: /備蓄|非常|保存|日持/, audience: "日持ちする備えを増やしたい人", env: "備蓄", tags: ["備蓄", "常備食"] },
  ],
  drink: [
    { re: /差し入れ|現場|職人/, audience: "現場への差し入れを選ぶ人", env: "差し入れ", tags: ["差し入れ", "日本酒"] },
    { re: /手土産|ギフト|冬ギフト/, audience: "手土産用の一本を探す人", env: "手土産", tags: ["手土産", "お酒"] },
    { re: /季節|限定|新酒|ひやおろし/, audience: "季節酒を一度味わってみたい人", env: "季節酒", tags: ["季節酒", "日本酒"] },
    { re: /介護|ノンアル|弱め/, audience: "控えめな一杯を選びたい人", env: "控えめ", tags: ["お酒", "ギフト"] },
  ],
};

const HASHTAG_BASE = {
  gadget: ["ガジェット", "便利グッズ", "楽天ROOM"],
  living: ["暮らし", "便利グッズ", "楽天ROOM"],
  food: ["グルメ", "お取り寄せ", "楽天ROOM"],
  drink: ["日本酒", "お酒好き", "楽天ROOM"],
};

function readLabels(item) {
  const raw = item && item.labels;
  return raw && typeof raw === "object" ? raw : {};
}

function haystack(item) {
  return [
    item?.name,
    item?.nameRaw,
    item?.description,
    item?.articleBody,
    item?.category,
    Array.isArray(item?.features) ? item.features.join(" ") : "",
  ]
    .map((x) => String(x || ""))
    .join(" ");
}

function inferNiche(genre, item) {
  const g = String(genre || item?.genre || "").toLowerCase();
  const rules = NICHE_RULES[g] || [];
  const text = haystack(item);
  for (const rule of rules) {
    if (rule.re.test(text)) {
      return {
        audience: rule.audience,
        env: rule.env,
        tags: rule.tags.slice(),
        matched: true,
      };
    }
  }
  return { audience: "", env: "", tags: [], matched: false };
}

function daysSinceIngested(item, now = Date.now()) {
  const raw =
    item?.ingestedAt ||
    item?.labels?.ingestedAt ||
    item?.firstSeenAt ||
    "";
  const t = Date.parse(String(raw));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 86_400_000);
}

function isGenericName(item) {
  const name = String(item?.name || item?.nameRaw || "").trim();
  if (!name) return true;
  return GENERIC_NAME_RE.test(name);
}

function hasNoveltyCue(item) {
  return NOVELTY_RE.test(haystack(item));
}

/**
 * 尖りスコア（高いほど優先）。ops.sharpen.enabled === false なら null。
 */
function sharpenScore(item, ops = {}, genre = "") {
  const cfg = ops.sharpen || {};
  if (cfg.enabled === false) return null;

  const g = String(genre || item?.genre || "").toLowerCase();
  const labels = readLabels(item);
  const niche = inferNiche(g, item);
  let score = 0;

  // 定番人気（現状は高ポイント付与が多い）を下げ、未周知を上げる
  if (labels.popular) score -= 50;
  else score += 25;

  if (labels.limited || labels.arrival) score += 45;
  if (labels.fresh || labels.underknown || labels.sharpen) score += 35;
  if (hasNoveltyCue(item)) score += 30;
  if (niche.matched) score += 40;
  if (isGenericName(item)) score -= 35;

  const ageDays = daysSinceIngested(item);
  // 新しめ〜約5〜6ヶ月の未周知を厚く、古くて定番っぽいものを薄く
  if (ageDays != null) {
    if (ageDays <= 45) score += 35;
    else if (ageDays <= 180) score += 28;
    else if (ageDays <= 365) score += 5;
    else score -= 15;
  }

  // セール割り込み自体は別経路。通常枠ではポイント倍の人気ラベルを過信しない
  return score;
}

function pickBestSharpened(candidates, ops, genre, opts = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return null;
  const preferred = typeof opts.isPreferredPrice === "function" ? opts.isPreferredPrice : null;
  const ranked = [...list].sort((a, b) => {
    const sa = Number(sharpenScore(a, ops, genre) || 0) + (preferred && preferred(a) ? 8 : 0);
    const sb = Number(sharpenScore(b, ops, genre) || 0) + (preferred && preferred(b) ? 8 : 0);
    return sb - sa;
  });
  return ranked[0] || null;
}

function discoveryHookLine(genre, item, niche) {
  const n = niche && niche.matched ? niche : inferNiche(genre, item);
  if (n.matched && n.env) {
    return `${n.env}では役立つのに、自分ではなかなか調べない一品です。`;
  }
  if (hasNoveltyCue(item) || readLabels(item).fresh || readLabels(item).underknown) {
    return "え、こんなのあるの？と止まりやすい、まだ知られていない一品です。";
  }
  return "自分では調べなさそうだけど、使う場面がはっきりしている一品です。";
}

function nicheAudienceLine(genre, item, fallbackAudienceLine) {
  const niche = inferNiche(genre, item);
  if (niche.matched && niche.audience) return `${niche.audience}向け。`;
  return fallbackAudienceLine || "";
}

function nicheFutureLine(genre, item, fallbackFutureLine) {
  const niche = inferNiche(genre, item);
  if (!niche.matched) return fallbackFutureLine || "";
  if (genre === "gadget" && /現場|鳶/.test(niche.env)) {
    return "手元が一度で済むと、現場の動きが一段楽になります。";
  }
  if (genre === "living" && /介護/.test(niche.env)) {
    return "一手間減ると、介護の夜や朝が少し楽になります。";
  }
  if (genre === "food" && /現場/.test(niche.env)) {
    return "昼の一品が決まると、現場の休憩が選びやすくなります。";
  }
  if (genre === "drink" && /差入|手土産/.test(niche.env)) {
    return "一本決まると、差し入れや手土産の迷いが減ります。";
  }
  return fallbackFutureLine || "";
}

function buildHashtags(genre, item, opts = {}) {
  const max = Math.max(3, Math.min(8, Number(opts.max) || 6));
  const g = String(genre || item?.genre || "").toLowerCase();
  const niche = inferNiche(g, item);
  const cat = String(item?.category || "").trim();
  const tags = [];
  const push = (t) => {
    const s = String(t || "")
      .replace(/^#/, "")
      .replace(/\s+/g, "")
      .trim();
    if (!s || tags.includes(s)) return;
    tags.push(s);
  };
  for (const t of niche.tags || []) push(t);
  if (cat) push(cat);
  if (hasNoveltyCue(item) || readLabels(item).fresh) push("新発見");
  if (readLabels(item).limited || readLabels(item).arrival) push("限定");
  for (const t of HASHTAG_BASE[g] || ["楽天ROOM"]) push(t);
  return tags.slice(0, max).map((t) => `#${t}`);
}

function appendHashtagsToCaption(caption, hashtags) {
  const body = String(caption || "").trim();
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  if (!body || !tags.length) return body;
  if (/#[\w\u3040-\u30ff\u4e00-\u9fff]+/u.test(body)) return body;
  return `${body}\n\n${tags.join(" ")}`;
}

function stampIngestedAt(product, now = new Date()) {
  const p = product && typeof product === "object" ? { ...product } : {};
  const iso = now.toISOString();
  p.ingestedAt = p.ingestedAt || iso;
  p.labels = { ...(p.labels || {}) };
  if (!p.labels.popular) p.labels.underknown = true;
  if (p.labels.sharpenSearch) p.labels.sharpen = true;
  return p;
}

module.exports = {
  inferNiche,
  sharpenScore,
  pickBestSharpened,
  discoveryHookLine,
  nicheAudienceLine,
  nicheFutureLine,
  buildHashtags,
  appendHashtagsToCaption,
  stampIngestedAt,
  hasNoveltyCue,
  isGenericName,
};
