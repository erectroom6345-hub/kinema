import { resolveGenreProfile } from "../config/genres.ts";

export function buildSnsSystemPrompt(genre?: string): string {
  const profile = resolveGenreProfile(genre);
  return `あなたは日本語のSNS編集者です。対象は Instagram / Threads / X です。
美容アカウント向けの親しみやすい女性っぽい文体を基本にしてください。
少し会話っぽくしつつ、幼い口語は避け、落ち着いた大人っぽさを残してください。
断定しすぎず、押し売り感は禁止です。共感から入り、「わかる」と思いやすい冒頭にしてください。
${profile.caution}
JSONのみ返してください。形式:
{"instagram":{"caption":""},"threads":["","",""],"x":["","","","","","",""]}`;
}

export function buildSnsUserPrompt(params: {
  title: string;
  topic: string;
  genre: string;
  analysis: { is_product_oriented: boolean; suggested_hooks: string[] };
  articleUrl: string;
  isPr: boolean;
}): string {
  return `タイトル: ${params.title}
テーマ: ${params.topic}
ジャンル: ${params.genre}
PR: ${params.isPr}
記事URL: ${params.articleUrl || "(未設定。無理にURLを作らない)"}
タイプ: ${params.analysis.is_product_oriented ? "商品紹介寄り" : "悩み整理寄り"}
フック: ${params.analysis.suggested_hooks.join(" / ")}

Instagram（1案・長さは普通）:
- 冒頭1文は共感ベース
- 幼い口語（〜ちゃった / ない？ / 〜だよ など）は避ける
- 親しみやすさの中に、落ち着いた大人っぽさを残す
- 保存したくなる一言を入れる
- 絵文字は2〜3個。文頭に固めない
- PRが true のときだけ、文末にさりげなく ※PR

Threads（3案・切り口を変える）:
- Instagramより少しラフで自然にするが、独り言すぎず上品さを残す
- 1文は短めにし、読み流しやすいテンポにする
- 冒頭は共感ベース
- 絵文字は各案2〜3個。文頭に固めない
- PRが true のときだけ、各案の文末にさりげなく ※PR

Xは短文7本。重複を避け、URLは不自然に連投しない。最後の1本だけURLを添えてよい。`;
}
