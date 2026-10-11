#!/usr/bin/env node
/**
 * 公式ページ sale provider の抽出精度・ガードの単体確認。
 */
const assert = require("assert");
const {
  extractWindowsFromText,
  pickBestWindow,
  fetchOfficialPageSaleWindows,
} = require("./lib/beauty-sale-official-page.cjs");

const TODAY = "2026-10-06";
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

check("【11/13まで】は 11月13日（月=1 誤読しない）", () => {
  const w = extractWindowsFromText("【11/13まで】4,400円", { today: TODAY });
  assert.ok(w.length >= 1);
  assert.strictEqual(w[0].saleEnd, "2026-11-13");
  assert.strictEqual(w[0].saleStart, "2026-09-29");
});

check("【12/1～12/25】レンジ", () => {
  const w = extractWindowsFromText("【12/1～12/25】セット", { today: TODAY });
  assert.ok(w.some((x) => x.saleStart === "2026-12-01" && x.saleEnd === "2026-12-25"));
});

check("年またぎ 2月28日〜3月8日", () => {
  const w = extractWindowsFromText("2月28日〜3月8日", { today: "2026-02-20" });
  assert.ok(w.some((x) => x.saleStart === "2026-02-28" && x.saleEnd === "2026-03-08"));
});

check("明示年付きレンジ", () => {
  const w = extractWindowsFromText("2026/10/1～2026/10/7", { today: TODAY });
  assert.ok(w.some((x) => x.saleStart === "2026-10-01" && x.saleEnd === "2026-10-07"));
});

check("開始欠損はスキップ", () => {
  const w = extractWindowsFromText("までセール", { today: TODAY });
  assert.strictEqual(w.length, 0);
});

check("終了欠損っぽい単独月日は until 以外スキップ", () => {
  // 「10月6日」だけでは期間にならない（まで無し）
  const w = extractWindowsFromText("10月6日開催", { today: TODAY });
  assert.strictEqual(w.length, 0);
});

check("active 期間が未来 until より優先", () => {
  const mixed = extractWindowsFromText(
    "【11/13まで】と 12月25日(火)まで",
    { today: TODAY }
  );
  const best = pickBestWindow(mixed, TODAY);
  assert.ok(best);
  assert.strictEqual(best.saleEnd, "2026-11-13");
  assert.ok(best.saleStart <= TODAY && TODAY <= best.saleEnd);
});

check("レンジ+まで の誤 until 結合を避ける", () => {
  const w = extractWindowsFromText("2月28日〜3月8日まで", { today: TODAY });
  // 過去レンジは残ってよいが、開始が 2/28 の until 単独誤認（年またぎ未来）だけ見ない
  const bad = w.find(
    (x) => x.saleStart === "2027-01-14" && x.saleEnd === "2027-02-28"
  );
  assert.strictEqual(bad, undefined);
});

async function checkRedirectSkip() {
  const name = "ブランド外リダイレクトはスキップ";
  try {
    const result = await fetchOfficialPageSaleWindows({
      today: TODAY,
      maxPagesPerBrand: 2,
      fetchImpl: async (url) => {
        // hince.com 相当 → 別ドメインへ飛ばす
        if (String(url).includes("hince")) {
          return {
            ok: true,
            status: 200,
            url: "https://annhince.com/",
            html: "【11/13まで】偽セール",
          };
        }
        return { ok: false, status: 404, url, html: "" };
      },
      productsPath: require("path").join(
        __dirname,
        "..",
        "input",
        "products-beauty.json"
      ),
    });
    // 偽 HTML があっても hostOk=false なら items に入らない（他シードが空なら 0）
    // 実カタログに複数シードがあるため、ここでは「annhince 由来を採用しない」を diagnostics で確認
    const diag = (result.diagnostics || []).find((d) => d.brand === "hince");
    assert.ok(diag, "hince diag");
    const badPage = (diag.pages || []).find((p) =>
      String(p.final || p.url || "").includes("annhince.com")
    );
    if (badPage) {
      assert.strictEqual(badPage.hostOk, false);
    }
    if (result.items["beauty-sale-001"]) {
      assert.notStrictEqual(
        result.items["beauty-sale-001"].pageUrl || "",
        "https://annhince.com/"
      );
    }
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

async function checkExtractFailEmpty() {
  const name = "期間表記なし HTML → 供給0件";
  try {
    const result = await fetchOfficialPageSaleWindows({
      today: TODAY,
      maxPagesPerBrand: 1,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        url: "https://hince.jp/",
        html: "<html><body>新着アイテムのお知らせ</body></html>",
      }),
    });
    assert.strictEqual(Object.keys(result.items || {}).length, 0);
    assert.strictEqual(result.ok, false);
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

(async () => {
  await checkRedirectSkip();
  await checkExtractFailEmpty();
  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall official-page unit checks passed");
})();
