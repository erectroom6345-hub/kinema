#!/usr/bin/env node
/**
 * 4パターン確認:
 *  1) 本番モード正常系（未投稿あり）
 *  2) 未投稿0件時（停止・recycle に入らない）
 *  3) recycle 手動実行
 *  4) test mode が本番日次に混在 → 即拒否
 */
const { spawnSync } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "selectBeautyProduct.cjs");
const runtime = path.join(__dirname, "lib", "beauty-runtime.cjs");
const root = path.join(__dirname, "..");

function cleanProdEnv(extra = {}) {
  return {
    ...process.env,
    CONTENT_STUDIO_ENV: "production",
    BEAUTY_PIPELINE_MODE: "daily",
    BEAUTY_TEST_MODE: "",
    BEAUTY_ALLOW_RECYCLE: "",
    BEAUTY_USE_REPOST: "",
    BEAUTY_SKIP_SELECT: "",
    BEAUTY_SIMULATE_POSTED_ALL: "",
    BEAUTY_SIMULATE_UNPOSTED_ALL: "",
    BEAUTY_ALLOW_TEST_PIPELINE: "",
    POSTED_PRODUCTS_PATH: "",
    ...extra,
  };
}

function run(label, args, env) {
  console.log(`\n===== ${label} =====`);
  console.log(`$ node selectBeautyProduct.cjs ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: root,
    env,
  });
  process.stdout.write(`${r.stdout || ""}${r.stderr || ""}`);
  console.log(`exit=${r.status}`);
  return r.status;
}

let failed = 0;

// 1) 本番モード正常系
{
  const code = run("本番モード正常系", ["--mode=daily", "--dry-run"], cleanProdEnv());
  if (code !== 0) {
    console.error("EXPECTED exit=0 for production daily with unposted stock");
    failed += 1;
  }
}

// 2) 未投稿0件 — EMPTY_FALLBACK=skip なら停止（recycle 既定は別経路）
{
  const code = run(
    "未投稿0件時 (daily STOP)",
    ["--mode=daily", "--dry-run", "--simulate-posted-all"],
    cleanProdEnv({
      CONTENT_STUDIO_ENV: "test",
      BEAUTY_PIPELINE_MODE: "daily",
      BEAUTY_EMPTY_FALLBACK: "skip",
    })
  );
  if (code !== 2) {
    console.error("EXPECTED exit=2 for empty unposted daily with EMPTY_FALLBACK=skip");
    failed += 1;
  }
}

// 3) recycle 手動
{
  const code = run(
    "recycle 手動実行",
    ["--mode=recycle", "--dry-run"],
    cleanProdEnv({ BEAUTY_PIPELINE_MODE: "recycle" })
  );
  if (code !== 0) {
    console.error("EXPECTED exit=0 for recycle");
    failed += 1;
  }
}

// 4) test mode 汚染 → 拒否
{
  console.log("\n===== test mode が本番日次に混在 (runtime 拒否) =====");
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `
      process.env.CONTENT_STUDIO_ENV = "production";
      process.env.BEAUTY_TEST_MODE = "true";
      process.env.BEAUTY_PIPELINE_MODE = "daily";
      const { assertProductionDailySafe } = require(${JSON.stringify(runtime)});
      const g = assertProductionDailySafe();
      console.log(JSON.stringify(g, null, 2));
      process.exit(g.ok ? 0 : 3);
      `,
    ],
    { encoding: "utf8", cwd: root, env: cleanProdEnv() }
  );
  process.stdout.write(`${r.stdout || ""}${r.stderr || ""}`);
  console.log(`exit=${r.status}`);
  if (r.status !== 3) {
    console.error("EXPECTED exit=3 from assertProductionDailySafe");
    failed += 1;
  }

  const code = run(
    "test mode 混在 → select 拒否",
    ["--mode=daily", "--dry-run"],
    cleanProdEnv({
      CONTENT_STUDIO_ENV: "production",
      BEAUTY_TEST_MODE: "true",
    })
  );
  if (code !== 3) {
    console.error(`EXPECTED exit=3 for select under production+TEST_MODE (got ${code})`);
    failed += 1;
  }
}

console.log("\n==========");
if (failed) {
  console.error(`test-select-beauty-modes: FAIL (${failed})`);
  process.exit(1);
}
console.log("test-select-beauty-modes: ok");
