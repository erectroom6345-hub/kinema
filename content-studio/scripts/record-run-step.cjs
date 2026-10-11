#!/usr/bin/env node
/**
 * run-beauty の STEP 結果を output/.run-steps.json に追記する。
 *   node scripts/record-run-step.cjs --n=1 --name=商品選択 --status=ok
 *   node scripts/record-run-step.cjs --n=7 --name=Threads投稿 --status=fail --error='...'
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const stepsPath = path.join(root, "output", ".run-steps.json");

function arg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "";
}

function main() {
  const n = Number(arg("--n") || arg("-n") || "0");
  const name = (arg("--name") || "").trim() || `step-${n}`;
  const status = (arg("--status") || "ok").trim();
  const error = (arg("--error") || "").trim();

  fs.mkdirSync(path.dirname(stepsPath), { recursive: true });
  let steps = {};
  try {
    if (fs.existsSync(stepsPath)) {
      steps = JSON.parse(fs.readFileSync(stepsPath, "utf8") || "{}");
    }
  } catch {
    steps = {};
  }

  const key = String(n || name);
  steps[key] = {
    n: Number.isFinite(n) ? n : undefined,
    name,
    status,
    ...(error ? { error } : {}),
    at: new Date().toISOString(),
  };
  fs.writeFileSync(stepsPath, `${JSON.stringify(steps, null, 2)}\n`, "utf8");
}

main();
