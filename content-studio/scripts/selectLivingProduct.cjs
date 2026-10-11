/**
 * living 商品選定。
 * - 曜日カレンダー（kitchen多め）
 * - sale/campaign 割り込み（週最大2回）
 * - popular は通常枠内で優先
 * - 同一 category 連続禁止 / 同一商品 14日クールダウン
 * - 価格帯 500–5000（優先 1000–3000）
 */
const fs = require("fs");
const path = require("path");
const {
  loadLivingOps,
  normalizeCategory,
  isPriceInBand,
  estimatePriceYen,
  scheduledCategoryForToday,
  tokyoWeekdayKey,
  interruptKind,
  isPopular,
  readLabels,
  isSameTokyoWeek,
} = require("./lib/living-ops.cjs");

const productsPath = path.join(__dirname, "..", "input", "products-living.json");
const postedPath = path.join(__dirname, "..", "data", "posted-living.json");
const articlePath = path.join(__dirname, "..", "input", "article.json");
const nextRepostPath = path.join(__dirname, "..", "output", "repost", "next-repost-living.json");
const snsHistoryPath = path.join(
  __dirname,
  "..",
  "output",
  "metrics",
  "living-sns-posts.jsonl",
);

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function flattenProducts(products) {
  return {
    sale: products.sale || [],
    main: products.main || [],
    niche: products.niche || [],
    routine: products.routine || [],
  };
}

function allItems(products) {
  const g = flattenProducts(products);
  return [...g.sale, ...g.main, ...g.niche, ...g.routine];
}

function findById(products, productId) {
  return allItems(products).find((item) => (item.id || item.productId) === productId) || null;
}

function loadSnsHistory() {
  if (!fs.existsSync(snsHistoryPath)) return [];
  return fs
    .readFileSync(snsHistoryPath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
}

function lastPostedCategory(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const cat = normalizeCategory(history[i].category);
    if (cat) return cat;
  }
  return null;
}

function recentlyPostedProductIds(history, coolDownDays) {
  const cutoff = Date.now() - coolDownDays * 86_400_000;
  const ids = new Set();
  for (const row of history) {
    const t = Date.parse(row.at || "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (row.productId) ids.add(row.productId);
  }
  return ids;
}

function productOk(item, ops) {
  const id = (item.id || item.productId || "").trim();
  const name = (item.name || "").trim();
  const rakutenUrl = (item.rakutenUrl || item.url || "").trim();
  const imageUrl = (item.imageUrl || "").trim();
  const description = (item.description || item.articleBody || "").trim();
  if (!id || !name || !rakutenUrl || !imageUrl || !description) return false;
  const rules = ops.productRules || {};
  if (
    !isPriceInBand(
      item.priceRange,
      rules.priceMinYen ?? 500,
      rules.priceMaxYen ?? 5000,
    )
  ) {
    return false;
  }
  return true;
}

function isPreferredPrice(item, ops) {
  const rules = ops.productRules || {};
  const yen = estimatePriceYen(item.priceRange);
  if (yen == null) return false;
  const min = rules.preferredPriceMinYen ?? 1000;
  const max = rules.preferredPriceMaxYen ?? 3000;
  return yen >= min && yen <= max;
}

/** 通常枠: popular → 優先価格帯 → その他 */
function pickBest(candidates, ops) {
  if (!candidates.length) return null;
  const rank = (item) => {
    let score = 0;
    if (isPopular(item)) score += 100;
    if (isPreferredPrice(item, ops)) score += 10;
    return score;
  };
  return [...candidates].sort((a, b) => rank(b) - rank(a))[0];
}

function countInterruptsThisWeek(history) {
  return history.filter((row) => {
    if (!isSameTokyoWeek(row.at)) return false;
    if (row.interrupt === "sale" || row.interrupt === "campaign") return true;
    return String(row.selectedSource || "").startsWith("interrupt");
  }).length;
}

function pickInterrupt(pool, ops, blockedCat) {
  const cfg = ops.interrupt || {};
  if (cfg.enabled === false) return null;
  const priority = cfg.priority || ["campaign", "sale"];
  const respectGap = cfg.respectCategoryGap !== false;

  for (const kind of priority) {
    const candidates = pool.filter((item) => interruptKind(item) === kind);
    const ordered = [...candidates].sort((a, b) => {
      const ap = isPreferredPrice(a, ops) ? 1 : 0;
      const bp = isPreferredPrice(b, ops) ? 1 : 0;
      return bp - ap;
    });
    for (const item of ordered) {
      const cat = normalizeCategory(item.category, ops.categories);
      if (respectGap && blockedCat && cat === blockedCat) continue;
      return { item, kind, cat };
    }
  }
  return null;
}

/**
 * 優先順:
 * 0) sale/campaign 割り込み（週 maxPerWeek、category連続は避ける）
 * 1) 今日のスケジュール category（popular優先）
 * 2) fallbackOrder
 * 3) 連続除外を緩和
 */
function chooseItem(products, posted, ops) {
  const all = allItems(products).filter((item) => productOk(item, ops));
  const postedList = Array.isArray(posted) ? posted : [];
  const history = loadSnsHistory();
  const coolDownDays = ops.productRules?.productCoolDownDays ?? 14;
  const recentIds = recentlyPostedProductIds(history, coolDownDays);
  const lastCat = lastPostedCategory(history);
  const minGap = ops.categorySchedule?.minCategoryGapDays ?? 1;
  const scheduled = scheduledCategoryForToday(ops);
  const weekday = tokyoWeekdayKey();
  const fallbackOrder = ops.categorySchedule?.fallbackOrder || [
    "kitchen",
    "cleaning",
    "storage",
    "other",
  ];
  const maxInterrupt = ops.interrupt?.maxPerWeek ?? 2;
  const interruptsUsed = countInterruptsThisWeek(history);

  const unposted = all.filter((item) => !postedList.includes(item.id || item.productId));
  const basePool = (unposted.length ? unposted : all).filter(
    (item) => !recentIds.has(item.id || item.productId),
  );
  const pool = basePool.length
    ? basePool
    : unposted.length
      ? unposted
      : all;

  if (!pool.length) {
    return {
      item: null,
      recycled: false,
      remainingUnposted: 0,
      meta: { scheduled, weekday, lastCat, interruptsUsed },
    };
  }

  const byCat = (cat) =>
    pool.filter((item) => normalizeCategory(item.category, ops.categories) === cat);

  const blockedCat = minGap >= 1 ? lastCat : null;

  // 0) 割り込み
  if (interruptsUsed < maxInterrupt) {
    const hit = pickInterrupt(pool, ops, blockedCat);
    if (hit) {
      return {
        item: hit.item,
        recycled: unposted.length === 0,
        remainingUnposted: Math.max(
          0,
          unposted.length - (unposted.includes(hit.item) ? 1 : 0),
        ),
        meta: {
          weekday,
          scheduled,
          chosenCat: hit.cat,
          lastCat,
          usedFallback: hit.cat !== scheduled,
          preferredPrice: isPreferredPrice(hit.item, ops),
          coolDownSkipped: basePool.length === 0 && pool.length > 0,
          interrupt: hit.kind,
          interruptsUsed,
          popular: isPopular(hit.item),
        },
      };
    }
  }

  const tryOrder = [scheduled, ...fallbackOrder.filter((c) => c !== scheduled)];

  let chosen = null;
  let chosenCat = null;
  let usedFallback = false;

  for (const cat of tryOrder) {
    if (blockedCat && cat === blockedCat) continue;
    const hit = pickBest(byCat(cat), ops);
    if (hit) {
      chosen = hit;
      chosenCat = cat;
      usedFallback = cat !== scheduled;
      break;
    }
  }

  if (!chosen) {
    for (const cat of tryOrder) {
      const hit = pickBest(byCat(cat), ops);
      if (hit) {
        chosen = hit;
        chosenCat = cat;
        usedFallback = true;
        break;
      }
    }
  }

  if (!chosen) {
    chosen = pickBest(pool, ops);
    chosenCat = normalizeCategory(chosen?.category, ops.categories);
    usedFallback = true;
  }

  const recycled = unposted.length === 0;
  return {
    item: chosen,
    recycled,
    remainingUnposted: Math.max(
      0,
      unposted.length - (chosen && unposted.includes(chosen) ? 1 : 0),
    ),
    meta: {
      weekday,
      scheduled,
      chosenCat,
      lastCat,
      usedFallback,
      preferredPrice: chosen ? isPreferredPrice(chosen, ops) : false,
      coolDownSkipped: basePool.length === 0 && pool.length > 0,
      interrupt: null,
      interruptsUsed,
      popular: chosen ? isPopular(chosen) : false,
    },
  };
}

function trySelectRepostNext(products) {
  const use =
    process.argv.includes("--use-repost-next") ||
    String(process.env.LIVING_USE_REPOST || "").toLowerCase() === "true";
  if (!use) return null;
  const next = readJson(nextRepostPath, null);
  if (!next || !next.productId || next.consumed) return null;
  const item = findById(products, next.productId);
  if (!item) return null;
  return { item, next };
}

function buildFeaturesNote(item) {
  const features = Array.isArray(item.features) ? item.features.filter(Boolean) : [];
  const price = (item.priceRange || "").trim();
  const labels = readLabels(item);
  const parts = [];
  if (labels.campaign) parts.push("キャンペーン確認");
  if (labels.sale) parts.push("セール確認");
  if (labels.popular) parts.push("人気候補");
  if (price) parts.push(`目安価格: ${price}`);
  if (features.length) parts.push(`ポイント: ${features.slice(0, 3).join(" / ")}`);
  return parts.join("。");
}

function toArticleJson(item, ops, meta = {}) {
  const id = (item.id || item.productId || "").trim();
  const name = (item.name || "").trim();
  const category = normalizeCategory(item.category, ops.categories);
  const rakutenUrl = (item.rakutenUrl || item.url || "").trim();
  const description = (item.description || item.articleBody || "").trim();
  const title =
    (item.articleTitle || "").trim() || `${name}、毎日の導線で使いやすいと感じた点`;
  const body = (item.articleBody || "").trim() || description;
  const labels = readLabels(item);
  const kind = meta.interrupt || interruptKind(item);

  return {
    title,
    body,
    selectedSource: null,
    pipelineGenre: "living",
    product: {
      id,
      productId: id,
      name,
      category,
      description,
      priceRange: item.priceRange || "",
      features: Array.isArray(item.features) ? item.features : [],
      genre: "living",
      pipelineGenre: "living",
      url: rakutenUrl,
      rakutenUrl,
      blogUrl: "",
      imageUrl: item.imageUrl || "",
      postType: kind === "sale" || kind === "campaign" ? kind : item.postType || "main",
      seed: Boolean(item.seed),
      labels,
      interrupt: kind || null,
    },
    affiliateNote: buildFeaturesNote(item),
  };
}

function main() {
  const ops = loadLivingOps();
  const forceId = (process.argv.find((a) => a.startsWith("--productId=")) || "").slice(
    "--productId=".length,
  );
  const forceCat = (process.argv.find((a) => a.startsWith("--category=")) || "").slice(
    "--category=".length,
  );
  const products = readJson(productsPath, {});
  const posted = readJson(postedPath, []);

  let selected;
  let recycled = false;
  let remainingUnposted = 0;
  let selectedSource;
  let repost = null;
  let meta = {};

  if (forceId) {
    selected = findById(products, forceId);
    selectedSource = "forced";
    if (!selected) {
      console.error(`指定 productId が見つかりません: ${forceId}`);
      process.exit(1);
    }
    if (!productOk(selected, ops)) {
      console.error(`指定商品がルール外です: ${forceId}`);
      process.exit(1);
    }
    meta = { interrupt: interruptKind(selected) };
  } else if (forceCat) {
    const opsForced = {
      ...ops,
      interrupt: { ...(ops.interrupt || {}), enabled: false },
      categorySchedule: {
        ...(ops.categorySchedule || {}),
        weekly: {
          mon: forceCat,
          tue: forceCat,
          wed: forceCat,
          thu: forceCat,
          fri: forceCat,
          sat: forceCat,
          sun: forceCat,
        },
      },
    };
    const chosen = chooseItem(products, posted, opsForced);
    selected = chosen.item;
    recycled = chosen.recycled;
    remainingUnposted = chosen.remainingUnposted;
    selectedSource = recycled ? "recycle" : "unposted";
    meta = chosen.meta || {};
  } else {
    repost = trySelectRepostNext(products);
    if (repost) {
      selected = repost.item;
      selectedSource = "repost";
      console.log("=== 再投稿候補を適用 (--use-repost-next) ===");
      meta = { interrupt: interruptKind(selected) };
    } else {
      const chosen = chooseItem(products, posted, ops);
      selected = chosen.item;
      recycled = chosen.recycled;
      remainingUnposted = chosen.remainingUnposted;
      meta = chosen.meta || {};
      if (meta.interrupt) {
        selectedSource = `interrupt-${meta.interrupt}`;
      } else {
        selectedSource = recycled ? "recycle" : "unposted";
      }
    }
  }

  if (!selected) {
    console.error("=== living 商品リストが空、またはルール適合商品がありません ===");
    console.error(`参照: ${productsPath}`);
    process.exit(1);
  }

  const article = toArticleJson(selected, ops, meta);
  article.selectedSource = selectedSource;
  if (meta.weekday) {
    article.schedule = {
      weekday: meta.weekday,
      scheduledCategory: meta.scheduled,
      chosenCategory: meta.chosenCat,
      usedFallback: Boolean(meta.usedFallback),
      interrupt: meta.interrupt || null,
      interruptsUsedThisWeek: meta.interruptsUsed ?? 0,
    };
  }
  writeJson(articlePath, article);

  if (repost) {
    writeJson(nextRepostPath, {
      ...repost.next,
      consumed: true,
      consumedAt: new Date().toISOString(),
    });
  }

  console.log("選択された商品:", article.product.id);
  console.log("category:", article.product.category);
  if (meta.interrupt) {
    console.log(
      `interrupt: ${meta.interrupt} (week ${meta.interruptsUsed ?? 0}/${ops.interrupt?.maxPerWeek ?? 2})`,
    );
  } else if (meta.weekday) {
    console.log(
      `schedule: ${meta.weekday}→${meta.scheduled}` +
        (meta.usedFallback ? ` (fallback→${meta.chosenCat})` : " (hit)"),
    );
  }
  console.log("popular:", meta.popular || isPopular(selected) ? "yes" : "no");
  console.log("preferredPrice:", meta.preferredPrice ? "yes" : "no");
  console.log("pipelineGenre: living");
  console.log("cta: fixed_page");
  console.log("ローテ再選択:", recycled ? "yes" : "no");
  console.log("selectedSource:", article.selectedSource);
  console.log("残り未投稿(概算):", remainingUnposted);
  console.log("article.json を更新しました");
}

main();
