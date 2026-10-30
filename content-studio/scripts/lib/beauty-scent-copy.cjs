/**
 * 美容の香り3分岐（軽量・追加クロールなし想定）。
 * concrete: 公式文に具体ノートあり
 * fragrance_free: 無香料・フレグランスフリー
 * unknown: 書かない（曖昧な「強め／やさしい」は使わない）
 */

const FRAGRANCE_FREE_RE =
  /無香料|香料不使用|フレグランス\s*フリー|fragrance[\s-]*free|unscented|無香(?!料系)|におい(?:は)?ほぼない|香り(?:は)?ほぼない/i;

/** 曖昧表現は具体扱いにしない */
const VAGUE_SCENT_RE =
  /やさしい香り|ほのかな香り|上品な香り|甘い香り|良い香り|いい香り|香りが強め|匂いが強め|においが強め|強めの香り|控えめな香り|気になる香り/i;

const CONCRETE_NOTE_RES = [
  {
    re: /ホワイト\s*フローラル|白花|ジャスミン|ローズ|バラ(?!ンス)|ピオニー|ピューニー|ラベンダー|ネロリ|オレンジ\s*フラワー/i,
    label: "フローラル系",
  },
  {
    re: /シトラス|柑橘|レモン|グレープフルーツ|オレンジ(?!\s*フラワー)|ベルガモット|柚子|ゆず/i,
    label: "シトラス系",
  },
  {
    re: /フルーティ|フルーツ|ピーチ|ベリー|アップル|リンゴ|メロン|ココナッツ/i,
    label: "フルーティ系",
  },
  {
    re: /ムスク|ウッディ|ウッド|サンダル|シダー|ヒノキ|森林/i,
    label: "ウッディ／ムスク系",
  },
  {
    re: /グリーン|ハーブ|ティー|お茶|抹茶|セージ|ミント/i,
    label: "グリーン／ティー系",
  },
  {
    re: /バニラ|アンバー|オリエンタル|スパイス/i,
    label: "スイート／オリエンタル系",
  },
  {
    re: /ソープ|石鹸|せっけん|清潔感のある香り/i,
    label: "ソープ系",
  },
];

const NOTE_PHRASE_RE =
  /(?:香り(?:は|が)?|におい(?:は|が)?|香調(?:は|が)?)\s*([一-龥ぁ-んァ-ンA-Za-zー・]+(?:系|調|の香り)?)/;

function stripHtmlToText(html, maxChars = 8000) {
  let s = String(html || "");
  if (!s) return "";
  // スクリプト・スタイルを先に落とす（重くしない）
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxChars) s = s.slice(0, maxChars);
  return s;
}

function extractPageCopyBlob(html) {
  const og =
    (String(html || "").match(
      /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    ) ||
      String(html || "").match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:description["']/i,
      ) ||
      [])[1] || "";
  const desc =
    (String(html || "").match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ) ||
      String(html || "").match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      ) ||
      [])[1] || "";
  const body = stripHtmlToText(html, 8000);
  return [og, desc, body].filter(Boolean).join("\n").slice(0, 10000);
}

/**
 * @returns {{ kind: 'concrete'|'fragrance_free'|'unknown', label: string, evidence: string }}
 */
function classifyScentFromText(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return { kind: "unknown", label: "", evidence: "" };
  }
  if (FRAGRANCE_FREE_RE.test(text)) {
    const m = text.match(FRAGRANCE_FREE_RE);
    return {
      kind: "fragrance_free",
      label: "無香料寄り",
      evidence: (m?.[0] || "無香料").slice(0, 40),
    };
  }

  // 曖昧語だけの言及は無視
  const vagueOnly = VAGUE_SCENT_RE.test(text) && !CONCRETE_NOTE_RES.some((x) => x.re.test(text));
  if (vagueOnly) {
    return { kind: "unknown", label: "", evidence: "" };
  }

  for (const note of CONCRETE_NOTE_RES) {
    const m = text.match(note.re);
    if (m) {
      return {
        kind: "concrete",
        label: note.label,
        evidence: String(m[0] || note.label).slice(0, 40),
      };
    }
  }

  const phrase = NOTE_PHRASE_RE.exec(text);
  if (phrase?.[1]) {
    const hit = String(phrase[1]).trim();
    if (hit && !/強め|やさしい|ほのか|上品|良い|いい|控えめ|気になる/.test(hit)) {
      return {
        kind: "concrete",
        label: hit.slice(0, 20),
        evidence: hit.slice(0, 40),
      };
    }
  }

  return { kind: "unknown", label: "", evidence: "" };
}

function scentLineForCopy(scent, fallbackUseLine) {
  const kind = scent?.kind || "unknown";
  if (kind === "concrete" && scent.label) {
    return `公式の香り表現では「${scent.label}」寄り。強さの断定はせず、日常使いで気になるかだけ見ています`;
  }
  if (kind === "fragrance_free") {
    return "無香料・フレグランスフリー寄りの記載があるので、香りはほぼ気にならない想定で見ています";
  }
  // unknown: 曖昧な香り表現は書かない
  return fallbackUseLine || "使い心地と仕上がりを中心に見ています";
}

module.exports = {
  stripHtmlToText,
  extractPageCopyBlob,
  classifyScentFromText,
  scentLineForCopy,
  FRAGRANCE_FREE_RE,
};
