import type { ArticleAnalysis, BlogDraft, ImageBundle, LlmClient } from "../types/index.ts";
import { TemplateLlmClient } from "../adapters/llm.ts";
import { buildBlogUserPrompt } from "../prompts/blog.ts";
import { buildPublicBody, publicBodyToHtml } from "../formatters/polish.ts";
import { toErrorMessage } from "../utils/errors.ts";

/** 本文が短すぎる／空のときの下限（これ未満はフォールバックへ） */
export const MIN_BLOG_BODY_CHARS = 800;

export type BlogGenerationSource = "ollama" | "fallback";

export interface BlogDraftWithSource extends BlogDraft {
  generationSource: BlogGenerationSource;
}

export async function createBlogDraft(params: {
  llm: LlmClient;
  title: string;
  topic: string;
  genre: string;
  sourceBody: string;
  analysis: ArticleAnalysis;
  images: ImageBundle;
  isPr: boolean;
  blogName: string;
}): Promise<BlogDraftWithSource> {
  const title = params.title || params.analysis.title_candidates[0] || params.topic;
  // 読者向けの自然見出し（構成ラベル「導入/本題/まとめ」は使わない）
  const outline = defaultOutline(params.analysis.is_product_oriented);
  const fallbackBody = buildFallbackBlogBody({
    title,
    topic: params.topic,
    genre: params.genre,
    sourceBody: params.sourceBody,
    analysis: params.analysis,
    isPr: params.isPr,
    blogName: params.blogName,
  });

  let generationSource: BlogGenerationSource = "fallback";
  let rawBody = fallbackBody;

  try {
    if (!(params.llm instanceof TemplateLlmClient)) {
      const generated = await params.llm.complete([
        {
          role: "user",
          content: buildBlogUserPrompt({
            title,
            topic: params.topic,
            sourceBody: params.sourceBody,
            outline,
            analysis: params.analysis,
            isPr: params.isPr,
          }),
        },
      ]);
      const cleaned = sanitizeBlogBody(buildPublicBody(stripEmojis(generated)), title);
      if (isUsableBlogBody(cleaned)) {
        rawBody = cleaned;
        generationSource = "ollama";
      }
    }
  } catch (error) {
    // Ollama不調でも止めない。フォールバックへ。
    console.warn(
      `Blogger本文: Ollama生成失敗のためフォールバックに切替: ${toErrorMessage(error)}`,
    );
  }

  if (generationSource === "fallback") {
    rawBody = sanitizeBlogBody(fallbackBody, title);
  }

  // 最終ガード: 空・極端な短文は絶対に出さない
  if (!isUsableBlogBody(rawBody)) {
    generationSource = "fallback";
    rawBody = sanitizeBlogBody(fallbackBody, title);
  }

  const publicBody = rawBody.trim() + "\n";
  return {
    title,
    outline,
    public_body: publicBody,
    body_markdown: publicBody,
    body_html: publicBodyToHtml(publicBody, outline),
    generationSource,
  };
}

/** 内部構成用。読者向け見出しは自然語のみ（導入/本題/まとめは使わない） */
export function defaultOutline(_productOriented: boolean): string[] {
  return ["気になりやすいところ", "選び方のヒント", "自分に合いそうかの目安"];
}

export function isUsableBlogBody(body: string): boolean {
  const text = body.trim();
  if (!text) return false;
  const chars = [...text].length;
  return chars >= MIN_BLOG_BODY_CHARS;
}

/** 構成ラベルや編集メモっぽい単独行を本文から除く */
export function sanitizeBlogBody(body: string, title: string): string {
  const bannedExact = new Set([
    "導入",
    "本題",
    "まとめ",
    "はじめに",
    "構成",
    "内部メモ",
    "参考メモ",
    "公開用本文",
  ]);

  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (bannedExact.has(line)) continue;
    if (/^(導入|本題|まとめ)([:：].*)?$/.test(line)) continue;
    if (/^\[.*(メモ|構成|内部).*\]$/.test(line)) continue;
    kept.push(raw);
  }

  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (title && !text.startsWith(title)) {
    text = `${title}\n\n${text}`;
  }
  return text;
}

/** Ollama不調時・template時に使う読みごたえのあるフォールバック本文 */
export function buildFallbackBlogBody(params: {
  title: string;
  topic: string;
  genre: string;
  sourceBody: string;
  analysis: ArticleAnalysis;
  isPr: boolean;
  blogName: string;
}): string {
  const genreKey = (params.genre || "").trim().toLowerCase();
  if (genreKey === "living" || genreKey === "暮らし便利グッズ") {
    return buildLivingFallbackBlogBody(params);
  }

  const prLine = params.isPr ? "※本記事にはPRを含みます。\n\n" : "";
  const memo = params.sourceBody.trim() || params.topic;
  const hook =
    params.analysis.suggested_hooks[0]?.trim() ||
    `${params.topic}で迷いやすいポイントを、自分のペースで整理してみます`;
  const hook2 =
    params.analysis.suggested_hooks[1]?.trim() ||
    "調べすぎて疲れる前に、条件をひとつ決めてから見るのがおすすめです";
  const hookSentence = /[。．!?！？]$/.test(hook) ? hook : `${hook}。`;
  const hook2Sentence = /[。．!?！？]$/.test(hook2) ? hook2 : `${hook2}。`;

  // 見出し語は出さず、段落の流れだけで導入→説明→締め
  const body = `${params.title}

${prLine}${params.topic}について調べ始めると、情報が多くて「結局自分には何が合いそうか」が分かりにくくなること、ありませんか。口コミや比較記事を読んでも、自分の生活リズムや肌・メイクのペースに合うかどうかまでは、すぐに判断しづらいものです。

忙しい朝や、少し気分を整えたいタイミングほど、短いメモだけだと判断材料が足りず、かえって迷いが増えることもあります。友人のすすめやランキングを見ても、自分の手つきや好みに落ちるとは限らないので、まずは「どんな場面で使いたいか」から考えると安心です。ここでは効果を断定したり急かしたりせず、選ぶ前の整理として${params.topic}を見る視点をやさしくまとめていきます。

${memo}

特徴を見るときは、見た目や第一印象だけでなく、使い心地・続けやすさ・取り入れやすさもセットで考えると選びやすいです。価格帯やブランドの印象だけで決めず、「自分の生活リズムに無理なく入りそうか」を先に置くと、あとから後悔しにくくなります。続くかどうかは、見た目の好みと同じくらい大切です。

選びやすい理由は、比較表を全部覚えることより、自分の条件をひとつ決めてから候補を絞ることです。たとえば毎日使うのか、週末のご褒美なのか、乾燥やゆらぎが気になる時期なのか。条件がはっきりすると、向いている人・向いていない人の線引きもしやすくなります。${hookSentence}

向いている人は、じっくり調べすぎて疲れやすい人や、まずは小さな一歩で整えたい人です。完璧な正解を探すより、今の自分に負担が少ない選択肢を残しておきたい人にも合いやすいです。反対に、特殊な処方や強い変化だけを求める場合は、別の切り口の方が参考になるかもしれません。

使うシーンとしては、朝の支度前に雰囲気を整えたいとき、外出前に一点だけ上質さを足したいとき、夜に負担を減らして続けたいときなどが想像しやすいです。同じアイテムでも、使う頻度や組み合わせ次第で印象が変わるので、「いつ・どのくらいの力感で使いたいか」を一緒に考えてみると判断が楽になります。

実際に候補を見るときは、パッケージや話題性だけでなく、自分の手に取る頻度・手入れの手間・他のアイテムとの相性も軽く想像してみてください。${hook2Sentence}そのうえで「今日の自分にちょうどよさそうか」を残しておくと、あとで読み返したときにも役立ちます。

もう一歩だけ具体的にするなら、「毎日のベースに足すのか」「特別な日のポイント使いにするのか」を先に決めると迷いが減ります。どちらでも構いませんが、役割がぼやけると選びにくくなるので、最初はどちらか一方に寄せて考えるのがおすすめです。

完璧な正解を探すより、「今の自分に無理なく続きそうか」で見ると判断しやすくなります。気になる点があれば、条件をひとつ書き出してから読み返してみてください。合う・合わないは人それぞれなので、今回の整理は答えの押し付けではなく、選ぶ前のメモとして使ってもらえたらうれしいです。

迷ったときは、特徴・向き不向き・使うシーンの3点だけ思い出せば十分です。長く悩むより、一度メモを置いて翌日に見直すくらいのペースでも大丈夫です。必要以上に急がず、自分のペースで選んでみてください。${params.blogName}では、その判断の軸だけ先に持ち帰れるようにしています。
`;

  return body.trim() + "\n";
}

function buildLivingFallbackBlogBody(params: {
  title: string;
  topic: string;
  sourceBody: string;
  analysis: ArticleAnalysis;
  isPr: boolean;
  blogName: string;
}): string {
  const prLine = params.isPr ? "※本記事にはPRを含みます。\n\n" : "";
  const memo = params.sourceBody.trim() || params.topic;
  const hook =
    params.analysis.suggested_hooks[0]?.trim() ||
    `${params.topic}を暮らしの導線で見直すときのメモです`;
  const hook2 =
    params.analysis.suggested_hooks[1]?.trim() ||
    "比較しすぎる前に、置き場所と使い方をひとつ決めると迷いが減ります";
  const hookSentence = /[。．!?！？]$/.test(hook) ? hook : `${hook}。`;
  const hook2Sentence = /[。．!?！？]$/.test(hook2) ? hook2 : `${hook2}。`;

  const body = `${params.title}

${prLine}${params.topic}を探し始めると、似た商品が多くて「結局どれが自分の暮らしに合いそうか」が分かりにくくなること、ありませんか。口コミやランキングを見ても、収納スペースや家事のペースまではすぐに判断しづらいものです。

忙しい朝や、買い出し後の片付けなど、短いメモだけだと判断材料が足りず、かえって迷いが増えることもあります。ここでは効果を断定したり急かしたりせず、選ぶ前の整理として${params.topic}を見る視点をやさしくまとめていきます。

${memo}

特徴を見るときは、見た目だけでなく、置きやすさ・開け閉めのしやすさ・掃除や片付けの手間もセットで考えると選びやすいです。価格帯だけで決めず、「毎日の動線に無理なく入りそうか」を先に置くと、あとから後悔しにくくなります。

選びやすい理由は、スペックを全部覚えることより、自分の条件をひとつ決めてから候補を絞ることです。たとえばキッチンか玄関か、毎日使うのか週末だけなのか。条件がはっきりすると、向いている人・向いていない人の線引きもしやすくなります。${hookSentence}

向いている人は、調べすぎて疲れやすい人や、まずは小さな改善から整えたい人です。完璧な正解を探すより、今の暮らしに負担が少ない選択肢を残しておきたい人にも合いやすいです。反対に、特殊な用途だけを求める場合は、別の切り口の方が参考になるかもしれません。

使うシーンとしては、朝の支度前にさっと取りたいとき、帰宅後にすぐ片付けたいとき、週末にまとめて整えたいときなどが想像しやすいです。同じアイテムでも、置き場所や組み合わせ次第で印象が変わるので、「いつ・どこで使いたいか」を一緒に考えてみると判断が楽になります。

実際に候補を見るときは、話題性だけでなく、手に取る頻度・手入れの手間・他の道具との相性も軽く想像してみてください。${hook2Sentence}そのうえで「今日の暮らしにちょうどよさそうか」を残しておくと、あとで読み返したときにも役立ちます。

完璧な正解を探すより、「今の自分の動線に無理なく続きそうか」で見ると判断しやすくなります。気になる点があれば、条件をひとつ書き出してから読み返してみてください。合う・合わないは人それぞれなので、今回の整理は答えの押し付けではなく、選ぶ前のメモとして使ってもらえたらうれしいです。

迷ったときは、特徴・向き不向き・使うシーンの3点だけ思い出せば十分です。長く悩むより、一度メモを置いて翌日に見直すくらいのペースでも大丈夫です。${params.blogName}では、その判断の軸だけ先に持ち帰れるようにしています。
`;

  return body.trim() + "\n";
}

export function stripEmojis(value: string): string {
  return value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/[✅✨🔥❤💕😊🙂🙏💡📌]/g, "");
}
