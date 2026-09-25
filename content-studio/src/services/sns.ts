import type { ArticleAnalysis, LlmClient } from "../types/index.ts";
import { safeComplete } from "../adapters/llm.ts";
import { buildSnsSystemPrompt, buildSnsUserPrompt } from "../prompts/sns.ts";

export async function createSnsOutputs(params: {
  llm: LlmClient;
  title: string;
  topic: string;
  genre: string;
  analysis: ArticleAnalysis;
  articleUrl: string;
  isPr: boolean;
}): Promise<{ instagram: { caption: string }; threads: string[]; x: string[] }> {
  const fallback = buildFallbackSns(params);

  // SNS下書きには公開本文用の削除ルールを適用しない。
  // LLM結果は足りない分を fallback で埋めて、必ず十分な本数を残す。
  const generated = await safeComplete(
    params.llm,
    [
      { role: "system", content: buildSnsSystemPrompt(params.genre) },
      { role: "user", content: buildSnsUserPrompt(params) },
    ],
    JSON.stringify(fallback),
    { json: true },
  );

  try {
    const parsed = JSON.parse(extractJsonObject(generated)) as {
      instagram?: { caption?: string };
      threads?: string[];
      x?: string[];
    };
    return {
      instagram: {
        caption:
          parsed.instagram?.caption && parsed.instagram.caption.trim().length >= 20
            ? parsed.instagram.caption.trim()
            : fallback.instagram.caption,
      },
      threads: padWithFallback(parsed.threads, fallback.threads, 3),
      x: padWithFallback(parsed.x, fallback.x, 7),
    };
  } catch {
    return fallback;
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function padWithFallback(values: string[] | undefined, fallback: string[], count: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const candidate = values?.[i]?.trim() ?? "";
    result.push(candidate.length >= 8 ? candidate : fallback[i] ?? "");
  }
  return result;
}

export function buildFallbackSns(params: {
  title: string;
  topic: string;
  analysis: ArticleAnalysis;
  articleUrl: string;
  isPr: boolean;
}): { instagram: { caption: string }; threads: string[]; x: string[] } {
  const extras = params as {
    title: string;
    topic: string;
    analysis: ArticleAnalysis;
    articleUrl: string;
    isPr: boolean;
    postType?: string;
    genre?: string;
    product?: {
      postType?: string;
      genre?: string;
      name?: string;
      productName?: string;
      category?: string;
    };
  };

  // 実データは top-level または product.* に載る（article.json / instagram-post.json）
  const postTypeRaw = firstNonEmpty(extras.postType, extras.product?.postType);
  const genreRaw = firstNonEmpty(extras.genre, extras.product?.genre);
  const topic =
    firstNonEmpty(params.topic, extras.product?.name, extras.product?.productName) || params.topic;

  const hasExplicitPostType = Boolean(postTypeRaw);
  const hasExplicitGenre = Boolean(genreRaw);
  const inferredGenre = resolveGenreTone(genreRaw, params.title, topic, extras.product?.category);
  const inferredPostType = resolvePostType(postTypeRaw, params.title, topic);

  // 明示フィールドも推定も弱いときだけ、既存テスト互換へ
  const canUseTypedVoice =
    hasExplicitPostType ||
    hasExplicitGenre ||
    inferredGenre !== "general" ||
    inferredPostType === "sale" ||
    inferredPostType === "main";

  if (!canUseTypedVoice) {
    return buildCompatibleFallback(params);
  }

  const postType = inferredPostType;
  const genreTone = inferredGenre;
  const voice = buildVoice({
    postType,
    genreTone,
    topic,
    hook: params.analysis.suggested_hooks[0]?.trim() || "",
  });

  const prTail = params.isPr ? "\n\n※PR" : "";
  const threadPr = params.isPr ? " ※PR" : "";
  const xPr = params.isPr ? " ※PR" : "";
  const urlBlock = params.articleUrl
    ? `\n\n${voice.urlLead}\n${params.articleUrl}`
    : `\n\n${voice.urlLead}`;
  const tag = topic.replace(/\s+/g, "");

  // Instagram / Threads / X は同じ条件順（postType → genre）の voice を共有する
  const instagram = `${voice.igOpen}

${voice.igBody}

${voice.bullets.map((item) => `・${item}`).join("\n")}

${voice.saveLine}
${urlBlock}

#${tag} #${voice.hashTag}${prTail}`;

  const threads = [
    `${voice.th1} ${voice.th1Follow}${threadPr}`,
    `${voice.th2}${threadPr}`,
    `${voice.th3}${threadPr}`,
  ];

  const x = [
    `${params.title}｜${voice.xLead}${xPr}`,
    voice.x1,
    voice.x2,
    voice.x3,
    voice.x4,
    voice.x5,
    params.articleUrl ? `${voice.xClose} ${params.articleUrl}` : voice.xClose,
  ];

  return {
    instagram: { caption: instagram },
    threads,
    x,
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function buildCompatibleFallback(params: {
  title: string;
  topic: string;
  analysis: ArticleAnalysis;
  articleUrl: string;
  isPr: boolean;
}): { instagram: { caption: string }; threads: string[]; x: string[] } {
  const prTail = params.isPr ? "\n\n※PR" : "";
  const threadPr = params.isPr ? " ※PR" : "";
  const xPr = params.isPr ? " ※PR" : "";
  const url = params.articleUrl
    ? `\n\n気になった方は、こちらにもまとめています🌿\n${params.articleUrl}`
    : "\n\n気になった方は、ブログにもやさしくまとめています🌿";
  const hook = params.analysis.suggested_hooks[0] ?? params.topic;
  const tag = params.topic.replace(/\s+/g, "");

  const instagram = `${params.topic}で、正解を探しすぎて少し疲れてしまうこと、ありませんか💭

わたしは最近、いきなり答えを決めず「自分に合いそうな軸」をひとつだけ持つようにしています。
押し売りではなく、選ぶ前のメモとして見てもらえたらうれしいです。

・いきなり正解を探さない
・自分に合う軸を先に決める
・続けやすさを優先する

迷ったときの安心材料として、保存しておいてもらえたら嬉しいです✨
${url}

#${tag} #整理ノート${prTail}`;

  const threads = [
    `${params.topic}で、正解を探しすぎて疲れてしまうことありませんか？💭 条件をひとつ決めると、気持ちが楽になることもあります🌿${threadPr}`,
    `${params.topic}は、頑張りすぎると続きにくいですよね💭 「やらなくていいこと」をひとつ減らすくらいで充分かもしれません✨${threadPr}`,
    `調べ始めると、情報が多すぎて決めにくくなることありませんか？💭 ${hook}という視点で、やさしく整理してみました🌿${threadPr}`,
  ];

  const x = [
    `${params.title}｜まず見るべき点だけ短くまとめました${xPr}`,
    `${params.topic}は、効果の断言より「続けられるか」で選ぶと失敗しにくいです。`,
    `情報が多いときのコツは、比較表を見る前に自分の条件を決めること。`,
    `完璧なケアより、負担の少ない習慣の方が結果的に続きやすいです。`,
    `合う人・合わない人を先に書くと、読み手も判断しやすくなります。`,
    `保存用に、選び方の軸を記事側へまとめています。`,
    params.articleUrl
      ? `今週のメモ。詳しい整理はこちら ${params.articleUrl}`
      : `今週のメモ。詳しい整理はブログ側に置いています。`,
  ];

  return {
    instagram: { caption: instagram },
    threads,
    x,
  };
}

type PostType = "sale" | "routine" | "main" | "niche";
type GenreTone = "supplement" | "special" | "korean" | "makeup" | "skincare" | "general";

interface SnsVoice {
  igOpen: string;
  igBody: string;
  bullets: [string, string, string];
  saveLine: string;
  urlLead: string;
  hashTag: string;
  th1: string;
  th1Follow: string;
  th2: string;
  th3: string;
  xLead: string;
  x1: string;
  x2: string;
  x3: string;
  x4: string;
  x5: string;
  xClose: string;
}

function resolvePostType(raw: string | undefined, title: string, topic: string): PostType {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "sale") return "sale";
  if (value === "routine") return "routine";
  if (value === "main") return "main";
  if (value === "niche") return "niche";
  const text = `${title} ${topic}`;
  if (/セール|sale|特価|ポイント対象/i.test(text)) return "sale";
  return "routine";
}

function resolveGenreTone(
  raw: string | undefined,
  title: string,
  topic: string,
  category?: string,
): GenreTone {
  const value = (raw ?? "").trim();
  const text = `${value} ${category ?? ""} ${title} ${topic}`;
  // メイクをスキンケア（肌）より先に判定する
  if (/サプリ|内側|supplement/i.test(text)) return "supplement";
  if (/特別ケア|ご褒美|スペシャル/i.test(text)) return "special";
  if (/韓国コスメ|韓国|korean/i.test(text)) return "korean";
  if (/メイク用品|メイク|リップ|ファンデーション|化粧|makeup/i.test(text)) return "makeup";
  if (/スキンケア|保湿|美容液|化粧水|クリーム|skincare/i.test(text)) return "skincare";
  return "general";
}

function buildVoice(params: {
  postType: PostType;
  genreTone: GenreTone;
  topic: string;
  hook: string;
}): SnsVoice {
  const { postType, genreTone, topic, hook } = params;
  const genre = genrePhrases(genreTone, topic);
  const post = postTypePhrases(postType, topic, genre);

  const hookLine = hook && !topic.includes(hook) ? hook : genre.focus;

  return {
    igOpen: post.igOpen,
    igBody: post.igBody,
    bullets: post.bullets,
    saveLine: post.saveLine,
    urlLead: post.urlLead,
    hashTag: genre.hashTag,
    th1: post.th1,
    th1Follow: post.th1Follow,
    th2: post.th2,
    th3: `${genre.th3Lead} ${hookLine}という視点で、${topic}をやさしく整理してみました🌿`,
    xLead: post.xLead,
    x1: post.x1,
    x2: genre.x2,
    x3: post.x3,
    x4: genre.x4,
    x5: post.x5,
    xClose: post.xClose,
  };
}

function postTypePhrases(
  postType: PostType,
  topic: string,
  genre: ReturnType<typeof genrePhrases>,
): {
  igOpen: string;
  igBody: string;
  bullets: [string, string, string];
  saveLine: string;
  urlLead: string;
  th1: string;
  th1Follow: string;
  th2: string;
  xLead: string;
  x1: string;
  x3: string;
  x5: string;
  xClose: string;
} {
  if (postType === "sale") {
    return {
      igOpen: `${topic}、いま気になっている方へ。セール対象かどうか、確認しておきたいタイミングかもしれません💭`,
      igBody: `押し売りではなく、${genre.saleBody}を見ながら、詳細だけ先に押さえておくメモです。`,
      bullets: [
        `${topic}の対象条件を確認する`,
        genre.saleBullet,
        "合うかどうかは、詳細を見てから決める",
      ],
      saveLine: `${topic}の確認用に、保存しておいてもらえたら嬉しいです✨`,
      urlLead: `${topic}の詳細は、こちらでも確認できます🌿`,
      th1: `${topic}が気になるとき、セール対象かどうか先に見ておくと安心ですよね？💭`,
      th1Follow: `${genre.saleShort}を意識して、条件だけ確認してみました🌿`,
      th2: `${topic}は、急がなくて大丈夫。詳細を見てから判断するくらいで充分かもしれません✨`,
      xLead: `${topic}のセール確認ポイント`,
      x1: `${topic}は、対象条件を先に見ると迷いにくいです。`,
      x3: `${topic}の詳細確認を、短くまとめています。`,
      x5: `${topic}のセール確認メモとして置いています。`,
      xClose: `${topic}の詳細はこちら。`,
    };
  }

  // main / routine / niche は日常使い。main は定番の毎日使い寄り
  const dailyLead = postType === "main" ? "毎日使いの定番として" : "日常の中で";
  return {
    igOpen: `${topic}を、${dailyLead}どう取り入れるか。${genre.routineOpen}💭`,
    igBody: `わたしは最近、${topic}について${genre.routineBody}を大切にしています。押し売りではなく、毎日使いのメモとして見てもらえたらうれしいです。`,
    bullets: [
      `${topic}に求めることをひとつ決める`,
      genre.routineBullet,
      genre.easeBullet,
    ],
    saveLine: `${topic}の日常メモとして、保存しておいてもらえたら嬉しいです✨`,
    urlLead: `${topic}の整理は、こちらにもまとめています🌿`,
    th1: `${topic}、毎日どう使うか迷うことありませんか？💭`,
    th1Follow: `${genre.routineShort}を意識すると、気持ちが楽になることもあります🌿`,
    th2: `${topic}は、${genre.easeShort}💭 ${genre.routineBullet}くらいで充分かもしれません✨`,
    xLead: `${topic}の日常の取り入れ方`,
    x1: `${topic}は、${genre.easeX1}`,
    x3: `${topic}の日常使いの軸を、短くまとめています。`,
    x5: `${topic}の日常メモとして置いています。`,
    xClose: `${topic}の詳しい整理はこちら。`,
  };
}

function genrePhrases(tone: GenreTone, topic: string): {
  focus: string;
  hashTag: string;
  saleBody: string;
  saleBullet: string;
  saleShort: string;
  routineOpen: string;
  routineBody: string;
  routineBullet: string;
  routineShort: string;
  easeBullet: string;
  easeShort: string;
  easeX1: string;
  th3Lead: string;
  x2: string;
  x4: string;
} {
  switch (tone) {
    case "supplement":
      return {
        focus: "内側ケアの続けやすさ",
        hashTag: "内側ケア",
        saleBody: "内側ケアとして取り入れやすいか",
        saleBullet: "続けやすさを先に見る",
        saleShort: "内側ケアの観点",
        routineOpen: "内側からのケアとして、無理なく続けられるかを大切にしたいです",
        routineBody: "内側ケアのペース",
        routineBullet: "内側ケアとして負担を減らす",
        routineShort: "内側ケアのペース",
        easeBullet: "使いやすさを優先する",
        easeShort: "頑張りすぎると続きにくいですよね",
        easeX1: "毎日の使いやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、内側ケアとして見ると見え方が変わります。`,
        x2: `${topic}は、内側ケアとして「続けられるか」で見ると選びやすいです。`,
        x4: `${topic}の内側ケアとしての位置づけを先に書くと、判断しやすくなります。`,
      };
    case "special":
      return {
        focus: "ご褒美としての特別感",
        hashTag: "ご褒美ケア",
        saleBody: "ご褒美として取り入れるタイミングか",
        saleBullet: "ご褒美使いの条件を確認する",
        saleShort: "ご褒美ケアの観点",
        routineOpen: "ときどきのご褒美として取り入れる余白も大切にしたいです",
        routineBody: "ご褒美としての特別感",
        routineBullet: "ご褒美としての頻度を決める",
        routineShort: "ご褒美としての余白",
        easeBullet: "使いやすさを優先する",
        easeShort: "特別感ばかり追いすぎると続きにくいですよね",
        easeX1: "ご褒美としての使いやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、ご褒美ケアとして見ると気持ちがやわらぎます。`,
        x2: `${topic}は、ご褒美としての特別感で選ぶと満足しやすいです。`,
        x4: `${topic}をご褒美枠で置くと、日常とのバランスが取りやすくなります。`,
      };
    case "korean":
      return {
        focus: "話題性との向き合い方",
        hashTag: "韓国コスメ",
        saleBody: "話題のうちに確認しておきたい点があるか",
        saleBullet: "話題性と自分の条件を分けて見る",
        saleShort: "話題性の観点",
        routineOpen: "話題になりやすいものほど、自分の軸で見たいです",
        routineBody: "話題性に流されすぎない選び方",
        routineBullet: "話題より自分の使い心地を見る",
        routineShort: "話題との距離感",
        easeBullet: "使いやすさを優先する",
        easeShort: "話題だけ追うと疲れやすいですよね",
        easeX1: "毎日の使いやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、話題性だけで決めない方が安心です。`,
        x2: `${topic}は、話題性より自分の条件で見ると失敗しにくいです。`,
        x4: `${topic}の話題ポイントと、合う条件を分けて書くと判断しやすいです。`,
      };
    case "makeup":
      return {
        focus: "毎日のメイクの仕上がり",
        hashTag: "メイク",
        saleBody: "仕上がりが自分の毎日メイクに合うか",
        saleBullet: "仕上がりと使いやすさを確認する",
        saleShort: "仕上がりの観点",
        routineOpen: "毎日のメイクで、仕上がりと使いやすさを大切にしたいです",
        routineBody: "仕上がりの整えやすさと、使いやすさ",
        routineBullet: "仕上がりの好みをひとつ決める",
        routineShort: "仕上がりの軸",
        easeBullet: "使いやすさを優先する",
        easeShort: "仕上がりばかり気にしすぎると続きにくいですよね",
        easeX1: "毎日のメイクの仕上がりと使いやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、毎日のメイクの仕上がりから見ると選びやすくなります。`,
        x2: `${topic}は、仕上がりの好みで選ぶと毎日のメイクが楽になります。`,
        x4: `${topic}の仕上がりと使いやすさを先に書くと、判断しやすくなります。`,
      };
    case "skincare":
      return {
        focus: "保湿と継続",
        hashTag: "スキンケア",
        saleBody: "保湿と続けやすさが自分に合うか",
        saleBullet: "保湿感と継続のしやすさを見る",
        saleShort: "保湿と継続の観点",
        routineOpen: "保湿を続けやすいペースを大切にしたいです",
        routineBody: "保湿と継続のバランス",
        routineBullet: "保湿を無理なく続ける",
        routineShort: "保湿と継続",
        easeBullet: "続けやすさを優先する",
        easeShort: "頑張りすぎると続きにくいですよね",
        easeX1: "保湿と続けやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、保湿と継続の視点で見ると落ち着きます。`,
        x2: `${topic}は、保湿と「続けられるか」で選ぶと失敗しにくいです。`,
        x4: `${topic}の保湿感と継続のしやすさを先に書くと判断しやすいです。`,
      };
    default:
      return {
        focus: "自分に合うかの確認",
        hashTag: "美容メモ",
        saleBody: "自分に合いそうかを確認できるか",
        saleBullet: "自分の条件を先に決める",
        saleShort: "合う条件の観点",
        routineOpen: "自分のペースで取り入れられるかを大切にしたいです",
        routineBody: "自分に合うペース",
        routineBullet: "自分の条件をひとつ決める",
        routineShort: "自分のペース",
        easeBullet: "使いやすさを優先する",
        easeShort: "頑張りすぎると続きにくいですよね",
        easeX1: "毎日の使いやすさで選ぶと判断しやすいです。",
        th3Lead: `${topic}は、自分の条件から見ると迷いにくいです。`,
        x2: `${topic}は、自分の条件で選ぶと判断しやすいです。`,
        x4: `${topic}に求めることを先に書くと、判断しやすくなります。`,
      };
  }
}
