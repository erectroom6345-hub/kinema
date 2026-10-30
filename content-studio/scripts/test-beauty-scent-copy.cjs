#!/usr/bin/env node
/**
 * 美容香り3分岐（concrete / fragrance_free / unknown）
 */
const assert = require("assert");
const {
  classifyScentFromText,
  scentLineForCopy,
  extractPageCopyBlob,
} = require("./lib/beauty-scent-copy.cjs");
const { buildArticleCopy, toCatalogItem } = require("./lib/beauty-catalog-ingest.cjs");

// concrete: 具体ノート
{
  const r = classifyScentFromText("ホワイトフローラルの香りが特徴の化粧水");
  assert.strictEqual(r.kind, "concrete");
  assert.ok(/フローラル/.test(r.label), r.label);
  const line = scentLineForCopy(r, "fallback");
  assert.ok(/フローラル/.test(line), line);
  assert.ok(!/強め/.test(line), line);
}

// fragrance_free
{
  const r = classifyScentFromText("敏感肌向け。無香料。アルコールフリー。");
  assert.strictEqual(r.kind, "fragrance_free");
  const line = scentLineForCopy(r, "fallback");
  assert.ok(/無香料|フレグランス/.test(line), line);
}

// unknown: 曖昧語だけ → 書かない
{
  const r = classifyScentFromText("やさしい香りで毎日使いやすい美容液です");
  assert.strictEqual(r.kind, "unknown");
  const line = scentLineForCopy(r, "なじみのよさを見ています");
  assert.strictEqual(line, "なじみのよさを見ています");
  assert.ok(!/香りが強め|やさしい香り/.test(line), line);
}

// HTML blob からも concrete
{
  const html = `
    <html><head>
      <meta name="description" content="シトラスの香りが爽やかな化粧水" />
    </head><body><p>詳細</p></body></html>`;
  const blob = extractPageCopyBlob(html);
  const r = classifyScentFromText(blob);
  assert.strictEqual(r.kind, "concrete");
  assert.ok(/シトラス/.test(r.label), r.label);
}

// buildArticleCopy: concrete は香り軸、unknown は使用感軸
{
  const concrete = buildArticleCopy({
    brand: "hince",
    productName: "化粧水A",
    genre: "化粧水",
    scentKind: "concrete",
    scentLabel: "シトラス系",
  });
  assert.ok(/シトラス系/.test(concrete.articleBody), concrete.articleBody);
  assert.ok(/質感・香り/.test(concrete.articleBody), concrete.articleBody);

  const free = buildArticleCopy({
    brand: "hince",
    productName: "化粧水B",
    genre: "化粧水",
    scentKind: "fragrance_free",
  });
  assert.ok(/無香料|フレグランス/.test(free.articleBody), free.articleBody);

  const unknown = buildArticleCopy({
    brand: "hince",
    productName: "ニュー・ブラーティント",
    genre: "リップ",
  });
  assert.ok(!/やさしい香り|香りが強め|匂いが強め/.test(unknown.articleBody));
  assert.ok(/質感・使用感/.test(unknown.articleBody), unknown.articleBody);
  assert.ok(/向け/.test(unknown.articleBody), unknown.articleBody);
}

// toCatalogItem に scentKind が載る
{
  const item = toCatalogItem(
    {
      brand: "hince",
      productName: "セラム",
      productUrl: "https://hince.jp/c/category/skin/SERUM1",
      genre: "美容液",
      scentKind: "concrete",
      scentLabel: "グリーン／ティー系",
    },
    "evergreen",
  );
  assert.strictEqual(item.scentKind, "concrete");
  assert.strictEqual(item.scentLabel, "グリーン／ティー系");
  assert.ok(/グリーン/.test(item.articleBody), item.articleBody);
}

console.log("test-beauty-scent-copy: OK");
