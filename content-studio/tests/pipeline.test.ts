import assert from "node:assert/strict";
import { test } from "node:test";
import { TemplateLlmClient } from "../src/adapters/llm.ts";
import { runPipeline } from "../src/services/pipeline.ts";
import type { StockImageAdapter } from "../src/types/index.ts";

const llm = new TemplateLlmClient();

const stock: StockImageAdapter = {
  name: "pixabay",
  async search(query) {
    if (query.query.includes("skincare") || query.query.includes("soft") || query.query.includes("natural")) {
      return [
        {
          source: "pixabay",
          url: "https://cdn.example/hero.jpg",
          alt: "skincare",
          credit: "Image by Demo from Pixabay",
          query: query.query,
        },
      ];
    }
    return [
      {
        source: "pixabay",
        url: "https://cdn.example/inline.jpg",
        alt: "notes",
        credit: "Image by Demo from Pixabay",
        query: query.query,
      },
    ];
  },
};

test("パイプラインは JSON 仕様のキーを返す", async () => {
  const result = await runPipeline(
    {
      blog_name: "Beauty Notes",
      topic: "導入美容液の選び方",
      genre: "beauty",
      is_pr: true,
      article_url: "https://example.blogspot.com/serum",
    },
    { llm, stock },
  );

  assert.ok(result.input_summary.topic);
  assert.equal(typeof result.analysis.is_product_oriented, "boolean");
  assert.ok(result.blog_draft.public_body.includes("※本記事にはPRを含みます"));
  assert.equal(result.blog_draft.public_body, result.blog_draft.body_markdown);
  assert.doesNotMatch(result.blog_draft.public_body, /^#/m);
  assert.doesNotMatch(result.blog_draft.public_body, /https?:\/\//);
  assert.equal(result.images.hero.url, "https://cdn.example/hero.jpg");
  assert.equal(result.outputs.threads.length, 3);
  assert.equal(result.outputs.x.length, 7);
  assert.match(result.blog_draft.body_html, /<h1>/);
});

test("画像アダプタが空でも記事生成は続行する", async () => {
  const emptyStock: StockImageAdapter = {
    name: "pixabay",
    async search() {
      return [];
    },
  };
  const result = await runPipeline(
    {
      topic: "乾燥が気になる日の習慣",
      genre: "beauty",
      article_title: "乾燥が気になる日に先に整えたいこと",
    },
    { llm, stock: emptyStock },
  );
  assert.equal(result.images.hero.url, "");
  assert.ok(result.blog_draft.public_body.length > 20);
});
