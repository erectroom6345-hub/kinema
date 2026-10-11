#!/usr/bin/env node
/**
 * 伸び判定ヒットを、対応カテゴリのまとめ記事へ追記する。
 *
 *   node scripts/append-living-blog.cjs --dry-run
 *   node scripts/append-living-blog.cjs --apply
 *   # 公開反映:
 *   npx tsx scripts/publish-living-roundups.ts --apply
 *
 * 12〜15件超で次号 HTML（category-02.html）を切る。
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
const queuePath = path.join(root, "output", "living", "hit-queue.json");
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

function findProduct(products, productId) {
  return allProducts(products).find((p) => (p.id || p.productId) === productId) || null;
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

function main() {
  const apply = hasFlag("--apply");
  const ops = loadLivingOps();
  const splitAt = ops.blog?.splitAfterProducts ?? 15;
  const products = readJson(productsPath, {});
  const registry = readJson(registryPath, null);
  const queue = readJson(queuePath, { items: [] });

  if (!registry?.categories) {
    console.error("先に seed-living-blog を実行してください");
    process.exit(1);
  }

  const pending = (queue.items || []).filter((i) => !i.consumed);
  if (!pending.length) {
    console.log("追記待ちヒットなし");
    return;
  }

  const changes = [];

  for (const hit of pending) {
    const item = findProduct(products, hit.productId);
    if (!item) {
      console.warn(`カタログに無いためスキップ: ${hit.productId}`);
      hit.consumed = true;
      hit.skipReason = "not_in_catalog";
      continue;
    }
    const category = normalizeCategory(
      hit.category || item.category,
      ops.categories,
    );
    const bucket = registry.categories[category];
    if (!bucket?.current) {
      console.warn(`${category} の roundup がありません。seed を先に実行`);
      continue;
    }

    const ids = bucket.current.productIds || [];
    if (ids.includes(hit.productId)) {
      hit.consumed = true;
      hit.skipReason = "already_in_roundup";
      continue;
    }

    // 満杯なら次号へ
    if (ids.length >= splitAt) {
      bucket.archive = bucket.archive || [];
      bucket.archive.push({ ...bucket.current });
      const nextIndex = (bucket.current.index || 1) + 1;
      const titleBase = roundupTitleJa(category, ops);
      bucket.current = {
        postId: null,
        url: null,
        title: `${titleBase} #${nextIndex}`,
        productIds: [],
        localPath: null,
        index: nextIndex,
      };
      console.log(`[${category}] 満杯のため #${nextIndex} を開始`);
    }

    const nextIds = [...(bucket.current.productIds || []), hit.productId];
    const nextItems = nextIds
      .map((id) => findProduct(products, id))
      .filter(Boolean);
    const html = buildRoundupHtml(category, nextItems);
    const index = bucket.current.index || 1;
    const localName = `${category}-${String(index).padStart(2, "0")}.html`;
    const localPath = path.join(outDir, localName);
    fs.mkdirSync(outDir, { recursive: true });

    if (apply) {
      fs.writeFileSync(localPath, `${html}\n`, "utf8");
      bucket.current.productIds = nextIds;
      bucket.current.localPath = path.relative(root, localPath);
      hit.consumed = true;
      hit.consumedAt = new Date().toISOString();
      hit.appendedTo = category;
      hit.roundupIndex = index;
    }

    changes.push({
      productId: hit.productId,
      category,
      index,
      productCount: nextIds.length,
      localPath: path.relative(root, localPath),
    });
    console.log(
      `${apply ? "追記" : "dry-run"}: ${hit.productId} → ${category}#${index} (${nextIds.length}件)`,
    );
  }

  if (apply) {
    registry.updatedAt = new Date().toISOString();
    writeJson(registryPath, registry);
    writeJson(queuePath, queue);
  }

  writeJson(path.join(root, "output", "living", "last-append-report.json"), {
    at: new Date().toISOString(),
    apply,
    changes,
  });

  if (apply) {
    console.log("次: npx tsx scripts/publish-living-roundups.ts --apply");
  }
}

main();
