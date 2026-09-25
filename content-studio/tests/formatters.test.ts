import assert from "node:assert/strict";
import { test } from "node:test";
import { insertImages, markdownToHtml } from "../src/formatters/html.ts";
import { stripEmojis } from "../src/services/blog.ts";
import { buildFallbackSns } from "../src/services/sns.ts";

test("本文から絵文字を除去する", () => {
  assert.equal(stripEmojis("こんにちは✨ 今日のケア"), "こんにちは 今日のケア");
});

test("insertImages は互換用に残す（本文には混ぜない方針）", () => {
  const markdown = `# タイトル\n\n## はじめに\n\n本文1\n\n## 中盤\n\n本文2\n\n## まとめ\n\n本文3\n`;
  const result = insertImages(markdown, {
    hero: {
      source: "pixabay",
      url: "https://example.com/hero.jpg",
      alt: "雰囲気",
      credit: "Image by A from Pixabay",
    },
    inline: [
      {
        source: "pixabay",
        url: "https://example.com/inline.jpg",
        alt: "整理",
        credit: "Image by B from Pixabay",
      },
    ],
  });
  assert.match(result, /hero\.jpg/);
});

test("Markdown を簡易 HTML に変換する", () => {
  const html = markdownToHtml("# 見出し\n\n本文です\n");
  assert.match(html, /<h1>見出し<\/h1>/);
  assert.match(html, /<p>本文です<\/p>/);
});

test("X は7本、Threads は3案を返す", () => {
  const sns = buildFallbackSns({
    title: "乾燥ケアの整理",
    topic: "乾燥",
    analysis: {
      is_product_oriented: false,
      reason: "",
      suggested_hooks: ["よくある悩みから入る"],
      image_keywords: [],
      title_candidates: [],
      tone: "concern",
    },
    articleUrl: "https://example.blogspot.com/post",
    isPr: true,
  });
  assert.equal(sns.threads.length, 3);
  assert.equal(sns.x.length, 7);
  assert.match(sns.x[6] ?? "", /https:\/\/example.blogspot.com\/post/);
  assert.match(sns.instagram.caption, /疲れてしまうこと、ありませんか/);
  assert.match(sns.instagram.caption, /保存して/);
  assert.match(sns.instagram.caption, /※PR\s*$/);
  assert.doesNotMatch(sns.instagram.caption, /疲れちゃった|ない？|あるよ|うれしいな/);
  assert.doesNotMatch(sns.instagram.caption, /^[^\n]*※PR/);
  assert.match(sns.threads[0] ?? "", /正解を探しすぎて|ありませんか/);
  assert.match(sns.threads[0] ?? "", /※PR\s*$/);
  assert.doesNotMatch(sns.threads[0] ?? "", /なんか最近|止まっちゃう|置いておくね/);
  assert.match(sns.threads[0] ?? "", /？💭 .+/);
});
