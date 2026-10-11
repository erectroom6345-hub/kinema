/**
 * 簡易ポリシーチェック（ローカルルールベース）。
 * ルール定義: policy/rules.json
 *
 * 将来 LLM / 外部審査API に差し替えるときは checkTexts() の中身だけ差し替え、
 * 戻り値の形（result / matchedRules / checkedTextPreview）を維持する。
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const defaultRulesPath = path.join(root, "policy", "rules.json");

function loadRules(rulesPath = defaultRulesPath) {
  const raw = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const categories = raw.categories || {};
  const expanded = [];

  for (const [categoryId, cat] of Object.entries(categories)) {
    if (cat.enabled === false) continue;
    const severity = cat.defaultSeverity === "block" ? "block" : "warn";
    const type = cat.type || "contains";
    const patterns = (Array.isArray(cat.patterns) ? cat.patterns : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (type === "require_any") {
      if (patterns.length === 0) continue;
      expanded.push({
        id: `${categoryId}:require_any`,
        category: categoryId,
        label: cat.label || categoryId,
        severity,
        type: "require_any",
        patterns,
        note: cat.note || "",
      });
      continue;
    }

    for (const pattern of patterns) {
      expanded.push({
        id: `${categoryId}:${pattern}`,
        category: categoryId,
        label: cat.label || categoryId,
        severity,
        type: "contains",
        pattern,
        note: cat.note || "",
      });
    }
  }

  return { meta: { version: raw.version, engine: raw.engine }, rules: expanded };
}

/**
 * @param {Array<{ name: string, text: string }>} texts
 * @param {{ productId?: string, channel?: string, rulesPath?: string }} opts
 */
function checkTexts(texts, opts = {}) {
  const checkedAt = new Date().toISOString();
  const { meta, rules } = loadRules(opts.rulesPath);
  const parts = (texts || [])
    .map((t) => ({
      name: String(t.name || "text"),
      text: String(t.text || ""),
    }))
    .filter((t) => t.text.trim());

  const joined = parts.map((p) => `【${p.name}】\n${p.text}`).join("\n\n");
  const preview = joined.slice(0, 400);

  /** @type {Array<object>} */
  const matched = [];

  for (const rule of rules) {
    if (rule.type === "require_any") {
      const hit = (rule.patterns || []).some((p) => joined.includes(p));
      if (!hit) {
        matched.push({
          id: rule.id,
          category: rule.category,
          label: rule.label,
          severity: rule.severity,
          type: rule.type,
          pattern: (rule.patterns || []).join(" | "),
          matchedIn: parts.map((p) => p.name),
          note: rule.note || "必須表記が見つかりません",
        });
      }
      continue;
    }

    if (!joined.includes(rule.pattern)) continue;
    const matchedIn = parts
      .filter((p) => p.text.includes(rule.pattern))
      .map((p) => p.name);
    matched.push({
      id: rule.id,
      category: rule.category,
      label: rule.label,
      severity: rule.severity,
      type: "contains",
      pattern: rule.pattern,
      matchedIn,
      note: rule.note || "",
    });
  }

  const hasBlock = matched.some((m) => m.severity === "block");
  const hasWarn = matched.some((m) => m.severity === "warn");
  const result = hasBlock ? "block" : hasWarn ? "warn" : "ok";

  return {
    checkedAt,
    productId: opts.productId || null,
    channel: opts.channel || "beauty-pipeline",
    result,
    matchedRules: matched,
    checkedTextPreview: preview,
    engine: meta.engine || "local-rules-v1",
    rulesVersion: meta.version || 1,
    textSources: parts.map((p) => p.name),
  };
}

function collectBeautyTexts(rootDir, phase = "all") {
  const readJson = (rel, fallback = {}) => {
    try {
      const p = path.join(rootDir, rel);
      if (!fs.existsSync(p)) return fallback;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return fallback;
    }
  };
  const readText = (rel) => {
    try {
      const p = path.join(rootDir, rel);
      if (!fs.existsSync(p)) return "";
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };

  const article = readJson("input/article.json", {});
  const insta = readJson("input/instagram-post.json", {});
  const product = article.product || {};
  const productId = product.id || "";

  // 直前ランの last-blogger-body は別商品の可能性があるため、
  // last-blogger-publish.json の productId が一致するときだけ使う。
  let lastBody = "";
  try {
    const lastPub = readJson("output/last-blogger-publish.json", null);
    if (
      lastPub &&
      productId &&
      String(lastPub.productId || "") === String(productId)
    ) {
      lastBody = readText("output/last-blogger-body.txt").trim().slice(0, 800);
    }
  } catch {
    lastBody = "";
  }
  const blogIntro =
    String(article.blogBody || "").trim().slice(0, 800) ||
    lastBody ||
    String(article.body || "").trim();

  const caption = String(insta.caption || "").trim();
  const threadsSource =
    caption ||
    String(article.body || "").trim() ||
    String(article.title || "").trim();

  /** @type {Array<{ name: string, text: string }>} */
  const texts = [];
  const wantArticle = phase === "all" || phase === "article";
  const wantSocial = phase === "all" || phase === "social";

  if (wantArticle || wantSocial) {
    if (article.title) texts.push({ name: "title", text: article.title });
    if (product.name) texts.push({ name: "product.name", text: product.name });
    if (product.brand) texts.push({ name: "product.brand", text: product.brand });
    if (article.body) texts.push({ name: "article.body", text: article.body });
    if (blogIntro) texts.push({ name: "blogger.intro", text: blogIntro });
  }
  if (wantSocial) {
    if (caption) texts.push({ name: "instagram.caption", text: caption });
    if (threadsSource) texts.push({ name: "threads.source", text: threadsSource });
  }

  return { productId, texts, article, insta };
}

module.exports = {
  defaultRulesPath,
  loadRules,
  checkTexts,
  collectBeautyTexts,
};
