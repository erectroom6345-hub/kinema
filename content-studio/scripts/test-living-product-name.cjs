#!/usr/bin/env node
const assert = require("assert");
const { cleanLivingProductName } = require("./lib/living-product-name.cjs");

const cases = [
  {
    in: "全店限定価格◎【MAX38%OFF】 【圧倒的レビュー数&高評価】 トラベルポーチ 吊り下げ 旅行 レディース 便利グッズ ポーチ 4in1 コスメポーチ セッ",
    like: /トラベルポーチ/,
    unlike: /MAX38|圧倒的|全店限定/,
  },
  {
    in: "【楽天総合1位】 スターフィルター 換気扇フィルター レンジフードフィルター レンジフィルターカバー スターターセット",
    like: /スターフィルター|換気扇フィルター|フィルター/,
    unlike: /楽天総合|1位/,
  },
  {
    in: "【訳あり福袋10】日用品・B級アウトレット　お試しサンプル＆現品　詰合せセット袋詰め 約10点入り",
    like: /日用品|詰合せ|セット|サンプル/,
    unlike: /訳あり福袋|B級アウトレット/,
  },
  {
    in: "＼早く買えば良かった！／グリル専用焼き魚トレー ワイド 28×20cm 大型 マーブルコート",
    like: /焼き魚トレー|グリル/,
    unlike: /早く買えば/,
  },
];

for (const c of cases) {
  const out = cleanLivingProductName(c.in, { maxLen: 28 });
  assert.ok(out.length > 0 && out.length <= 28, `len ${out}`);
  assert.match(out, c.like, `like fail: ${out}`);
  assert.doesNotMatch(out, c.unlike, `unlike fail: ${out}`);
  console.log(`OK ${JSON.stringify(out)}`);
}

console.log("living-product-name tests passed");
