import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeArticle } from "../src/services/analyze.ts";
import { parseJobInput } from "../src/services/input.ts";

test("商品語が多い本文は商品紹介向きと判定する", () => {
  const analysis = analyzeArticle({
    title: "導入美容液のレビュー",
    topic: "美容液",
    genre: "beauty",
    body: "今回はおすすめ商品の口コミと価格、成分を整理します。",
  });
  assert.equal(analysis.is_product_oriented, true);
  assert.ok(analysis.title_candidates.length === 3);
});

test("悩み語が多い本文は悩み整理向きと判定する", () => {
  const analysis = analyzeArticle({
    title: "ゆらぎやすい時期の整え方",
    topic: "ゆらぎ肌",
    genre: "beauty",
    body: "よくある悩みの原因を整理し、習慣として続けやすいケアを考えます。",
  });
  assert.equal(analysis.is_product_oriented, false);
});

test("topic も title も body もない入力は拒否する", () => {
  assert.throws(() => parseJobInput({ blog_name: "x" }));
});
