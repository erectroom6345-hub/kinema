#!/usr/bin/env node
/**
 * living まとめ記事の初期シード（各小分類に2商品）。
 *
 *   node scripts/seed-living-blog.cjs --dry-run
 *   node scripts/seed-living-blog.cjs --apply
 *   # Blogger反映:
 *   npx tsx scripts/publish-living-roundups.ts --apply
 */
const fs = require("fs");
const path = require("path");
const {
  loadLivingOps,
  normalizeCategory,
  categoryLabelJa,
  roundupTitleJa,
  root,
} = require("./lib/living-ops.cjs");

const productsPath = path.join(root, "input", "products-living.json");
const registryPath = path.join(root, "data", "living-blog-roundups.json");
const outDir = path.join(root, "output", "living", "roundups");

function hasFlag(name) {
  return process.argv.includes(name);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function allProducts(products) {
  return [
    ...(products.sale || []),
    ...(products.main || []),
    ...(products.niche || []),
    ...(products.routine || []),
  ];
}

function trackRakutenUrl(rawUrl, productId) {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "blogger");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "affiliate");
    if (!u.searchParams.has("utm_campaign")) {
      u.searchParams.set("utm_campaign", `living_${productId}`);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function buildProductBlock(item) {
  const id = item.id || item.productId;
  const name = item.name || "";
  const desc = item.description || item.articleBody || "";
  const features = Array.isArray(item.features) ? item.features.filter(Boolean) : [];
  const tracked = trackRakutenUrl(item.rakutenUrl || item.url || "", id);
  const featureHtml = features.length
    ? `<ul>${features
        .slice(0, 3)
        .map((f) => `<li>${escapeHtml(f)}</li>`)
        .join("")}</ul>`
    : "";

  return [
    `<section class="living-item" data-product-id="${escapeHtml(id)}">`,
    `<h3>${escapeHtml(name)}</h3>`,
    `<p>${escapeHtml(desc)}</p>`,
    featureHtml,
    item.priceRange
      ? `<p><em>目安価格: ${escapeHtml(item.priceRange)}</em></p>`
      : "",
    `<p><a href="${escapeHtml(tracked)}" rel="nofollow sponsored noopener" target="_blank">${escapeHtml(name)} を楽天で見る</a></p>`,
    `</section>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRoundupHtml(category, items) {
  const intro = `${categoryLabelJa(category)}まわりで、毎日の動線が少し楽になりそうな便利グッズをまとめています。効果を断定せず、使う場面がイメージしやすいものを中心に載せています。※本記事にはPRを含みます。`;
  const blocks = items.map(buildProductBlock).join("\n<hr />\n");
  return `<p>${escapeHtml(intro)}</p>\n${blocks}\n`;
}

function emptyRegistry(ops) {
  const categories = {};
  for (const cat of ops.categories || ["kitchen", "storage", "cleaning", "other"]) {
    categories[cat] = {
      current: {
        postId: null,
        url: null,
        title: roundupTitleJa(cat, ops),
        productIds: [],
        localPath: null,
        index: 1,
      },
      archive: [],
    };
  }
  return {
    genre: "living",
    affiliate: "rakuten_only",
    fixedPageUrl: ops.fixedPageUrl || null,
    updatedAt: new Date().toISOString(),
    categories,
  };
}

function main() {
  const apply = hasFlag("--apply");
  const dryRun = hasFlag("--dry-run") || !apply;

  const ops = loadLivingOps();
  const seedN = ops.blog?.seedPerCategory ?? 2;
  const products = readJson(productsPath, {});
  const items = allProducts(products);
  let registry = readJson(registryPath, null) || emptyRegistry(ops);
  registry.fixedPageUrl = ops.fixedPageUrl || registry.fixedPageUrl || null;

  fs.mkdirSync(outDir, { recursive: true });
  const summary = [];

  for (const category of ops.categories || []) {
    const existingIds = new Set(registry.categories?.[category]?.current?.productIds || []);
    const catItems = items
      .filter((p) => normalizeCategory(p.category, ops.categories) === category)
      .slice(0, seedN);

    if (catItems.length < seedN) {
      console.warn(
        `警告: ${category} のシードが ${catItems.length}/${seedN} 件です（カタログ追加を推奨）`,
      );
    }
    if (!catItems.length) continue;

    // 既存シードがある場合は上書きせずスキップ（--force で再生成）
    if (existingIds.size >= seedN && !hasFlag("--force")) {
      console.log(`[${category}] 既存シードあり → スキップ（再生成は --force）`);
      continue;
    }

    const title = roundupTitleJa(category, ops);
    const html = buildRoundupHtml(category, catItems);
    const localName = `${category}-01.html`;
    const localPath = path.join(outDir, localName);
    fs.writeFileSync(localPath, `${html}\n`, "utf8");

    const productIds = catItems.map((p) => p.id || p.productId);
    const prev = registry.categories[category]?.current || {};
    registry.categories[category] = {
      current: {
        postId: prev.postId || null,
        url: prev.url || null,
        title,
        productIds,
        localPath: path.relative(root, localPath),
        index: 1,
        seededAt: new Date().toISOString(),
      },
      archive: registry.categories[category]?.archive || [],
    };
    summary.push({ category, title, productIds, localPath: path.relative(root, localPath) });
    console.log(`[${category}] ${productIds.length}件 → ${path.relative(root, localPath)}`);
  }

  registry.updatedAt = new Date().toISOString();
  if (!dryRun || apply) {
    writeJson(registryPath, registry);
  } else {
    // dry-run でも草稿HTMLは確認用に書く。registry は apply 時に確定保存。
    writeJson(registryPath, registry);
  }

  writeJson(path.join(root, "output", "living", "last-seed-report.json"), {
    mode: apply ? "apply" : "dry-run",
    at: registry.updatedAt,
    summary,
  });

  console.log(`registry: ${registryPath}`);
  console.log("次: npx tsx scripts/publish-living-roundups.ts --dry-run");
  console.log(apply || !dryRun ? "seed 完了" : "seed dry-run 完了");
}

main();
