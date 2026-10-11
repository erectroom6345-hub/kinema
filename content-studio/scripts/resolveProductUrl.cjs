#!/usr/bin/env node
/**
 * 選定後: article.product.url に通常の商品ページURLを確定する。
 * LinkSwitch 前提のため VC個別アフィURLは生成しない。
 *
 * Usage:
 *   node scripts/resolveProductUrl.cjs
 *   node scripts/resolveProductUrl.cjs --dry-run
 *   node scripts/resolveProductUrl.cjs --dry-run --brand=コスメデコルテ --name='ザ スキン ミニマリスト ファンデーション'
 *   node scripts/resolveProductUrl.cjs --provider=web --product-id=beauty-main-001
 *
 * Env:
 *   PRODUCT_URL_PROVIDER=auto|map|search|web
 *   PRODUCT_URL_SEARCH_CHAIN=web
 *   PRODUCT_URL_REQUIRE=true|false
 *   PRODUCT_URL_WRITEBACK=true|false
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
try {
  require("dotenv").config({ path: path.join(root, ".env") });
} catch {
  /* optional */
}

const articlePath = path.join(root, "input", "article.json");

const {
  isUsableProductUrl,
  resolveProductPageUrl,
  writeBackProductUrl,
  writeBackUrlMap,
  defaultMapPath,
  defaultProductsPath,
} = require("./lib/resolve-product-url.cjs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function envFlag(name, defaultTrue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultTrue;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    ignoreExisting: false,
    provider: "",
    productId: "",
    brand: "",
    name: "",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--ignore-existing") out.ignoreExisting = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--provider=")) out.provider = arg.slice("--provider=".length);
    else if (arg.startsWith("--product-id=")) out.productId = arg.slice("--product-id=".length);
    else if (arg.startsWith("--brand=")) out.brand = arg.slice("--brand=".length);
    else if (arg.startsWith("--name=")) out.name = arg.slice("--name=".length);
  }
  return out;
}

function logDetail(detail) {
  if (!detail) return;
  try {
    console.error(
      "resolveProductUrl: detail=\n" + JSON.stringify(detail, null, 2),
    );
  } catch {
    console.error("resolveProductUrl: detail=(unserializable)");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/resolveProductUrl.cjs [--dry-run] [--ignore-existing]
    [--provider=auto|map|search|web]
    [--product-id=ID] [--brand=BRAND] [--name=NAME]

Resolves a VC LinkSwitch-compatible normal product URL into article.product.url.
Mall URLs (Rakuten/Amazon/Yahoo Shopping) are rejected.
Writes back to products-beauty.json and product-url-map.json unless --dry-run.`);
    process.exit(0);
  }

  let article = null;
  let product = {};
  const hasCliProduct = Boolean(args.brand || args.name || args.productId);

  if (fs.existsSync(articlePath)) {
    try {
      article = readJson(articlePath);
      product = article.product || {};
    } catch (e) {
      console.error(`resolveProductUrl: article.json が壊れています: ${e.message}`);
      if (!hasCliProduct) process.exit(2);
    }
  } else if (!hasCliProduct) {
    console.error(`resolveProductUrl: article.json がありません: ${articlePath}`);
    process.exit(2);
  }

  const productId = String(args.productId || product.id || "").trim();
  const brand = String(args.brand || product.brand || "").trim();
  const productName = String(args.name || product.name || "").trim();
  const currentUrl = args.ignoreExisting
    ? ""
    : String(product.url || "").trim();
  const provider =
    args.provider || process.env.PRODUCT_URL_PROVIDER || "auto";

  console.log(
    `resolveProductUrl: start provider=${provider} dryRun=${args.dryRun}` +
      ` ignoreExisting=${args.ignoreExisting}` +
      ` id=${productId || "-"} brand=${brand || "-"} name=${productName || "-"}` +
      ` currentUrl=${currentUrl || "(empty)"}`,
  );

  const result = await resolveProductPageUrl(
    { productId, brand, productName, currentUrl },
    { provider },
  );

  if (!result.url || !isUsableProductUrl(result.url, { brand })) {
    const msg = result.reason || "商品URLを解決できませんでした";
    const requireUrl = envFlag("PRODUCT_URL_REQUIRE", true);
    console.error(`resolveProductUrl: FAIL ${msg}`);
    console.error(`map: ${defaultMapPath}`);
    console.error(`catalog: ${defaultProductsPath}`);
    logDetail(result.detail);
    if (requireUrl && !args.dryRun) process.exit(2);
    if (requireUrl && args.dryRun) {
      console.error("resolveProductUrl: dry-run のため exit 2（解決失敗）");
      process.exit(2);
    }
    console.warn("resolveProductUrl: WARN 解決失敗だが PRODUCT_URL_REQUIRE=false のため続行");
    process.exit(0);
  }

  console.log(
    `resolveProductUrl: resolved source=${result.source} id=${productId || "-"} url=${result.url}`,
  );
  if (result.detail && result.detail.keyword) {
    console.log(`resolveProductUrl: keyword=${result.detail.keyword}`);
  }
  if (result.source !== "existing" && result.source !== "map") {
    logDetail(result.detail);
  }

  if (args.dryRun) {
    console.log("resolveProductUrl: dry-run のため書き込みスキップ");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          productId,
          brand,
          productName,
          source: result.source,
          url: result.url,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (result.source === "existing") {
    console.log("resolveProductUrl: 既存 usable URL を採用（書き戻しなし）");
    process.exit(0);
  }

  if (article && article.product) {
    article.product = {
      ...article.product,
      url: result.url,
    };
    writeJson(articlePath, article);
    console.log(`resolveProductUrl: article.product.url を更新 → ${articlePath}`);
  } else {
    console.warn("resolveProductUrl: article.json が無いため article 更新スキップ");
  }

  if (envFlag("PRODUCT_URL_WRITEBACK", true)) {
    if (!productId) {
      console.warn("resolveProductUrl: productId が空のため書き戻しスキップ");
    } else {
      const wroteCatalog = writeBackProductUrl(productId, result.url, undefined, {
        brand,
      });
      console.log(
        wroteCatalog
          ? `resolveProductUrl: products-beauty.json 書き戻しOK id=${productId}`
          : `resolveProductUrl: products-beauty.json 書き戻しスキップ/失敗 id=${productId}`,
      );
      const wroteMap = writeBackUrlMap(productId, result.url, undefined, { brand });
      console.log(
        wroteMap
          ? `resolveProductUrl: product-url-map.json 書き戻しOK id=${productId}`
          : `resolveProductUrl: product-url-map.json 書き戻し失敗 id=${productId}`,
      );
    }
  } else {
    console.log("resolveProductUrl: PRODUCT_URL_WRITEBACK=false のため書き戻しスキップ");
  }
}

main().catch((e) => {
  console.error(`resolveProductUrl: unexpected error: ${e && e.stack ? e.stack : e}`);
  process.exit(2);
});
