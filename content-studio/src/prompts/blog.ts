import { resolveGenreProfile } from "../config/genres.ts";

export const OLLAMA_BLOG_PREFIX = `あなたは日本の読者向けに美容ブログを書く編集者です。
自然な日本語で書いてください。
読者にやさしく話しかける文体にしてください。
説明書のような硬い表現は避けてください。
ですます調で統一してください。
1文は読みやすい長さにしてください。短文だけで終わらせず、具体例や場面を足して厚みを出してください。
見出し記号 # は使わないでください。
Markdown記法は使わないでください。
URL、画像リンク、画像クレジットは本文に書かないでください。
英語の見出しや Day 1 のような表現は使わないでください。
「導入」「本題」「まとめ」という語は本文に書かないでください。
編集メモ、内部指示、構成ラベルは本文に出さないでください。
箇条書きではなく、ブログ本文として自然な文章で書いてください。
Instagramの短い投稿文より、明らかに情報量が多い記事にしてください。
前置き、補足、言い訳、内部メモは書かないでください。
そのまま公開できる本文だけを書いてください。`;

export function buildBlogSystemPrompt(genre?: string): string {
  const profile = resolveGenreProfile(genre);
  return `あなたは${profile.label}を含む複数ジャンルに対応する日本語ブログ編集者です。
公開用の本文だけを書きます。
制約:
- 本文に絵文字は使わない
- です・ます調
- ${profile.caution}
- 押し売りしない
- 見出し記号 # や Markdown は使わない
- 「導入」「本題」「まとめ」などの構成ラベルは本文に書かない
- Instagram向けの短い文より、読みごたえのある長さにする`;
}

export function buildBlogUserPrompt(params: {
  title: string;
  topic: string;
  sourceBody: string;
  outline: string[];
  analysis: { is_product_oriented: boolean; suggested_hooks: string[] };
  isPr: boolean;
}): string {
  const source = params.sourceBody
    ? `参考メモ（短くてよい。これを膨らませて詳しく書く。メモ自体は本文にコピペしない）:\n${params.sourceBody.slice(0, 1200)}`
    : "参考メモはありません。テーマから新規の下書きを書いてください。";

  return `次の条件で、公開用のブログ本文だけを書いてください。Markdownは使わないでください。

1行目はタイトルだけを書いてください（# は付けない）。
タイトル: ${params.title}

テーマは「${params.topic}」です。
記事の向きは「${params.analysis.is_product_oriented ? "商品紹介寄り" : "悩み整理寄り"}」です。
PR表記は${params.isPr ? "必要です。タイトルの直後に「※本記事にはPRを含みます。」と1行入れてください" : "不要です"}。

内部構成（このラベル名は本文に出さない）:
1. 冒頭: 読者の悩みや使う場面を自然な段落で書く
2. 中盤: 商品の特徴、選びやすい理由、向いている人、使うシーンを具体的に書く
3. 締め: 読者が自分に合うか判断しやすい一文で閉じる

見出しを使う場合は、自然な日本語だけにしてください（例: 「気になりやすいところ」「選び方のヒント」）。
「導入」「本題」「まとめ」という語は絶対に書かないでください。

読者に伝えたい切り口のヒント:
${params.analysis.suggested_hooks.join(" / ")}

${source}

分量の目安:
- 全体でおおよそ 1500〜2400字（日本語）
- 内容を増やして自然に厚みを出す（不自然な引き延ばしは禁止）
- Instagramのキャプションより明らかに情報量を多くする

URL・画像・クレジット・箇条書き・内部メモは入れないでください。
そのまま公開できる本文だけを出力してください。`;
}
