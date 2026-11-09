#!/usr/bin/env node
/**
 * Catalog Ingest / Candidate Gate の単体テスト（ネットワーク不要）
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  extractListingProductLinks,
  runBeautyCatalogIngest,
  promoteReadyToCatalog,
  toCatalogItem,
} = require("./lib/beauty-catalog-ingest.cjs");
const { evaluateCandidate } = require("./lib/beauty-candidate-gate.cjs");
const {
  emptyQueue,
  upsertCandidate,
  catalogIdFromUrl,
} = require("./lib/beauty-candidate-queue.cjs");
const { isProductionEligibleProduct } = require("./lib/beauty-copy-guard.cjs");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "beauty-ingest-"));
}

async function main() {
  const listingHtml = `
    <html><body>
      <a href="/c/category/face/HC999">トゥルーディメンション新色</a>
      <a href="/my/wishlist">ウィッシュリスト</a>
      <a href="/">ホーム</a>
      <a href="https://item.rakuten.co.jp/shop/x/">楽天は除外</a>
    </body></html>
  `;
  const links = extractListingProductLinks(
    listingHtml,
    "https://hince.jp/",
    "hince",
  );
  assert.ok(links.some((l) => /HC999/.test(l.productUrl)));
  assert.ok(!links.some((l) => /wishlist/.test(l.productUrl)));
  assert.ok(!links.some((l) => /rakuten/.test(l.productUrl)));

  const readyGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "トゥルーディメンション新色",
      productUrl: "https://hince.jp/c/category/face/HC999",
      imageUrl: "https://hince.jp/img/hc999.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(readyGate.status, "ready");
  assert.strictEqual(readyGate.ok, true);

  const reviewGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "トゥルーディメンション新色",
      productUrl: "https://hince.jp/c/category/face/HC998",
      imageUrl: "",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(reviewGate.status, "needsReview");

  const rejectGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "wishlist",
      productUrl: "https://hince.jp/my/wishlist",
      imageUrl: "https://hince.jp/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(rejectGate.status, "rejected");

  const campaignGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "詳しくはこちら",
      productUrl: "https://hince.jp/c/event/2023",
      imageUrl: "https://hince.jp/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(campaignGate.status, "rejected");
  assert.ok(campaignGate.reasons.includes("campaign_page_without_sku"));

  const boutiqueGate = evaluateCandidate(
    {
      brand: "コスメデコルテ",
      productName: "DECORT&Eacute;（コスメデコルテ）公式オンラインブティック",
      productUrl: "https://www.decorte.com/site/r/r101050/",
      imageUrl: "https://www.decorte.com/resources/images/ogp.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(boutiqueGate.status, "rejected");
  assert.ok(
    boutiqueGate.reasons.includes("category_hub_path") ||
      boutiqueGate.reasons.includes("storefront_name"),
    `unexpected reasons=${boutiqueGate.reasons.join(",")}`,
  );

  const categoryNameGate = evaluateCandidate(
    {
      brand: "コスメデコルテ",
      productName: "クレンジング",
      productUrl: "https://www.decorte.com/site/r/r101010/",
      imageUrl: "https://www.decorte.com/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(categoryNameGate.status, "rejected");

  const teikiGate = evaluateCandidate(
    {
      brand: "コスメデコルテ",
      productName: "リポソーム アドバンスト リペアセラム キット 定期お届け便",
      productUrl: "https://www.decorte.com/site/p/teiki_liposome_serum_online.aspx",
      imageUrl: "https://www.decorte.com/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(teikiGate.status, "rejected");
  assert.ok(teikiGate.reasons.includes("subscription_landing_without_sku"));

  const contactGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "お問い合わせフォーム（PR）",
      productUrl: "https://hince.jp/c/category/face/HC123",
      imageUrl: "https://hince.jp/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(contactGate.status, "rejected");
  assert.ok(contactGate.reasons.includes("non_product_name"));

  const decorteSkuGate = evaluateCandidate(
    {
      brand: "コスメデコルテ",
      productName: "リポソーム アドバンスト リペアセラム",
      productUrl: "https://www.decorte.com/site/g/gJVAN/",
      imageUrl: "https://www.decorte.com/img/goods/S/JVAN.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(decorteSkuGate.status, "ready", decorteSkuGate.reasons.join(","));

  const hinceCatGate = evaluateCandidate(
    {
      brand: "hince",
      productName: "FACE",
      productUrl: "https://hince.jp/c/category/face",
      imageUrl: "https://hince.jp/img/x.jpg",
    },
    { catalogUrlKeys: new Set(), catalogIds: new Set() },
  );
  assert.strictEqual(hinceCatGate.status, "rejected");

  const listingHtml2 = `
    <a href="/c/category/face/HC390">New Blur</a>
    <a href="/c/category/face">FACE</a>
    <a href="/site/r/r101050/">美容液</a>
    <a href="/site/g/gJVAN/">セラム</a>
  `;
  const links2 = extractListingProductLinks(
    listingHtml2,
    "https://www.decorte.com/",
    "コスメデコルテ",
  );
  assert.ok(links2.some((l) => /\/site\/g\/gJVAN\//.test(l.productUrl)));
  assert.ok(!links2.some((l) => /\/site\/r\//.test(l.productUrl)));
  const linksHince = extractListingProductLinks(
    `<a href="/c/category/face/HC390">x</a><a href="/c/category/face">FACE</a>`,
    "https://hince.jp/",
    "hince",
  );
  assert.strictEqual(linksHince.length, 1);
  assert.ok(/HC390/.test(linksHince[0].productUrl));

  const catalogItem = toCatalogItem(
    {
      brand: "hince",
      productName: "トゥルーディメンション新色",
      productUrl: "https://hince.jp/c/category/face/HC999",
      imageUrl: "https://hince.jp/img/hc999.jpg",
      genre: "韓国コスメ",
      category: "korean_cosmetics",
    },
    "main",
  );
  assert.ok(catalogItem.id.startsWith("beauty-auto-"));
  assert.ok(isProductionEligibleProduct(catalogItem));

  let queue = emptyQueue();
  upsertCandidate(queue, {
    brand: "hince",
    productName: "トゥルーディメンション新色",
    productUrl: "https://hince.jp/c/category/face/HC999",
    imageUrl: "https://hince.jp/img/hc999.jpg",
    genre: "韓国コスメ",
    category: "korean_cosmetics",
    status: "ready",
    gate: readyGate,
  });
  const products = { sale: [], main: [], niche: [], routine: [] };
  const promoted = promoteReadyToCatalog(products, queue, {
    maxPromotePerRun: 2,
    defaultBucket: "main",
  });
  assert.strictEqual(promoted.promoted.length, 1);
  assert.strictEqual(promoted.products.main.length, 1);
  assert.strictEqual(queue.items[0].status, "promoted");
  assert.strictEqual(
    queue.items[0].catalogId,
    catalogIdFromUrl("https://hince.jp/c/category/face/HC999"),
  );

  // end-to-end with mock fetch
  const dir = tmpDir();
  const productsPath = path.join(dir, "products-beauty.json");
  const queuePath = path.join(dir, "queue.json");
  const policyPath = path.join(dir, "beauty-ingest.json");
  fs.writeFileSync(
    productsPath,
    JSON.stringify({ sale: [], main: [], niche: [], routine: [] }, null, 2),
  );
  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        enabled: true,
        promoteReady: true,
        defaultBucket: "main",
        maxPagesPerBrand: 1,
        maxDiscoverPerRun: 10,
        maxEnrichPerRun: 5,
        maxPromotePerRun: 2,
        brands: [
          {
            brand: "hince",
            genre: "韓国コスメ",
            category: "korean_cosmetics",
          },
        ],
      },
      null,
      2,
    ),
  );

  const productPageHtml = `
    <html><head>
      <meta property="og:title" content="ハーフムーンチーク 限定" />
      <meta property="og:image" content="https://hince.jp/img/hc777.jpg" />
      <title>ハーフムーンチーク 限定 | hince</title>
    </head><body>ok</body></html>
  `;
  const listingPageHtml = `
    <html><body>
      <a href="/c/category/face/HC777">ハーフムーンチーク 限定</a>
    </body></html>
  `;

  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("HC777")) {
      return {
        ok: true,
        status: 200,
        url: "https://hince.jp/c/category/face/HC777",
        text: async () => productPageHtml,
      };
    }
    return {
      ok: true,
      status: 200,
      url: "https://hince.jp/",
      text: async () => listingPageHtml,
    };
  };

  const result = await runBeautyCatalogIngest({
    policyPath,
    productsPath,
    queuePath,
    fetchImpl,
    force: true,
    dryRun: false,
  });
  assert.strictEqual(result.skipped, false);
  assert.ok(result.discovered >= 1, `discovered=${result.discovered}`);
  assert.ok(result.promoted.length >= 1, `promoted=${result.promoted}`);
  const saved = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  assert.ok(saved.main.length >= 1);
  assert.ok(isProductionEligibleProduct(saved.main[0]));

  console.log("test-beauty-catalog-ingest: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
