import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlannedImageRefs,
  findMissingSocialDrafts,
  formatImageMetadataJson,
  formatInstagramBodyText,
  formatPostingSummaryMarkdown,
  formatPublicPreview,
  formatRunStamp,
  formatSocialDraftsMarkdown,
  formatSocialPreview,
  formatThreadsBodyText,
  formatXBodyText,
  getPublicBodyText,
  resolveInstagramFixedImage,
} from "../src/formatters/outputs.ts";
import type { ArticleJobResult } from "../src/types/index.ts";

const sample: ArticleJobResult = {
  input_summary: {
    blog_name: "Beauty Notes",
    blog_url: "",
    article_url: "",
    article_title: "ゆらぎ肌の整え方",
    topic: "serum habit",
    genre: "beauty",
    is_pr: false,
    publish_date: "",
    has_source_body: false,
  },
  analysis: {
    is_product_oriented: false,
    reason: "x",
    suggested_hooks: [],
    image_keywords: [],
    title_candidates: [],
    tone: "concern",
  },
  blog_draft: {
    title: "ゆらぎ肌の整え方",
    outline: ["はじめに", "まとめ"],
    body_markdown: "ゆらぎ肌の整え方\n\nはじめに\n\n本文です。\n",
    body_html: "<h1>ゆらぎ肌の整え方</h1>",
    public_body:
      "ゆらぎ肌の整え方\n\nはじめに\n\n季節の変わり目は肌がゆらぎやすいものです。\n毎日のケアを見直してみましょう。\n\nまとめ\n\n終わりです。\n",
  },
  images: {
    hero: {
      source: "pixabay",
      url: "https://example.com/hero.jpg",
      alt: "hero",
      credit: "Image by A from Pixabay",
    },
    inline: [
      {
        source: "pixabay",
        url: "https://example.com/inline.jpg",
        alt: "inline",
        credit: "Image by B from Pixabay",
      },
    ],
  },
  outputs: {
    instagram: { caption: "保存用メモです #ゆらぎ肌 #整理ノート" },
    threads: ["案1本文です。会話寄りに書きます。"],
    x: ["Day1本文です。短く要点をまとめます。"],
  },
};

test("公開本文・画像・SNSのフォーマットが分離される", () => {
  const publicBody = getPublicBodyText(sample);
  const images = formatImageMetadataJson(sample.images);
  const social = formatSocialDraftsMarkdown(sample.outputs, sample.input_summary.topic);

  assert.match(publicBody, /ゆらぎ肌の整え方/);
  assert.doesNotMatch(publicBody, /Instagram/);
  assert.doesNotMatch(publicBody, /https?:\/\//);

  assert.match(images, /hero\.jpg/);
  assert.match(images, /Image by A from Pixabay/);
  assert.doesNotMatch(images, /はじめに/);

  assert.match(social, /^Instagram$/m);
  assert.match(social, /^Threads$/m);
  assert.match(social, /^X$/m);
  assert.match(social, /ハッシュタグ候補/);
  assert.match(social, /#ゆらぎ肌/);
  assert.doesNotMatch(social, /はじめに/);
});

test("ターミナル preview は public / social を短く分けて出す", () => {
  const publicPreview = formatPublicPreview(sample);
  const socialPreview = formatSocialPreview(sample.outputs);

  assert.match(publicPreview, /タイトル:/);
  assert.match(publicPreview, /はじめに:/);
  assert.match(publicPreview, /季節の変わり目/);
  assert.doesNotMatch(publicPreview, /Instagram/);

  assert.match(socialPreview, /^Instagram$/m);
  assert.match(socialPreview, /^Threads$/m);
  assert.match(socialPreview, /^X$/m);
  assert.match(socialPreview, /保存用メモ/);
  assert.match(socialPreview, /案1本文/);
  assert.match(socialPreview, /Day1本文/);
});

test("SNS欠落を検出できる", () => {
  assert.deepEqual(findMissingSocialDrafts(sample.outputs), []);
  assert.deepEqual(
    findMissingSocialDrafts({
      instagram: { caption: "" },
      threads: [],
      x: ["ある"],
    }),
    ["Instagram", "Threads"],
  );
});

test("投稿用本文はコピペしやすい本文のみになる", () => {
  const ig = formatInstagramBodyText(sample.outputs);
  const threads = formatThreadsBodyText({
    ...sample.outputs,
    threads: ["案1本文", "案2本文"],
  });
  const x = formatXBodyText({
    ...sample.outputs,
    x: ["1本目", "2本目"],
  });

  assert.equal(ig.trim(), "保存用メモです #ゆらぎ肌 #整理ノート");
  assert.doesNotMatch(ig, /Instagram|案\d|ハッシュタグ候補/);
  assert.equal(threads.trim(), "案1本文\n\n案2本文");
  assert.equal(x.trim(), "1本目\n\n2本目");
});

test("実行日時スタンプと投稿まとめ markdown を生成できる", () => {
  const generatedAt = new Date(2026, 8, 20, 9, 0, 0);
  assert.equal(formatRunStamp(generatedAt), "2026-09-20-0900");

  const planned = buildPlannedImageRefs(sample.images, "/tmp/output", "2026-09-20-0900");
  assert.deepEqual(
    planned.map((item) => item.fileName),
    ["2026-09-20-0900-hero.jpg", "2026-09-20-0900-inline-1.jpg"],
  );
  assert.equal(planned[0].path, "/tmp/output/2026-09-20-0900-hero.jpg");

  const summary = formatPostingSummaryMarkdown({
    result: sample,
    generatedAt,
    savedFileNames: ["2026-09-20-0900-summary.md", "2026-09-20-0900-instagram.txt"],
    plannedImages: planned,
    instagramImage: {
      mode: "fixed",
      fileName: "instagram-fixed.jpg",
      path: "/tmp/content-studio/assets/instagram-fixed.jpg",
      reason: "fallback to fixed image",
    },
  });

  assert.match(summary, /^# 投稿まとめ/m);
  assert.match(summary, /## 生成日時/);
  assert.match(summary, /2026-09-20 09:00/);
  assert.match(summary, /## ブログタイトル/);
  assert.match(summary, /## public preview/);
  assert.match(summary, /## Instagram本文/);
  assert.match(summary, /## Threads本文/);
  assert.match(summary, /## X本文/);
  assert.match(summary, /## Instagram画像モード/);
  assert.match(summary, /^fixed$/m);
  assert.match(summary, /## Instagram使用画像ファイル名/);
  assert.match(summary, /instagram-fixed\.jpg/);
  assert.match(summary, /## Instagram画像判定理由/);
  assert.match(summary, /fallback to fixed image/);
  assert.match(summary, /## Instagram使用画像パス/);
  assert.doesNotMatch(summary, /## Instagram固定画像名|## 画像タイトル案/);
  assert.match(summary, /## 保存ファイル名一覧/);
  assert.match(summary, /## 使用予定の画像ファイル名/);
  assert.match(summary, /## 使用予定の画像パス/);
  assert.match(summary, /2026-09-20-0900-hero\.jpg/);
  assert.doesNotMatch(summary, /Image by A from Pixabay/);
});

test("Instagram固定画像パスを解決できる", () => {
  const resolved = resolveInstagramFixedImage("assets/instagram-fixed.jpg", "/project/content-studio");
  assert.equal(resolved.fileName, "instagram-fixed.jpg");
  assert.equal(resolved.path, "/project/content-studio/assets/instagram-fixed.jpg");
});
