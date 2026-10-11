#!/usr/bin/env node
/**
 * 本番 SNS/Blogger 直前の必須ガード:
 *  - テスト/禁止文言
 *  - 直近投稿との商品ID・URL重複
 *
 * Usage:
 *   node scripts/assert-beauty-prepublish.cjs
 *   node scripts/assert-beauty-prepublish.cjs --phase=social
 */
const fs = require("fs");
const path = require("path");
const {
  assertProductionCopyClean,
  isProductionEligibleProduct,
  isRecentDuplicateProduct,
  loadRecentBeautyPosts,
  findBannedHits,
} = require("./lib/beauty-copy-guard.cjs");
const { collectBeautyTexts } = require("./lib/policy-check.cjs");

const ROOT = path.join(__dirname, "..");

function main() {
  if (String(process.env.BEAUTY_TEST_MODE || "").toLowerCase() === "true") {
    console.log("[prepublish] test mode — skip");
    return;
  }
  if (String(process.env.CONTENT_STUDIO_ENV || "").toLowerCase() === "test") {
    console.log("[prepublish] CONTENT_STUDIO_ENV=test — skip");
    return;
  }

  const phase = (process.argv.find((a) => a.startsWith("--phase=")) || "--phase=all").slice(8);
  const { productId, texts, article } = collectBeautyTexts(ROOT, phase);
  const product = article.product || {};

  const catalogPath = path.join(ROOT, "input", "products-beauty.json");
  let catalogItem = null;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const all = [
      ...(catalog.sale || []),
      ...(catalog.main || []),
      ...(catalog.niche || []),
      ...(catalog.routine || []),
    ];
    catalogItem = all.find((p) => p.id === productId) || null;
  } catch {
    // ignore
  }

  if (catalogItem && !isProductionEligibleProduct(catalogItem)) {
    console.error(
      `[prepublish] BLOCK: ${productId} はテスト/非本番商品です（testOnly 等）`,
    );
    process.exit(3);
  }

  // 今日の投稿自身は履歴に含まれるので、同一 productId の「当日自身」は除外して判定したい。
  // 選定済みの現在 product が「直近他日」とぶつかる場合のみ止める。
  const recent = loadRecentBeautyPosts();
  const otherDayIds = new Set(
    recent.rows.filter((r) => r.day !== recent.today).map((r) => r.productId),
  );
  const otherUrlKeys = new Set(
    recent.rows
      .filter((r) => r.day !== recent.today && r.urlKey)
      .map((r) => r.urlKey),
  );
  const urlKey = String(product.url || product.affiliateUrl || "").trim();
  const { normalizeUrlKey } = require("./lib/beauty-copy-guard.cjs");
  const uk = normalizeUrlKey(urlKey);
  // 在庫0の empty→recycle 時は直近重複を許可（止めない）。通常選定では必須チェック。
  const emptyRecycle =
    article.emptyFallbackUsed === true &&
    String(article.selectedSource || "") === "recycle";

  if (!emptyRecycle) {
    if (productId && otherDayIds.has(productId)) {
      console.error(
        `[prepublish] BLOCK: 直近数日で同一 productId を投稿済み: ${productId}`,
      );
      process.exit(3);
    }
    if (uk && otherUrlKeys.has(uk)) {
      console.error(
        `[prepublish] BLOCK: 直近数日で同一商品URLを投稿済み: ${uk}`,
      );
      process.exit(3);
    }

    if (catalogItem) {
      const fakeRecent = {
        ...recent,
        ids: otherDayIds,
        urlKeys: otherUrlKeys,
      };
      const dup = isRecentDuplicateProduct(catalogItem, fakeRecent);
      if (dup.duplicate) {
        console.error(`[prepublish] BLOCK: ${dup.reason}`);
        process.exit(3);
      }
    }
  } else {
    console.warn(
      `[prepublish] empty→recycle のため直近重複チェックを緩和 productId=${productId || "-"}`,
    );
  }

  try {
    assertProductionCopyClean(
      texts.map((t) => t.text),
      `prepublish:${phase}`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(3);
  }

  // 追加の明示ログ
  const hits = findBannedHits(texts.map((t) => t.text).join("\n"));
  if (hits.length) {
    console.error(`[prepublish] BLOCK hits=${hits.join(",")}`);
    process.exit(3);
  }

  console.log(
    `[prepublish] OK productId=${productId || "-"} phase=${phase}` +
      ` recentIds=${[...otherDayIds].join(",") || "(none)"}`,
  );
}

main();
