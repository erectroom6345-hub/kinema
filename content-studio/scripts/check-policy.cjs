#!/usr/bin/env node
/**
 * 投稿前ポリシーチェック CLI
 *
 *   node scripts/check-policy.cjs
 *   node scripts/check-policy.cjs --phase=article --fail-on-block
 *   node scripts/check-policy.cjs --phase=social --fail-on-block
 *   node scripts/check-policy.cjs --text='必ず治るセラム' --fail-on-block
 *
 * exit: 0=ok/warn（--fail-on-block 時は warn も 0）, 2=block, 1=実行エラー
 */
const fs = require("fs");
const path = require("path");
const {
  checkTexts,
  collectBeautyTexts,
  defaultRulesPath,
} = require("./lib/policy-check.cjs");

const root = path.join(__dirname, "..");
const policyDir = path.join(root, "output", "policy");
const lastPath = path.join(policyDir, "last-policy-check.json");
const historyPath = path.join(policyDir, "policy-history.jsonl");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function saveResult(result) {
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(lastPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify(result)}\n`, "utf8");
}

function printResult(result) {
  console.log("---- ポリシーチェック ----");
  console.log(`result=${result.result} productId=${result.productId || "-"}`);
  console.log(`channel=${result.channel} engine=${result.engine}`);
  console.log(`sources=${(result.textSources || []).join(", ") || "(empty)"}`);
  if (result.matchedRules.length === 0) {
    console.log("matchedRules: (なし)");
  } else {
    console.log("matchedRules:");
    for (const m of result.matchedRules) {
      console.log(
        `  [${m.severity}] ${m.id}  in=${(m.matchedIn || []).join("|") || "-"}`,
      );
    }
  }
  if (result.checkedTextPreview) {
    console.log("--- preview ---");
    console.log(result.checkedTextPreview);
    console.log("---------------");
  }
  console.log(`保存: ${lastPath}`);
}

function main() {
  const phase = (arg("--phase") || "all").trim();
  const channel = (arg("--channel") || "beauty-pipeline").trim();
  const failOnBlock =
    hasFlag("--fail-on-block") ||
    String(process.env.POLICY_FAIL_ON_BLOCK || "").toLowerCase() === "true";
  const inlineText = arg("--text");
  const rulesPath = arg("--rules") || defaultRulesPath;

  if (String(process.env.POLICY_CHECK_DISABLED || "").toLowerCase() === "true") {
    const skipped = {
      checkedAt: new Date().toISOString(),
      productId: null,
      channel,
      result: "ok",
      matchedRules: [],
      checkedTextPreview: "(POLICY_CHECK_DISABLED=true)",
      engine: "disabled",
      rulesVersion: null,
      textSources: [],
      skipped: true,
    };
    saveResult(skipped);
    printResult(skipped);
    console.log("ポリシーチェック無効化のためスキップ");
    return;
  }

  let result;
  if (inlineText) {
    result = checkTexts([{ name: "inline", text: inlineText }], {
      productId: arg("--productId") || "inline",
      channel,
      rulesPath,
    });
  } else {
    const collected = collectBeautyTexts(root, phase);
    result = checkTexts(collected.texts, {
      productId: collected.productId,
      channel,
      rulesPath,
    });
    result.phase = phase;
  }

  saveResult(result);
  printResult(result);

  if (result.result === "block") {
    console.error(
      `ポリシー block: ${result.matchedRules
        .filter((m) => m.severity === "block")
        .map((m) => m.pattern || m.id)
        .join(", ")}`,
    );
    if (failOnBlock) process.exit(2);
  } else if (result.result === "warn") {
    console.warn(
      `ポリシー warn（投稿は続行）: ${result.matchedRules
        .filter((m) => m.severity === "warn")
        .map((m) => m.pattern || m.id)
        .join(", ")}`,
    );
  } else {
    console.log("ポリシー ok");
  }
}

main();
