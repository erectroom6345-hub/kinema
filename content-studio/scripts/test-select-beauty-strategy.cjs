#!/usr/bin/env node
/**
 * 日付条件戦略の dry-run 証明（7ケース）
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const script = path.join(__dirname, "selectBeautyProduct.cjs");

function run(label, args, expect) {
  console.log(`\n===== ${label} =====`);
  console.log(`$ node selectBeautyProduct.cjs ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      // simulate-unposted-all で posted を空にし、バケット在庫を戦略テスト可能にする
      CONTENT_STUDIO_ENV: "test",
      BEAUTY_PIPELINE_MODE: "daily",
      BEAUTY_TEST_MODE: "true",
      BEAUTY_ALLOW_TEST_PIPELINE: "true",
      BEAUTY_ALLOW_RECYCLE: "",
      BEAUTY_USE_REPOST: "",
      BEAUTY_EMPTY_FALLBACK: "skip",
      POSTED_PRODUCTS_PATH: "",
    },
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  process.stdout.write(out);
  console.log(`exit=${r.status}`);

  const pick = (re) => {
    const m = out.match(re);
    return m ? m[1] : undefined;
  };
  const payload = {
    selectedBucket: pick(/\[select:strategy\] selectedBucket=(\S+)/),
    saleDay: pick(/\[select:strategy\] saleDay=(\w+)/) === "true",
    nicheDue: pick(/\[select:strategy\] saleDay=\w+ nicheDue=(\w+)/) === "true",
    routineDue:
      pick(/\[select:strategy\] saleDay=\w+ nicheDue=\w+ routineDue=(\w+)/) ===
      "true",
    fallbackUsed: pick(/\[select:strategy\] fallbackUsed=(\w+)/) === "true",
    recycleUsed: pick(/\[select:strategy\] recycleUsed=(\w+)/) === "true",
    primaryBucket: pick(/\[select:strategy\] primaryBucket=(\w+)/),
  };

  const checks = [];
  if (expect.exit != null && r.status !== expect.exit) {
    checks.push(`exit expected ${expect.exit} got ${r.status}`);
  }
  if (expect.selectedBucket && payload.selectedBucket !== expect.selectedBucket) {
    checks.push(
      `selectedBucket expected ${expect.selectedBucket} got ${payload.selectedBucket}`
    );
  }
  if (expect.saleDay != null && payload.saleDay !== expect.saleDay) {
    checks.push(`saleDay expected ${expect.saleDay} got ${payload.saleDay}`);
  }
  if (expect.nicheDue != null && payload.nicheDue !== expect.nicheDue) {
    checks.push(`nicheDue expected ${expect.nicheDue} got ${payload.nicheDue}`);
  }
  if (expect.routineDue != null && payload.routineDue !== expect.routineDue) {
    checks.push(`routineDue expected ${expect.routineDue} got ${payload.routineDue}`);
  }
  if (expect.fallbackUsed != null && payload.fallbackUsed !== expect.fallbackUsed) {
    checks.push(
      `fallbackUsed expected ${expect.fallbackUsed} got ${payload.fallbackUsed}`
    );
  }
  if (expect.recycleUsed != null && payload.recycleUsed !== expect.recycleUsed) {
    checks.push(
      `recycleUsed expected ${expect.recycleUsed} got ${payload.recycleUsed}`
    );
  }
  if (expect.primaryInLog && payload.primaryBucket !== expect.primaryInLog) {
    checks.push(
      `primaryBucket log expected ${expect.primaryInLog} got ${payload.primaryBucket}`
    );
  }

  if (checks.length) {
    console.error("FAIL:", checks.join("; "));
    return 1;
  }
  console.log("OK");
  return 0;
}

let failed = 0;
const date = "2026-10-07";

const unpostedAll = ["--simulate-unposted-all"];

failed += run(
  "セール日",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=true",
    "--force-niche-due=false",
    "--force-routine-due=false",
  ],
  {
    exit: 0,
    saleDay: true,
    nicheDue: false,
    routineDue: false,
    selectedBucket: "sale",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "sale",
  }
);

failed += run(
  "非セール日（通常=main）",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=false",
    "--force-niche-due=false",
    "--force-routine-due=false",
  ],
  {
    exit: 0,
    saleDay: false,
    nicheDue: false,
    routineDue: false,
    selectedBucket: "main",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "main",
  }
);

failed += run(
  "niche優先日",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=false",
    "--force-niche-due=true",
    "--force-routine-due=false",
  ],
  {
    exit: 0,
    saleDay: false,
    nicheDue: true,
    routineDue: false,
    selectedBucket: "niche",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "niche",
  }
);

failed += run(
  "routine優先日",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=false",
    "--force-niche-due=false",
    "--force-routine-due=true",
  ],
  {
    exit: 0,
    saleDay: false,
    nicheDue: false,
    routineDue: true,
    // test mode では productionFilter オフのため placeholder routine も選定可
    selectedBucket: "routine",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "routine",
  }
);

failed += run(
  "nicheとroutineが重なる日",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=false",
    "--force-niche-due=true",
    "--force-routine-due=true",
  ],
  {
    exit: 0,
    nicheDue: true,
    routineDue: true,
    selectedBucket: "niche",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "niche",
  }
);

failed += run(
  "saleとnicheが重なる日",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=true",
    "--force-niche-due=true",
    "--force-routine-due=false",
  ],
  {
    exit: 0,
    saleDay: true,
    nicheDue: true,
    selectedBucket: "sale",
    fallbackUsed: false,
    recycleUsed: false,
    primaryInLog: "sale",
  }
);

failed += run(
  "優先基準の在庫切れ時（sale空→フォールバック）",
  [
    "--mode=daily",
    "--dry-run",
    ...unpostedAll,
    `--date=${date}`,
    "--force-sale-day=true",
    "--force-niche-due=false",
    "--force-routine-due=false",
    "--empty-bucket=sale",
  ],
  {
    exit: 0,
    saleDay: true,
    // sale 空 → priorityOrder 次の niche（在庫あり）へ
    selectedBucket: "niche",
    fallbackUsed: true,
    recycleUsed: false,
    primaryInLog: "sale",
  }
);

console.log("\n==========");
if (failed) {
  console.error(`test-select-beauty-strategy: FAIL (${failed})`);
  process.exit(1);
}
console.log("test-select-beauty-strategy: ok");
