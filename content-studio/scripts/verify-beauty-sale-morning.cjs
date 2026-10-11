#!/usr/bin/env node
/**
 * 明朝本番向け: sync → 選定 dry-run のケース一覧。
 *
 * Usage:
 *   node scripts/verify-beauty-sale-morning.cjs
 *   node scripts/verify-beauty-sale-morning.cjs --live   # official-page 実取得を含む
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
  applyWindowsToProducts,
  loadWindows,
  saveWindows,
  mirrorWindowsToPolicy,
  saveSyncStatus,
  tokyoDayKey,
} = require("./lib/beauty-sale-windows.cjs");

const ROOT = path.join(__dirname, "..");
const live = process.argv.includes("--live");
const TARGET = tokyoDayKey();

function runNode(args, env = {}) {
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: res.status ?? 1,
    out: `${res.stdout || ""}${res.stderr || ""}`,
  };
}

function parseSelectJson(out) {
  // dry-run JSON は "dryRun": true を含む最後のオブジェクト
  const marker = '"dryRun": true';
  const pos = out.lastIndexOf(marker);
  if (pos < 0) return null;
  let start = out.lastIndexOf("{", pos);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < out.length; i += 1) {
    const ch = out[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(out.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function snapshotProductsSale() {
  const p = JSON.parse(
    fs.readFileSync(path.join(ROOT, "input", "products-beauty.json"), "utf8")
  );
  return (p.sale || []).map((x) => ({
    id: x.id,
    saleStart: x.saleStart || null,
    saleEnd: x.saleEnd || null,
  }));
}

function forceEmptyStore(syncStatus = "empty") {
  const store = { updatedAt: tokyoDayKey(), provider: "none", items: {} };
  saveWindows(store);
  applyWindowsToProducts(store);
  mirrorWindowsToPolicy(store);
  saveSyncStatus({
    syncStatus,
    provider: "none",
    windowsCount: 0,
    day: tokyoDayKey(),
    note: "verify: forced empty",
  });
}

function caseRow(name, row) {
  console.log(
    [
      name.padEnd(28),
      `sync=${row.syncStatus}`.padEnd(16),
      `win=${row.windowsCount}`.padEnd(8),
      `saleDay=${row.saleDay}`.padEnd(14),
      `bucket=${row.selectedBucket}`.padEnd(14),
      `id=${row.selectedId}`,
      row.ok === false ? "OK" : "OK",
    ].join("  ")
  );
}

const rows = [];

function record(name, expect, actual) {
  const ok =
    (expect.saleDay == null || actual.saleDay === expect.saleDay) &&
    (expect.selectedBucket == null ||
      actual.selectedBucket === expect.selectedBucket) &&
    (expect.windowsCount == null || actual.windowsCount === expect.windowsCount) &&
    (expect.syncStatus == null || actual.syncStatus === expect.syncStatus) &&
    (expect.saleCleared == null || actual.saleCleared === expect.saleCleared);
  rows.push({ name, ok, ...actual, expect });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}` +
      ` | syncStatus=${actual.syncStatus} windowsCount=${actual.windowsCount}` +
      ` saleDay=${actual.saleDay} selectedBucket=${actual.selectedBucket}` +
      ` selectedId=${actual.selectedId}` +
      (ok ? "" : ` expected=${JSON.stringify(expect)}`)
  );
}

console.log(`=== beauty sale morning verify targetDate=${TARGET} live=${live} ===\n`);

// 0) 抽出単体
{
  const unit = runNode(["scripts/test-beauty-sale-official-page.cjs"]);
  const ok = unit.code === 0;
  rows.push({
    name: "unit: extract/redirect/empty",
    ok,
    syncStatus: ok ? "ok" : "failed",
    windowsCount: "-",
    saleDay: "-",
    selectedBucket: "-",
    selectedId: ok ? "unit-pass" : "unit-fail",
  });
  console.log(`${ok ? "PASS" : "FAIL"} unit: extract/redirect/empty`);
  if (!ok) console.log(unit.out.split("\n").slice(-30).join("\n"));
}

// 1) windows 0 件
{
  forceEmptyStore("empty");
  const sel = runNode([
    "scripts/selectBeautyProduct.cjs",
    "--dry-run",
    `--date=${TARGET}`,
  ]);
  const j = parseSelectJson(sel.out);
  const sale = snapshotProductsSale();
  const saleCleared = sale.every((x) => !x.saleStart && !x.saleEnd);
  record(
    "windows 0件 → 非セール",
    { saleDay: false, windowsCount: 0, saleCleared: true },
    {
      syncStatus: j?.morning?.syncStatus || loadWindows().provider,
      windowsCount: j?.morning?.windowsCount ?? 0,
      saleDay: j?.saleDay,
      selectedBucket: j?.selectedBucket,
      selectedId: j?.productId,
      saleCleared,
    }
  );
  // sale を選んでいないこと（main/niche/routine のいずれか）
  if (j?.selectedBucket === "sale") {
    console.log("FAIL windows0 なのに sale 選定");
    rows[rows.length - 1].ok = false;
  }
}

// 2) provider=none（失敗/スキップ相当）
{
  const sync = runNode([
    "scripts/sync-beauty-sale-windows.cjs",
    "--provider=none",
  ]);
  const sel = runNode([
    "scripts/selectBeautyProduct.cjs",
    "--dry-run",
    `--date=${TARGET}`,
  ]);
  const j = parseSelectJson(sel.out);
  const saleCleared = snapshotProductsSale().every(
    (x) => !x.saleStart && !x.saleEnd
  );
  record(
    "provider 失敗相当(none)",
    { saleDay: false, windowsCount: 0, saleCleared: true },
    {
      syncStatus: j?.morning?.syncStatus,
      windowsCount: j?.morning?.windowsCount,
      saleDay: j?.saleDay,
      selectedBucket: j?.selectedBucket,
      selectedId: j?.productId,
      saleCleared,
      exitSync: sync.code,
    }
  );
}

// 3) Yahoo: 非トリガー日はスキップ（日付だけで sale にしない）
{
  const yahooUnit = runNode(["scripts/test-beauty-sale-yahoo.cjs"]);
  const sync = runNode([
    "scripts/sync-beauty-sale-windows.cjs",
    "--provider=yahoo",
    `--date=${TARGET}`,
    "--dry-run",
  ]);
  const skipped = sync.out.includes("yahooCheckSkipped=true");
  const triggered = sync.out.includes("yahooCheckTriggered=true");
  const detected = sync.out.includes("yahooSaleDetected=true");
  // TARGET がトリガー日かどうかで期待を分岐
  const dayNum = Number(String(TARGET).slice(8, 10));
  const eom = new Date(Date.UTC(+TARGET.slice(0, 4), +TARGET.slice(5, 7), 0)).getUTCDate();
  const isTrigger = [5, 15, 25].includes(dayNum) || dayNum === eom;
  const okYahoo =
    yahooUnit.code === 0 &&
    (isTrigger
      ? triggered && sync.out.includes("yahooCheckSkipped=false")
      : skipped && !detected);
  rows.push({
    name: "Yahoo トリガー制御",
    ok: okYahoo,
    syncStatus: isTrigger ? "triggered-or-check" : "skipped",
    windowsCount: "-",
    saleDay: "-",
    selectedBucket: "-",
    selectedId: okYahoo ? "yahoo-gate-ok" : "yahoo-gate-fail",
  });
  console.log(
    `${okYahoo ? "PASS" : "FAIL"} Yahoo トリガー制御` +
      ` | skipped=${skipped} triggered=${triggered} detected=${detected} isTrigger=${isTrigger}`
  );
  if (!okYahoo) console.log(sync.out.split("\n").slice(0, 12).join("\n"));
}

// 4) 期間表記ありだが抽出失敗（モック HTML）
{
  const mock = runNode([
    "-e",
    `
const { fetchOfficialPageSaleWindows } = require("./scripts/lib/beauty-sale-official-page.cjs");
const { saveWindows, applyWindowsToProducts, mirrorWindowsToPolicy, saveSyncStatus, tokyoDayKey } = require("./scripts/lib/beauty-sale-windows.cjs");
(async () => {
  const fetched = await fetchOfficialPageSaleWindows({
    today: ${JSON.stringify(TARGET)},
    maxPagesPerBrand: 2,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: "https://hince.jp/",
      html: "<html><body>キャンペーン実施中！詳細は店舗まで</body></html>",
    }),
  });
  const store = { updatedAt: tokyoDayKey(), provider: "official-page", items: {} };
  saveWindows(store);
  applyWindowsToProducts(store);
  mirrorWindowsToPolicy(store);
  saveSyncStatus({ syncStatus: "empty", provider: "official-page", windowsCount: 0, day: tokyoDayKey(), note: fetched.note });
  console.log(JSON.stringify({ ok: fetched.ok, count: Object.keys(fetched.items).length }));
})();
`,
  ]);
  const sel = runNode([
    "scripts/selectBeautyProduct.cjs",
    "--dry-run",
    `--date=${TARGET}`,
  ]);
  const j = parseSelectJson(sel.out);
  record(
    "表記あり抽出失敗→0件",
    { saleDay: false, windowsCount: 0 },
    {
      syncStatus: j?.morning?.syncStatus,
      windowsCount: j?.morning?.windowsCount,
      saleDay: j?.saleDay,
      selectedBucket: j?.selectedBucket,
      selectedId: j?.productId,
      mock: mock.out.trim(),
    }
  );
}

// 5) ブランド外リダイレクト
{
  const mock = runNode([
    "-e",
    `
const { fetchOfficialPageSaleWindows } = require("./scripts/lib/beauty-sale-official-page.cjs");
(async () => {
  const fetched = await fetchOfficialPageSaleWindows({
    today: ${JSON.stringify(TARGET)},
    maxPagesPerBrand: 3,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: "https://annhince.com/sale",
      html: "【11/13まで】偽",
    }),
  });
  const diag = (fetched.diagnostics||[])[0];
  const pages = diag?.pages || [];
  const hostSkip = pages.length > 0 && pages.every(p => p.hostOk !== true);
  console.log(JSON.stringify({ count: Object.keys(fetched.items).length, hostSkip, pages: pages.length, best: diag?.best }));
})();
`,
  ]);
  let parsed = {};
  try {
    parsed = JSON.parse(mock.out.trim().split("\n").pop());
  } catch {
    parsed = { count: -1, hostSkip: false };
  }
  const okRedirect = parsed.count === 0 && parsed.hostSkip === true;
  rows.push({
    name: "ブランド外リダイレクト skip",
    ok: okRedirect,
    syncStatus: "n/a",
    windowsCount: parsed.count,
    saleDay: "-",
    selectedBucket: "-",
    selectedId: okRedirect ? "host-skip" : "host-leak",
  });
  console.log(
    `${okRedirect ? "PASS" : "FAIL"} ブランド外リダイレクト skip` +
      ` | count=${parsed.count} hostSkip=${parsed.hostSkip}`
  );
}

// 6) provider 成功（live）
if (live) {
  const sync = runNode([
    "scripts/sync-beauty-sale-windows.cjs",
    "--provider=official-page",
  ]);
  const sel = runNode([
    "scripts/selectBeautyProduct.cjs",
    "--dry-run",
    `--date=${TARGET}`,
  ]);
  const j = parseSelectJson(sel.out);
  const win = loadWindows();
  const count = Object.keys(win.items || {}).length;
  record(
    "provider 成功(live)",
    { syncStatus: count > 0 ? "ok" : "empty" },
    {
      syncStatus: j?.morning?.syncStatus,
      windowsCount: j?.morning?.windowsCount,
      saleDay: j?.saleDay,
      selectedBucket: j?.selectedBucket,
      selectedId: j?.productId,
      exitSync: sync.code,
      morningLine: (sel.out.match(/\[morning:ready\][^\n]+/) || [])[0] || "",
    }
  );
  if (sync.code !== 0) rows[rows.length - 1].ok = false;
  if (count > 0 && j?.saleDay === true && j?.selectedBucket !== "sale") {
    // セール日なのに sale 以外（在庫切れ等）は許容だがログ
    console.log("NOTE: saleDay=true but selectedBucket!=sale (inventory/fallback)");
  }
} else {
  console.log("SKIP provider 成功(live) — 実行: node scripts/verify-beauty-sale-morning.cjs --live");
}

console.log("\n--- summary ---");
for (const r of rows) {
  caseRow(r.name, r);
}
const failed = rows.filter((r) => r.ok === false).length;
console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases PASS");

// 検証後は必ず official-page で一次ストアを復元（明朝を空のままにしない）
console.log("\n=== restore official-page for tomorrow ===");
const restore = runNode([
  "scripts/sync-beauty-sale-windows.cjs",
  "--provider=official-page",
]);
console.log(
  (restore.out.match(/\[sale-sync\] provider=.*/) || []).join("\n") ||
    restore.out.split("\n").slice(-5).join("\n")
);
if (restore.code !== 0) {
  console.error("WARN: restore sync failed — run npm run beauty:sale-sync manually");
}

process.exit(failed || restore.code !== 0 ? 1 : 0);
