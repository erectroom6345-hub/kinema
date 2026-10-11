#!/usr/bin/env node
/**
 * 最低限KPIサマリ:
 * - IG insights（reach / saved / profile_visits / total_interactions）
 * - ブログUTM導線の発信集計（utm_source / campaign / product）
 *
 * ※ ブログ「実クリック／セッション」は GA 等が無いと API 取得不可。
 *    ここでは発信した UTM 本数と、任意の手動クリック上書きを集計する。
 *
 *   node scripts/summarize-kpi.cjs
 *   node scripts/summarize-kpi.cjs --json
 *   node scripts/summarize-kpi.cjs --days=14
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const metricsDir = path.join(root, "output", "metrics");
const historyPath = path.join(metricsDir, "post-history.jsonl");
const insightsPath = path.join(metricsDir, "ig-insights.jsonl");
const clickOverridePath = path.join(metricsDir, "utm-click-overrides.json");
const outPath = path.join(metricsDir, "kpi-summary.json");

function hasFlag(name) {
  return process.argv.includes(name);
}

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  return fallback;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function daysAgoIso(n) {
  const d = new Date();
  d.setTime(d.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function parseUtm(url) {
  try {
    const u = new URL(String(url || ""));
    return {
      source: u.searchParams.get("utm_source") || "",
      medium: u.searchParams.get("utm_medium") || "",
      campaign: u.searchParams.get("utm_campaign") || "",
      content: u.searchParams.get("utm_content") || "",
    };
  } catch {
    return { source: "", medium: "", campaign: "", content: "" };
  }
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function latestInsightsByIg() {
  const rows = readJsonl(insightsPath);
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const row of rows) {
    const id = String(row.igPostId || "").trim();
    if (!id || !row.ok) continue;
    const prev = map.get(id);
    if (!prev || String(row.at || "") >= String(prev.at || "")) {
      map.set(id, row);
    }
  }
  return map;
}

function main() {
  const days = Math.max(1, Number(arg("--days", "14")) || 14);
  const since = daysAgoIso(days);
  const history = readJsonl(historyPath).filter(
    (r) => !r.at || String(r.at) >= since,
  );
  const insightsMap = latestInsightsByIg();
  const clickOverrides = readJson(clickOverridePath, { items: [] });
  const overrideItems = Array.isArray(clickOverrides.items)
    ? clickOverrides.items
    : [];

  let igPosts = 0;
  let sumReach = 0;
  let sumSaved = 0;
  let sumProfile = 0;
  let sumInteractions = 0;
  let withInsights = 0;

  /** @type {Record<string, number>} */
  const utmBySource = {};
  /** @type {Record<string, number>} */
  const utmByCampaign = {};
  /** @type {Array<{productId:string, source:string, campaign:string, utmUrl:string, at:string|null}>} */
  const utmLinks = [];

  for (const row of history) {
    const igId = String(row.igPostId || "").trim();
    if (igId) {
      igPosts += 1;
      const insight = insightsMap.get(igId) || null;
      const m = insight?.metrics || row.metrics || {};
      if (insight?.ok || m.reach != null || m.saved != null) {
        withInsights += 1;
        sumReach += num(m.reach);
        sumSaved += num(m.saved);
        sumProfile += num(m.profile_visits);
        sumInteractions += num(m.total_interactions);
      }
    }

    const utmUrl = String(row.utmUrl || row.igUtmUrl || "").trim();
    if (utmUrl) {
      const u = parseUtm(utmUrl);
      const source = u.source || "unknown";
      const campaign = u.campaign || "unknown";
      utmBySource[source] = (utmBySource[source] || 0) + 1;
      utmByCampaign[campaign] = (utmByCampaign[campaign] || 0) + 1;
      utmLinks.push({
        productId: row.productId || "",
        source,
        campaign,
        utmUrl,
        at: row.at || null,
      });
    }
    // IG用UTMも別途持っている場合
    const igUtm = String(row.igUtmUrl || "").trim();
    if (igUtm && igUtm !== utmUrl) {
      const u = parseUtm(igUtm);
      const source = u.source || "instagram";
      utmBySource[source] = (utmBySource[source] || 0) + 1;
    }
  }

  /** 手動/外部のクリック上書き（任意） */
  let overrideClicks = 0;
  /** @type {Record<string, number>} */
  const clicksBySource = {};
  for (const item of overrideItems) {
    const at = String(item.at || item.day || "");
    if (at && at < since.slice(0, 10)) continue;
    const c = num(item.clicks ?? item.sessions);
    if (!c) continue;
    overrideClicks += c;
    const source = String(item.utm_source || item.source || "unknown");
    clicksBySource[source] = (clicksBySource[source] || 0) + c;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    kpis: {
      // いいね以外の主KPI
      ig_posts: igPosts,
      ig_insights_coverage: withInsights,
      ig_reach: sumReach,
      ig_saved: sumSaved,
      ig_profile_visits: sumProfile,
      ig_total_interactions: sumInteractions,
      utm_links_sent: utmLinks.length,
      blog_sessions_or_clicks: overrideClicks, // GA等が無い場合は手動上書きのみ
    },
    utm: {
      bySource: utmBySource,
      byCampaign: utmByCampaign,
      links: utmLinks.slice(-30),
      note:
        "utm_links_sent は発信数。実クリック/セッションは metrics/utm-click-overrides.json か将来GA連携で埋める。",
    },
    clicks: {
      bySource: clicksBySource,
      total: overrideClicks,
      overridePath: clickOverridePath,
    },
    paths: {
      historyPath,
      insightsPath,
      outPath,
    },
  };

  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (hasFlag("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`KPI summary (${days}d) → ${outPath}`);
  console.log("");
  console.log("[Instagram]");
  console.log(`  posts with igPostId : ${igPosts}`);
  console.log(`  insights coverage   : ${withInsights}`);
  console.log(`  reach               : ${sumReach}`);
  console.log(`  saved               : ${sumSaved}`);
  console.log(`  profile_visits      : ${sumProfile}`);
  console.log(`  total_interactions  : ${sumInteractions}`);
  console.log("");
  console.log("[Blog UTM]");
  console.log(`  links sent          : ${utmLinks.length}`);
  console.log(
    `  by source           : ${JSON.stringify(utmBySource)}`,
  );
  console.log(
    `  blog clicks/sessions: ${overrideClicks}` +
      (overrideClicks === 0
        ? " (未連携。utm-click-overrides.json で手動追加可)"
        : ""),
  );
  console.log("");
  console.log("詳細JSON: node scripts/summarize-kpi.cjs --json");
}

main();
