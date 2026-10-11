#!/usr/bin/env node
/**
 * ポリシーチェッカーの動作確認（投稿はしない）。
 *   node scripts/test-policy-check.cjs
 */
const { checkTexts } = require("./lib/policy-check.cjs");

const cases = [
  {
    name: "正常通過",
    expect: "ok",
    text: "毎日のメイクに少し上質なアイテムを入れると、全体の雰囲気が整いやすいです。",
  },
  {
    name: "warn（誇大）",
    expect: "warn",
    text: "このセラムは最強の保湿感で、朝の仕上がりが変わりやすいです。",
  },
  {
    name: "block（効果断定）",
    expect: "block",
    text: "このクリームは必ず治るので、シミが気になる人に絶対おすすめです。",
  },
  {
    name: "block（不安煽り）",
    expect: "block",
    text: "今すぐやらないと危険です。放置すると終わりなので今日中に試して。",
  },
];

let failed = 0;
console.log("policy test cases");
console.log("-----------------");
for (const c of cases) {
  const r = checkTexts([{ name: "sample", text: c.text }], {
    productId: "policy-test",
    channel: "policy-test",
  });
  const ok = r.result === c.expect;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name}: expect=${c.expect} got=${r.result}` +
      (r.matchedRules.length
        ? `  matches=${r.matchedRules.map((m) => m.pattern || m.id).join("|")}`
        : ""),
  );
}

console.log("-----------------");
if (failed) {
  console.error(`failed: ${failed}`);
  process.exit(1);
}
console.log("all passed");
console.log("");
console.log("手動確認例:");
console.log("  node scripts/check-policy.cjs --text='必ず治るセラム' --fail-on-block");
console.log("  node scripts/check-policy.cjs --text='最強の保湿'");
console.log("  node scripts/check-policy.cjs --text='毎日使いやすいコスメ'");
console.log("  node scripts/check-policy.cjs --phase=social");
