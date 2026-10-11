#!/usr/bin/env node
/**
 * Yahoo 軽量 sale 確認の単体テスト。
 */
const assert = require("assert");
const {
  isYahooCheckTriggerDay,
  evaluateYahooPage,
  fetchYahooSaleWindows,
  lastDayOfMonth,
} = require("./lib/beauty-sale-yahoo.cjs");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

check("トリガー日 5/15/25", () => {
  assert.strictEqual(isYahooCheckTriggerDay("2026-10-05").triggered, true);
  assert.strictEqual(isYahooCheckTriggerDay("2026-10-15").kind, "fiveDay");
  assert.strictEqual(isYahooCheckTriggerDay("2026-10-25").triggered, true);
});

check("非トリガー日はスキップ", () => {
  const t = isYahooCheckTriggerDay("2026-10-06");
  assert.strictEqual(t.triggered, false);
});

check("月末トリガー", () => {
  assert.strictEqual(lastDayOfMonth("2026-10-01"), 31);
  const t = isYahooCheckTriggerDay("2026-10-31");
  assert.strictEqual(t.triggered, true);
  assert.strictEqual(t.kind, "monthEnd");
});

check("日付だけでは評価OKにしない（本日未言及）", () => {
  const html =
    "5のつく日 開催期間 2026年09月05日 00:00～2026年09月05日 23:59 ただいま、エントリー期間外です。";
  const r = evaluateYahooPage(
    html,
    {
      requireKeywords: ["5のつく日"],
      requireTodayMention: true,
      rejectKeywords: ["ただいま、エントリー期間外です"],
    },
    "2026-10-05"
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "today-not-mentioned");
});

check("本日言及があれば有効", () => {
  const html =
    "5のつく日 開催期間 2026年10月05日 00:00～2026年10月05日 23:59 PayPayポイント";
  const r = evaluateYahooPage(
    html,
    {
      requireKeywords: ["5のつく日"],
      requireTodayMention: true,
      rejectKeywords: ["ただいま、エントリー期間外です"],
    },
    "2026-10-05"
  );
  assert.strictEqual(r.ok, true);
});

async function runAsync() {
  {
    const name = "非トリガー日: skipped / 取得しない";
    try {
      let fetched = 0;
      const res = await fetchYahooSaleWindows({
        today: "2026-10-06",
        fetchImpl: async () => {
          fetched += 1;
          return { ok: true, status: 200, url: "x", html: "5のつく日 2026年10月06日" };
        },
      });
      assert.strictEqual(res.yahooCheckSkipped, true);
      assert.strictEqual(res.yahooCheckTriggered, false);
      assert.strictEqual(res.yahooSaleDetected, false);
      assert.strictEqual(fetched, 0);
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  {
    const name = "トリガー日+ページ有効 → detected";
    try {
      const res = await fetchYahooSaleWindows({
        today: "2026-10-05",
        fetchImpl: async (url) => ({
          ok: true,
          status: 200,
          url,
          html: "5のつく日 開催期間 2026年10月05日 00:00～2026年10月05日 23:59",
        }),
      });
      assert.strictEqual(res.yahooCheckSkipped, false);
      assert.strictEqual(res.yahooCheckTriggered, true);
      assert.strictEqual(res.yahooSaleDetected, true);
      assert.ok(Object.keys(res.items).length >= 1);
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  {
    const name = "トリガー日+ページ不一致 → 非セール";
    try {
      const res = await fetchYahooSaleWindows({
        today: "2026-10-05",
        fetchImpl: async (url) => ({
          ok: true,
          status: 200,
          url,
          html: "5のつく日 開催期間 2026年09月05日 ただいま、エントリー期間外です。",
        }),
      });
      assert.strictEqual(res.yahooCheckTriggered, true);
      assert.strictEqual(res.yahooSaleDetected, false);
      assert.strictEqual(Object.keys(res.items).length, 0);
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  {
    const name = "トリガー日+404 → 非セール";
    try {
      const res = await fetchYahooSaleWindows({
        today: "2026-10-15",
        fetchImpl: async (url) => ({
          ok: false,
          status: 404,
          url,
          html: "",
        }),
      });
      assert.strictEqual(res.yahooCheckTriggered, true);
      assert.strictEqual(res.yahooSaleDetected, false);
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall yahoo sale checks passed");
}

runAsync();
