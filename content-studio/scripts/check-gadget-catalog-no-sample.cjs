#!/usr/bin/env node
/**
 * products-gadget.json に sample-shop が残っていないことを確認するゲート。
 *
 *   node scripts/check-gadget-catalog-no-sample.cjs
 *   node scripts/check-gadget-catalog-no-sample.cjs --strict-main-only
 */
const fs = require("fs");
const path = require("path");

const productsPath = path.join(
  __dirname,
  "..",
  "input",
  "products-gadget.json",
);

function isSampleUrl(url) {
  return /sample-shop/i.test(String(url || ""));
}

function main() {
  const strictMainOnly = process.argv.includes("--strict-main-only");
  if (!fs.existsSync(productsPath)) {
    console.error(`[gadget-catalog-check] missing ${productsPath}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  const buckets = strictMainOnly
    ? [["main", data.main || []]]
    : [
        ["main", data.main || []],
        ["sale", data.sale || []],
        ["niche", data.niche || []],
        ["routine", data.routine || []],
      ];

  const bad = [];
  for (const [bucket, list] of buckets) {
    for (const item of list) {
      const url = item.rakutenUrl || item.url || "";
      if (isSampleUrl(url)) {
        bad.push({
          bucket,
          id: item.id || item.productId,
          rakutenUrl: url,
        });
      }
    }
  }

  const mainCount = (data.main || []).length;
  const source = data._meta?.source || "(none)";
  console.log(
    `[gadget-catalog-check] main=${mainCount}` +
      ` source=${source}` +
      ` sampleShop=${bad.length}`,
  );

  if (!mainCount) {
    console.error("[gadget-catalog-check] FAIL main が空です");
    process.exit(1);
  }

  if (bad.length) {
    for (const row of bad.slice(0, 10)) {
      console.error(
        `[gadget-catalog-check] sample ${row.bucket}/${row.id} ${row.rakutenUrl}`,
      );
    }
    console.error(
      "[gadget-catalog-check] FAIL sample-shop が残っています。先に npm run gadget:catalog:fetch",
    );
    process.exit(2);
  }

  const nonAfl = (data.main || []).filter((item) => {
    const u = String(item.rakutenUrl || item.url || "");
    return u && !/rakuten\.co\.jp|hb\.afl\.rakuten/i.test(u);
  });
  if (nonAfl.length) {
    console.error(
      `[gadget-catalog-check] WARN 楽天以外URLが ${nonAfl.length} 件（main）`,
    );
  }

  console.log("[gadget-catalog-check] OK sample-shop なし");
  process.exit(0);
}

main();
