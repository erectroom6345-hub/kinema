/**
 * 今日公開された美容記事のうち、アフィリエイトリンク未挿入のものだけ後追い更新する。
 *
 * - 商品リンク追記（VC LinkSwitch 前提の通常URL）
 * - 固定画像 → 商品画像へ置換（すでに商品画像なら画像は触らない）
 * - 商品画像が取れない場合は更新スキップ
 * - タイトル / 公開日時 / URL は変えない（content PATCH のみ）
 *
 * Usage:
 *   npx tsx src/backfillBeautyAffiliateLinks.ts --dry-run
 *   npx tsx src/backfillBeautyAffiliateLinks.ts --apply
 *   npx tsx src/backfillBeautyAffiliateLinks.ts --dry-run --date=2026-10-05
 *   npx tsx src/backfillBeautyAffiliateLinks.ts --dry-run --limit=1
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createBloggerClient } from "./adapters/blogger.ts";
import { getConfig, loadEnv } from "./config/env.ts";
import type { BloggerPostSummary } from "./types/index.ts";
import {
  appendAffiliateLinkOnly,
  collectSharedCatalogImageUrls,
  hasAffiliateProductLink,
  hasFixedSharedImage,
  hasNonFixedProductImage,
  replaceOrInsertProductImage,
  resolveProductImageForBackfill,
} from "./services/bloggerContentEnrich.ts";

const require = createRequire(import.meta.url);
const {
  resolveProductPageUrl,
  isUsableProductUrl,
  writeBackProductUrl,
  writeBackUrlMap,
} = require("../scripts/lib/resolve-product-url.cjs") as {
  resolveProductPageUrl: (
    input: {
      productId?: string;
      brand?: string;
      productName?: string;
      currentUrl?: string;
    },
    opts?: { provider?: string },
  ) => Promise<{
    url: string | null;
    source: string;
    reason?: string;
    detail?: unknown;
  }>;
  isUsableProductUrl: (url: string, opts?: { brand?: string }) => boolean;
  writeBackProductUrl: (
    productId: string,
    url: string,
    productsPath?: string,
    opts?: { brand?: string },
  ) => boolean;
  writeBackUrlMap: (
    productId: string,
    url: string,
    mapPath?: string,
    opts?: { brand?: string },
  ) => boolean;
};

const productsPath = path.resolve("input/products-beauty.json");
const articlePath = path.resolve("input/article.json");
const outDir = path.resolve("output");

interface ProductItem {
  id: string;
  brand?: string;
  productName?: string;
  productUrl?: string;
  affiliateUrl?: string;
  blogUrl?: string;
  imageUrl?: string;
  articleTitle?: string;
  [key: string]: unknown;
}

interface ProductsFile {
  [key: string]: ProductItem[] | undefined;
}

function parseArgs(argv: string[]) {
  const out = {
    dryRun: true,
    apply: false,
    date: "",
    limit: 0,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      out.dryRun = true;
      out.apply = false;
    } else if (arg === "--apply") {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg.startsWith("--date=")) {
      out.date = arg.slice("--date=".length).trim();
    } else if (arg.startsWith("--limit=")) {
      out.limit = Number(arg.slice("--limit=".length)) || 0;
    }
  }
  return out;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function flattenProducts(products: ProductsFile): ProductItem[] {
  const out: ProductItem[] = [];
  for (const list of Object.values(products)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item?.id) out.push(item);
    }
  }
  return out;
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "") || u.origin;
  } catch {
    return (url || "").trim().replace(/\/+$/, "");
  }
}

function tokyoDayBounds(dateYmd?: string): {
  day: string;
  startIso: string;
  endIso: string;
} {
  const now = new Date();
  let day = dateYmd || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
  const startIso = `${day}T00:00:00+09:00`;
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    day,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function publishedInRange(
  published: string,
  startIso: string,
  endIso: string,
): boolean {
  const t = Date.parse(published);
  if (Number.isNaN(t)) return false;
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  return t >= a && t < b;
}

function findProductForPost(
  post: BloggerPostSummary,
  products: ProductItem[],
): { product: ProductItem | null; match: string } {
  const postUrlKey = normalizeUrlKey(post.url);
  {
    const hit = products.find(
      (p) => p.blogUrl && normalizeUrlKey(p.blogUrl) === postUrlKey,
    );
    if (hit) return { product: hit, match: "blogUrl" };
  }

  {
    const title = (post.title || "").trim();
    if (title) {
      const hit = products.find((p) => (p.articleTitle || "").trim() === title);
      if (hit) return { product: hit, match: "articleTitle" };
    }
  }

  const article = readJson<{
    title?: string;
    product?: { id?: string; blogUrl?: string };
  }>(articlePath, {});
  const articleBlog = normalizeUrlKey(article.product?.blogUrl || "");
  if (articleBlog && articleBlog === postUrlKey && article.product?.id) {
    const hit = products.find((p) => p.id === article.product?.id);
    if (hit) return { product: hit, match: "article.json" };
  }
  if (
    article.title &&
    article.title.trim() === (post.title || "").trim() &&
    article.product?.id
  ) {
    const hit = products.find((p) => p.id === article.product?.id);
    if (hit) return { product: hit, match: "article.title" };
  }

  return { product: null, match: "none" };
}

function snippet(html: string, max = 180): string {
  return (html || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function diffPreview(before: string, after: string): string {
  if (before === after) return "(no change)";
  const parts: string[] = [];
  const marker = "商品の詳細・購入はこちら";
  const idx = after.indexOf(marker);
  if (idx >= 0) {
    parts.push(`link:${snippet(after.slice(Math.max(0, idx - 20), idx + 160), 200)}`);
  }
  const beforeImg = before.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || "";
  const afterImg = after.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || "";
  if (beforeImg !== afterImg) {
    parts.push(`img:${snippet(beforeImg, 80)} → ${snippet(afterImg, 80)}`);
  }
  if (parts.length === 0) {
    let i = 0;
    while (i < before.length && i < after.length && before[i] === after[i]) i += 1;
    parts.push(`+${snippet(after.slice(i), 200)}`);
  }
  return parts.join(" | ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  npx tsx src/backfillBeautyAffiliateLinks.ts --dry-run [--date=YYYY-MM-DD] [--limit=N]
  npx tsx src/backfillBeautyAffiliateLinks.ts --apply  [--date=YYYY-MM-DD] [--limit=N]

Today's LIVE posts without affiliate links:
  - append VC LinkSwitch product URL
  - replace fixed shared image with product image (skip if product image unavailable)
Title / published / URL are not changed.`);
    return;
  }

  loadEnv();
  const config = getConfig();
  const blogId = config.bloggerBlogId.trim();
  if (!blogId) throw new Error("BLOGGER_BLOG_ID が未設定です");

  const bounds = tokyoDayBounds(args.date || undefined);
  console.log(
    `backfillBeautyAffiliate: day=${bounds.day} (Asia/Tokyo)` +
      ` range=${bounds.startIso} .. ${bounds.endIso}` +
      ` mode=${args.apply ? "APPLY" : "DRY-RUN"}`,
  );

  const client = createBloggerClient();
  if (!client.listPosts || !client.patchPostContent) {
    throw new Error("Blogger client が listPosts / patchPostContent 未対応です");
  }

  const listed = await client.listPosts({
    blogId,
    startDate: bounds.startIso,
    endDate: bounds.endIso,
    status: "LIVE",
    maxResults: 50,
  });

  const todayPosts = listed.filter((p) =>
    publishedInRange(p.published, bounds.startIso, bounds.endIso),
  );

  console.log(
    `取得: list=${listed.length}件 / 今日フィルタ後=${todayPosts.length}件`,
  );

  const products = flattenProducts(readJson<ProductsFile>(productsPath, {}));
  const sharedCatalogUrls = collectSharedCatalogImageUrls(
    products.map((p) => String(p.imageUrl || "")),
  );
  console.log(
    `固定画像候補(shared catalog): ${sharedCatalogUrls.length}件` +
      (sharedCatalogUrls[0] ? ` e.g. ${sharedCatalogUrls[0].slice(0, 90)}…` : ""),
  );

  const results: Array<Record<string, unknown>> = [];
  let updateCandidates = 0;
  let updated = 0;
  let skippedHasLink = 0;
  let skippedNoProduct = 0;
  let skippedResolveFail = 0;
  let skippedNoProductImage = 0;

  const targets = args.limit > 0 ? todayPosts.slice(0, args.limit) : todayPosts;

  for (const post of targets) {
    const baseLog = {
      postId: post.id,
      title: post.title,
      url: post.url,
      published: post.published,
    };

    if (hasAffiliateProductLink(post.content || "")) {
      skippedHasLink += 1;
      console.log(
        `[skip:has-link] postId=${post.id} title=${post.title} url=${post.url}`,
      );
      results.push({ ...baseLog, action: "skip", reason: "has-link" });
      continue;
    }

    const { product, match } = findProductForPost(post, products);
    if (!product) {
      skippedNoProduct += 1;
      console.warn(
        `[skip:no-product] postId=${post.id} title=${post.title} url=${post.url}`,
      );
      results.push({ ...baseLog, action: "skip", reason: "no-product" });
      continue;
    }

    const brand = String(product.brand || "").trim();
    const productName = String(product.productName || "").trim();
    const currentUrl = String(
      product.affiliateUrl || product.productUrl || "",
    ).trim();

    const resolved = await resolveProductPageUrl(
      {
        productId: product.id,
        brand,
        productName,
        currentUrl,
      },
      { provider: process.env.PRODUCT_URL_PROVIDER || "auto" },
    );

    if (!resolved.url || !isUsableProductUrl(resolved.url, { brand })) {
      skippedResolveFail += 1;
      console.warn(
        `[skip:resolve-fail] postId=${post.id} productId=${product.id}` +
          ` reason=${resolved.reason || "unusable"}`,
      );
      results.push({
        ...baseLog,
        action: "skip",
        reason: "resolve-fail",
        productId: product.id,
        resolve: resolved,
      });
      continue;
    }

    const needsImageWork =
      hasFixedSharedImage(post.content || "", sharedCatalogUrls) ||
      !hasNonFixedProductImage(post.content || "", sharedCatalogUrls);

    const productImage = await resolveProductImageForBackfill({
      catalogImageUrl: String(product.imageUrl || ""),
      productPageUrl: resolved.url,
      sharedCatalogUrls,
    });

    // 画像置換/挿入が必要なのに商品画像が無い → 全体スキップ
    if (needsImageWork && !productImage) {
      skippedNoProductImage += 1;
      console.warn(
        `[skip:no-product-image] postId=${post.id} productId=${product.id}` +
          ` catalogImage=${product.imageUrl || "(空)"} page=${resolved.url}`,
      );
      results.push({
        ...baseLog,
        action: "skip",
        reason: "no-product-image",
        productId: product.id,
        resolvedUrl: resolved.url,
      });
      continue;
    }

    let html = post.content || "";
    let imageAction:
      | "replaced"
      | "inserted"
      | "kept-product"
      | "skipped-no-image"
      | "not-needed" = "not-needed";
    let afterImageSrc: string | undefined;

    if (productImage && needsImageWork) {
      const imgResult = replaceOrInsertProductImage(html, {
        productImageUrl: productImage.url,
        productName,
        sharedCatalogUrls,
      });
      html = imgResult.html;
      imageAction = imgResult.imageAction;
      afterImageSrc = imgResult.afterSrc;

      if (imgResult.imageAction === "skipped-no-image") {
        skippedNoProductImage += 1;
        console.warn(
          `[skip:no-product-image] postId=${post.id} productId=${product.id}` +
            ` (replaceOrInsert skipped)`,
        );
        results.push({
          ...baseLog,
          action: "skip",
          reason: "no-product-image",
          productId: product.id,
        });
        continue;
      }
    } else if (hasNonFixedProductImage(html, sharedCatalogUrls)) {
      imageAction = "kept-product";
    }

    const appended = appendAffiliateLinkOnly(html, {
      productId: product.id,
      productName,
      productUrl: resolved.url,
    });

    if (!appended.changed && imageAction === "kept-product") {
      skippedHasLink += 1;
      console.log(
        `[skip:no-change] postId=${post.id} productId=${product.id}`,
      );
      results.push({
        ...baseLog,
        action: "skip",
        reason: "no-change",
        productId: product.id,
      });
      continue;
    }

    if (!appended.changed && imageAction === "not-needed") {
      skippedHasLink += 1;
      console.log(
        `[skip:no-change] postId=${post.id} productId=${product.id}`,
      );
      results.push({
        ...baseLog,
        action: "skip",
        reason: "no-change",
        productId: product.id,
      });
      continue;
    }

    const finalHtml = appended.changed ? appended.html : html;
    if (finalHtml === (post.content || "").trim()) {
      skippedHasLink += 1;
      results.push({
        ...baseLog,
        action: "skip",
        reason: "no-change",
        productId: product.id,
      });
      continue;
    }

    updateCandidates += 1;
    const beforeLen = (post.content || "").length;
    const afterLen = finalHtml.length;
    const diff = diffPreview(post.content || "", finalHtml);

    console.log("----------");
    console.log(`[candidate] postId=${post.id}`);
    console.log(`  title=${post.title}`);
    console.log(`  url=${post.url}`);
    console.log(`  published=${post.published}`);
    console.log(`  productId=${product.id} match=${match}`);
    console.log(`  resolvedUrl=${resolved.url} source=${resolved.source}`);
    console.log(
      `  productImage=${productImage?.url || "(none)"}` +
        ` imageSource=${productImage?.source || "-"}` +
        ` imageAction=${imageAction}`,
    );
    console.log(`  trackedUrl=${appended.trackedUrl || "(unchanged)"}`);
    console.log(`  contentLen ${beforeLen} → ${afterLen}`);
    console.log(`  diffPreview: ${diff}`);

    if (args.dryRun) {
      results.push({
        ...baseLog,
        action: "dry-run-update",
        productId: product.id,
        match,
        resolvedUrl: resolved.url,
        resolveSource: resolved.source,
        trackedUrl: appended.trackedUrl,
        productImageUrl: productImage?.url || null,
        productImageSource: productImage?.source || null,
        imageAction,
        afterImageSrc: afterImageSrc || null,
        beforeLen,
        afterLen,
        diffPreview: diff,
      });
      continue;
    }

    const patched = await client.patchPostContent(blogId, post.id, finalHtml);
    updated += 1;

    writeBackProductUrl(product.id, resolved.url, productsPath, { brand });
    writeBackUrlMap(product.id, resolved.url, undefined, { brand });

    // 取得できた商品画像をカタログへ書き戻し（固定画像を上書き）
    if (productImage?.url) {
      try {
        const catalog = readJson<ProductsFile>(productsPath, {});
        let touched = false;
        for (const list of Object.values(catalog)) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (item.id === product.id) {
              item.imageUrl = productImage.url;
              item.blogUrl = post.url;
              item.productUrl = resolved.url;
              touched = true;
            }
          }
        }
        if (touched) {
          fs.writeFileSync(
            productsPath,
            `${JSON.stringify(catalog, null, 2)}\n`,
            "utf8",
          );
        }
      } catch {
        /* ignore */
      }
    }

    console.log(
      `[updated] postId=${patched.id} title=${patched.title} url=${patched.url}` +
        ` published=${patched.published} imageAction=${imageAction}`,
    );
    results.push({
      ...baseLog,
      action: "updated",
      productId: product.id,
      match,
      resolvedUrl: resolved.url,
      resolveSource: resolved.source,
      trackedUrl: appended.trackedUrl,
      productImageUrl: productImage?.url || null,
      productImageSource: productImage?.source || null,
      imageAction,
      beforeLen,
      afterLen,
      diffPreview: diff,
      afterTitle: patched.title,
      afterPublished: patched.published,
      afterUrl: patched.url,
    });
  }

  const summary = {
    day: bounds.day,
    mode: args.apply ? "apply" : "dry-run",
    listed: listed.length,
    todayPosts: todayPosts.length,
    scanned: targets.length,
    updateCandidates,
    updated,
    skippedHasLink,
    skippedNoProduct,
    skippedResolveFail,
    skippedNoProductImage,
    results,
    at: new Date().toISOString(),
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `backfill-affiliate-${bounds.day}${args.apply ? "-apply" : "-dry-run"}.json`,
  );
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("==========");
  console.log(
    `完了 mode=${summary.mode}` +
      ` today=${summary.todayPosts}` +
      ` candidates=${updateCandidates}` +
      ` updated=${updated}` +
      ` skip(hasLink=${skippedHasLink}, noProduct=${skippedNoProduct}` +
      `, resolveFail=${skippedResolveFail}, noImage=${skippedNoProductImage})`,
  );
  console.log(`log: ${outPath}`);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("backfillBeautyAffiliateLinks エラー:", msg);
  process.exitCode = 1;
});
