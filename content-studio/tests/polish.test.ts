import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicBody, sanitizeScripts } from "../src/formatters/polish.ts";

test("公開用本文から # と内部メモと画像情報を除去する", () => {
  const input = `# ゆらぎやすい時期の導入美容液

## はじめに

導入です。

ブログ下書き
公開用本文
画像メタデータ
タイトル案
画像キーワード
理由
Instagram
source: memo
reference: x
tempted

![woman](https://pixabay.com/get/hero.jpg)
*Image by Demo from Pixabay*
## 画像
- pixabay: https://example.com/a.jpg

## Day 1
1本目

1. 短い
2. 続く番号

## まとめ

終わりです。
`;

  const result = buildPublicBody(input);
  assert.doesNotMatch(result, /^#/m);
  assert.doesNotMatch(result, /##/);
  assert.doesNotMatch(result, /https?:\/\//);
  assert.doesNotMatch(result, /Image by/);
  assert.doesNotMatch(result, /Pixabay/i);
  assert.doesNotMatch(result, /!\[/);
  assert.doesNotMatch(result, /ブログ下書き/);
  assert.doesNotMatch(result, /画像メタデータ/);
  assert.doesNotMatch(result, /^タイトル案$/m);
  assert.doesNotMatch(result, /Instagram/);
  assert.doesNotMatch(result, /tempted/i);
  assert.doesNotMatch(result, /Day 1/);
  assert.doesNotMatch(result, /1本目/);
  assert.match(result, /^ゆらぎやすい時期の導入美容液$/m);
  assert.match(result, /^はじめに$/m);
  assert.match(result, /導入です/);
  assert.match(result, /^まとめ$/m);
  assert.ok(!/\n{3,}/.test(result));
});

test("内部ラベル行は公開用本文から除外する", () => {
  const input = `ゆらぎ肌の整え方

プレビュー
入力サマリー
解析
公開用本文
----- 公開用本文 -----
画像メタデータ
画像メタデータ（本文外）
本文外
Instagram
Threads
タイトル案
画像キーワード
理由
公開用本文ここまで

はじめに

導入です。

まとめ

終わりです。
`;

  const result = buildPublicBody(input);
  for (const label of [
    "プレビュー",
    "入力サマリー",
    "解析",
    "公開用本文",
    "画像メタデータ",
    "本文外",
    "Instagram",
    "Threads",
    "タイトル案",
    "画像キーワード",
    "理由",
    "公開用本文ここまで",
  ]) {
    assert.doesNotMatch(result, new RegExp(`^${label}`, "m"));
    assert.equal(result.includes(label), false, `should not include: ${label}`);
  }
  assert.match(result, /^ゆらぎ肌の整え方$/m);
  assert.match(result, /^はじめに$/m);
  assert.match(result, /導入です/);
  assert.match(result, /^まとめ$/m);
});

test("アラビア・キリル断片と不要な単独英単語を除去し商品名は残す", () => {
  const input = `ゆらぎ肌の整え方

はじめに

季節の変わり目は肌がゆらぎやすいものです。 مرحبا そんなときは保湿を優先しましょう。
Привет 続けやすいケアが大切です。 tempted 焦らないのがポイントです。

مرحبا بكم
Привет мир
debug

日焼け止めは SPF30 や PA+++ を目安に選ぶと安心です。

まとめ

終わりです。
`;

  const result = buildPublicBody(input);
  assert.doesNotMatch(result, /\p{Script=Arabic}/u);
  assert.doesNotMatch(result, /\p{Script=Cyrillic}/u);
  assert.doesNotMatch(result, /\btempted\b/i);
  assert.doesNotMatch(result, /^debug$/m);
  assert.doesNotMatch(result, /مرحبا/);
  assert.doesNotMatch(result, /Привет/);
  assert.match(result, /SPF30/);
  assert.match(result, /PA\+\+\+/);
  assert.match(result, /保湿を優先/);
  assert.match(result, /続けやすいケア/);
});

test("sanitizeScripts は日本語文中の異種文字だけ落とす", () => {
  assert.equal(sanitizeScripts("保湿ケア مرحبا を続けます。"), "保湿ケア を続けます。");
  assert.equal(sanitizeScripts("肌を整える Привет 習慣"), "肌を整える 習慣");
  assert.equal(sanitizeScripts("SPF30を使う"), "SPF30を使う");
});

test("境界内の本文見出しと段落は残し分量を保つ", () => {
  const input = `[内部レポート]

[内部] 入力サマリー
- ブログ: Beauty Notes

[公開本文のみ / 開始]
ゆらぎやすい時期の導入美容液

はじめに

季節の変わり目は、肌の調子を崩しやすいものです。
毎日のスキンケアを見直すきっかけにしてみましょう。

よくあるつまずき

いきなり高価な美容液に手を出すと、続けにくくなることがあります。
まずは自分の肌の状態を観察することが大切です。

考え方の整理

保湿と刺激の少なさ、続けやすさを分けて考えると迷いが減ります。
完璧を目指すより、負担の少ない選択を残しましょう。

今日からできること

洗顔後すぐに保湿を丁寧に行いましょう。
無理のない範囲で紫外線対策も続けてみましょう。

まとめ

ゆらぎやすい時期は、優しく見守るケアが大切です。
焦らず、自分に合うペースで整えていきましょう。
[公開本文のみ / 終了]

[内部] 画像情報
Instagram
Threads
`;

  const result = buildPublicBody(input);
  assert.match(result, /^はじめに$/m);
  assert.match(result, /^よくあるつまずき$/m);
  assert.match(result, /^考え方の整理$/m);
  assert.match(result, /^今日からできること$/m);
  assert.match(result, /^まとめ$/m);
  assert.match(result, /季節の変わり目/);
  assert.match(result, /保湿と刺激の少なさ/);
  assert.match(result, /洗顔後すぐに保湿/);
  assert.match(result, /優しく見守るケア/);
  assert.doesNotMatch(result, /公開本文のみ/);
  assert.doesNotMatch(result, /入力サマリー/);
  assert.doesNotMatch(result, /Instagram/);
  assert.ok(result.replace(/\s+/g, "").length >= 200);
});
