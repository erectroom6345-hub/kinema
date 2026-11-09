/**
 * 美容商品の選定（本番日次 / recycle / repost / test を完全分離）。
 *
 * 本番日次 (既定):
 *   - 未投稿のみ。在庫0で停止。recycle には絶対に入らない
 *   - test フラグが残っていれば即 exit 3
 *
 * recycle: --mode=recycle または BEAUTY_PIPELINE_MODE=recycle（手動/専用のみ）
 * repost:  --use-repost-next（人気記事。失敗時も日次へ落とさない）
 * test:    CONTENT_STUDIO_ENV=test / BEAUTY_TEST_MODE=true
 *          → data/posted-beauty.test.json + simulate 許可
 *
 * Usage:
 *   node scripts/selectBeautyProduct.cjs
 *   node scripts/selectBeautyProduct.cjs --dry-run
 *   node scripts/selectBeautyProduct.cjs --mode=recycle --dry-run
 *   BEAUTY_TEST_MODE=true node scripts/selectBeautyProduct.cjs --dry-run
 */
const fs = require("fs");
const path = require("path");
const {
  assertProductionDailySafe,
  describeRuntime,
  isTestMode,
  resolvePostedPath,
  resolvePipelineMode,
} = require("./lib/beauty-runtime.cjs");
const {
  chooseByStrategy,
  formatStrategyLog,
  loadSelectConfig,
  previewTomorrowPlan,
  tokyoDayKey: strategyTokyoDayKey,
} = require("./lib/beauty-select-strategy.cjs");
const {
  loadSyncStatus,
  loadWindows,
} = require("./lib/beauty-sale-windows.cjs");
const {
  assertProductionCopyClean,
  isProductionEligibleProduct,
  isRecentDuplicateProduct,
  loadRecentBeautyPosts,
} = require("./lib/beauty-copy-guard.cjs");
const {
  buildProfitContext,
  catalogMapFromProducts,
  pickBestByProfit,
  tokyoDayKey: profitTokyoDayKey,
} = require("./lib/beauty-profit-score.cjs");

const productsPath = path.join(__dirname, "..", "input", "products-beauty.json");
const articlePath = path.join(__dirname, "..", "input", "article.json");
const nextRepostPath = path.join(
  __dirname,
  "..",
  "output",
  "repost",
  "next-repost.json"
);
const runHistoryDir = path.join(__dirname, "..", "output", "run-history");
const lastRunSummaryPath = path.join(
  __dirname,
  "..",
  "output",
  "last-run-summary.json"
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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function buildAffiliateNote(item) {
  const parts = [];
  if (item.labels?.sale) parts.push("セール対象");
  if (item.labels?.point) parts.push("ポイント対象");
  if (item.labels?.conditionalDeal) parts.push("条件次第でお得");
  if (item.labels?.detailCheck) parts.push("詳細は商品ページで確認");
  return parts.join("、");
}

function isUnusableBlogUrl(blogUrl) {
  const raw = (blogUrl || "").trim();
  if (!raw) return true;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG/i.test(raw) || /REPLACE-/i.test(raw)) {
    return true;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const p = (u.pathname || "/").replace(/\/+$/, "") || "/";
    if (p === "/") return true;
    return false;
  } catch {
    return true;
  }
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
  const groups = flattenProducts(products);
  return [
    ...groups.sale,
    ...groups.main,
    ...groups.niche,
    ...groups.routine,
  ];
}

function findById(products, productId) {
  return allItems(products).find((item) => item.id === productId) || null;
}

function tokyoDayKey(d = new Date()) {
  return strategyTokyoDayKey(d);
}

function tokyoWeekdayKey(dateStr) {
  const d = dateStr
    ? new Date(`${String(dateStr).slice(0, 10)}T12:00:00+09:00`)
    : new Date();
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(d);
  return (
    {
      Sun: "sun",
      Mon: "mon",
      Tue: "tue",
      Wed: "wed",
      Thu: "thu",
      Fri: "fri",
      Sat: "sat",
    }[short] || ""
  );
}

function loadBeautyTips(config) {
  const rel = String(config?.tipPosts?.catalogPath || "input/products-beauty-tips.json");
  const filePath = path.isAbsolute(rel) ? rel : path.join(__dirname, "..", rel);
  const data = readJson(filePath, { tip: [] });
  const list = Array.isArray(data.tip) ? data.tip : Array.isArray(data) ? data : [];
  return list.filter((item) => item && item.id && item.ask);
}

function pickBeautyTip(tips, postedIds) {
  const posted = Array.isArray(postedIds) ? postedIds.map((id) => String(id)) : [];
  const unused = tips.filter((item) => !posted.includes(String(item.id)));
  if (unused.length) return unused[0];
  let best = tips[0];
  let bestIdx = Infinity;
  for (const item of tips) {
    const idx = posted.lastIndexOf(String(item.id));
    const rank = idx < 0 ? -1 : idx;
    if (rank < bestIdx) {
      bestIdx = rank;
      best = item;
    }
  }
  return best;
}

function toTipArticle(item) {
  const ask = String(item.ask || "").trim();
  const aside = String(item.aside || "").trim();
  return {
    title: item.articleTitle || ask,
    body: item.articleBody || [ask, aside].filter(Boolean).join("\n"),
    selectedSource: "tip",
    pipelineGenre: "beauty",
    product: {
      id: item.id,
      name: item.name || "今日の話",
      brand: "",
      category: item.category || "other",
      genre: item.genre || "スキンケア",
      url: "",
      blogUrl: "",
      imageUrl: "",
      postType: "tip",
      affiliate: false,
      ask,
      aside,
      cardSlides: Array.isArray(item.cardSlides) ? item.cardSlides : [],
      labels: { tip: true },
    },
    affiliateNote: "アフィ無し・話しかけ",
  };
}

function productIdsPostedToday() {
  const today = tokyoDayKey();
  const ids = new Set();

  const pushIfToday = (summary) => {
    if (!summary || !summary.productId) return;
    const status = String(summary.status || "");
    if (status !== "success" && status !== "partial") return;
    const genre = String(summary.genre || summary.channel || "");
    if (genre && !/beauty/i.test(genre)) return;
    const when = summary.finishedAt || summary.startedAt || "";
    if (!when) return;
    try {
      if (tokyoDayKey(new Date(when)) !== today) return;
    } catch {
      return;
    }
    ids.add(String(summary.productId));
  };

  pushIfToday(readJson(lastRunSummaryPath, null));
  try {
    if (fs.existsSync(runHistoryDir)) {
      for (const name of fs.readdirSync(runHistoryDir)) {
        if (!name.endsWith(".json")) continue;
        if (name.startsWith("living-")) continue;
        pushIfToday(readJson(path.join(runHistoryDir, name), null));
      }
    }
  } catch {
    // ignore
  }
  return ids;
}

/**
 * 通常日次: 日付条件戦略でバケット優先 → 未投稿のみ。recycle 分岐は存在しない。
 * （旧: sale→main→niche→routine 固定順の先頭未投稿）
 */
function chooseUnpostedOnly(products, posted, opts = {}) {
  const todayIds = productIdsPostedToday();
  if (todayIds.size) {
    console.log(
      `[select:daily] same-day guard: already posted today=${[...todayIds].join(",")}`
    );
  }

  const recent = loadRecentBeautyPosts();
  console.log(
    `[select:daily] recent-cooldown days=${recent.coolDownDays}` +
      ` ids=${[...recent.ids].join(",") || "(none)"}` +
      ` urlKeys=${recent.urlKeys.size}`,
  );

  const result = chooseByStrategy(products, posted, {
    ...opts,
    todayIds,
    recent,
    isProductionEligibleProduct,
    isRecentDuplicateProduct,
    productionFilter: !isTestMode(),
  });

  console.log(formatStrategyLog(result));

  // 翌朝9時の予定（本番日次ログ用）
  const tomorrow = previewTomorrowPlan(products, { config: opts.config });
  if (tomorrow) {
    console.log(
      `[select:tomorrow] targetDate=${tomorrow.targetDate}` +
        ` saleDay=${tomorrow.saleDay}` +
        ` nicheDue=${tomorrow.nicheDue}` +
        ` routineDue=${tomorrow.routineDue}` +
        ` primaryBucket=${tomorrow.primaryBucket}` +
        ` priorityOrder=${tomorrow.priorityOrder.join(">")}` +
        ` tryOrder=${tomorrow.tryOrder.join(">")}`
    );
  }

  if (!result.item) {
    if (result.reason === "unposted_empty") {
      console.log(
        "[select:daily] STOP: 未投稿在庫=0 → recycle には進まない（日次は新規専用）"
      );
      console.log(
        "[select:daily] recycle が必要なら: bash run-beauty-recycle.sh"
      );
    } else if (result.reason === "same_day_already_posted") {
      console.log(
        "[select:daily] STOP: 候補は同一日ガードまたは全バケット在庫切れ"
      );
    }
  } else {
    console.log(
      `[select:daily] OK bucket=${result.selectedBucket} id=${result.item.id}` +
        ` fallbackUsed=${result.fallbackUsed} recycleUsed=false`
    );
  }

  return result;
}

/**
 * recycle: 投稿済みから利潤スコア最大を選ぶ（最古固定はやめる）。
 * 本番適格（testOnly / 禁止語 / 実URL）だけを対象にする。
 * opts.ignoreRecentCooldown: 在庫0フォールバック時は直近重複を無視（小カタログで止まらないため）
 */
function chooseRecycleItem(products, posted, opts = {}) {
  const all = allItems(products);
  const postedList = Array.isArray(posted) ? posted : [];
  const byId = new Map(all.map((item) => [item.id, item]));
  const todayIds = productIdsPostedToday();
  const ignoreRecent = opts.ignoreRecentCooldown === true;
  const recent = ignoreRecent ? null : loadRecentBeautyPosts();
  const targetDate = profitTokyoDayKey();
  const profitCtx = buildProfitContext({
    catalogById: catalogMapFromProducts(products),
  });

  console.log(
    `[select:recycle] ENTER recycle catalog=${all.length} posted=${postedList.length}` +
      ` ignoreRecentCooldown=${ignoreRecent}` +
      (todayIds.size
        ? ` skipToday=${[...todayIds].join(",")}`
        : " skipToday=(none)"),
  );
  console.log(
    `[select:recycle] inventory catalog=${all.length} posted=${postedList.length} recycleUsed=true`,
  );

  if (all.length === 0) {
    return {
      item: null,
      selectedSource: null,
      remainingUnposted: 0,
      reason: "catalog_empty",
      catalogCount: 0,
      unpostedCount: 0,
      recycleUsed: true,
    };
  }

  const eligible = [];
  const seen = new Set();
  const consider = (id) => {
    const hit = byId.get(id);
    if (!hit || seen.has(hit.id)) return;
    seen.add(hit.id);
    if (todayIds.has(hit.id)) {
      console.log(`[select:recycle] SKIP same-day id=${hit.id}`);
      return;
    }
    if (!isProductionEligibleProduct(hit)) {
      console.log(`[select:recycle] SKIP ineligible id=${hit.id}`);
      return;
    }
    if (!ignoreRecent && recent) {
      const dup = isRecentDuplicateProduct(hit, recent);
      if (dup.duplicate) {
        console.log(`[select:recycle] SKIP recent-dup id=${hit.id} (${dup.reason})`);
        return;
      }
    }
    eligible.push(hit);
  };

  for (const id of postedList) consider(id);
  for (const p of all) consider(p.id);

  if (!eligible.length) {
    console.log(
      "[select:recycle] STOP: 本番適格な recycle 候補なし（同一日 or 全件除外）",
    );
    return {
      item: null,
      selectedSource: null,
      remainingUnposted: 0,
      reason: "same_day_already_posted",
      catalogCount: all.length,
      unpostedCount: 0,
      recycleUsed: true,
    };
  }

  const picked = pickBestByProfit(eligible, profitCtx, {
    targetDate,
    mode: "recycle",
    bucket: eligible[0]?.postType || "main",
  });
  const hit = picked.item || eligible[0];
  console.log(
    `[select:recycle] OK id=${hit.id} selectedId=${hit.id}` +
      ` reason=recycle_profit_score profitScore=${picked.score ?? "-"} recycleUsed=true`,
  );
  return {
    item: hit,
    selectedSource: "recycle",
    remainingUnposted: 0,
    reason: "recycle_profit_score",
    catalogCount: all.length,
    unpostedCount: 0,
    recycleUsed: true,
    selectedBucket: hit.postType || null,
    fallbackUsed: true,
    profitScore: picked.score,
    profitBreakdown: picked.breakdown,
  };
}

/** 未投稿0件時: recycle（既定）または skip */
function resolveEmptyFallbackMode() {
  const raw = String(process.env.BEAUTY_EMPTY_FALLBACK || "recycle").toLowerCase();
  if (raw === "skip" || raw === "stop" || raw === "none") return "skip";
  return "recycle";
}

function selectRepostNext(products) {
  console.log("[select:repost] ENTER --use-repost-next / BEAUTY_USE_REPOST");
  const next = readJson(nextRepostPath, null);
  if (!next || !next.productId) {
    console.error(
      `[select:repost] FAIL: ${nextRepostPath} が無い/productIdなし（日次へフォールバックしない）`
    );
    return {
      item: null,
      selectedSource: null,
      remainingUnposted: null,
      reason: "repost_missing",
      next: null,
      recycleUsed: false,
    };
  }
  if (next.consumed) {
    console.error(
      "[select:repost] FAIL: 候補は消費済み（日次へフォールバックしない）"
    );
    return {
      item: null,
      selectedSource: null,
      remainingUnposted: null,
      reason: "repost_consumed",
      next,
      recycleUsed: false,
    };
  }
  const item = findById(products, next.productId);
  if (!item) {
    console.error(
      `[select:repost] FAIL: カタログに ${next.productId} なし（日次へフォールバックしない）`
    );
    return {
      item: null,
      selectedSource: null,
      remainingUnposted: null,
      reason: "repost_not_in_catalog",
      next,
      recycleUsed: false,
    };
  }
  console.log(
    `[select:repost] OK id=${item.id} score=${next.score ?? "-"} source=next-repost.json recycleUsed=false`
  );
  return {
    item,
    selectedSource: "repost",
    remainingUnposted: null,
    reason: "repost_next",
    next,
    recycleUsed: false,
  };
}

function toArticleJson(item) {
  const note = buildAffiliateNote(item);
  const rawBlogUrl = (item.blogUrl || "").trim();
  const blogUrlUsable = !isUnusableBlogUrl(rawBlogUrl);
  if (!blogUrlUsable) {
    console.warn(
      `blogUrl 未整備 (id=${item.id}): ${rawBlogUrl || "(空)"} → URLなしで投稿続行します`
    );
  } else {
    console.log(`blogUrl 有効 (id=${item.id}): ${rawBlogUrl}`);
  }
  return {
    title: item.articleTitle,
    body: item.articleBody,
    selectedSource: null,
    product: {
      id: item.id,
      name: item.productName,
      brand: item.brand,
      category: item.category,
      genre: item.genre,
      url: (item.affiliateUrl || item.productUrl || "").trim(),
      blogUrl: blogUrlUsable ? rawBlogUrl : "",
      imageUrl: item.imageUrl,
      postType: item.postType,
    },
    affiliateNote: note,
  };
}

function parseBoolFlag(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function buildMorningReadyLog(result) {
  const st = loadSyncStatus();
  const win = loadWindows();
  const windowsCount = Object.keys(win.items || {}).length;
  return {
    targetDate: result?.targetDate || "(n/a)",
    provider: st.provider || process.env.BEAUTY_SALE_PROVIDER || "official-page",
    windowsCount,
    saleDay: result?.saleDay === true,
    selectedBucket: result?.selectedBucket || "(none)",
    selectedId: result?.item ? result.item.id : "(none)",
    fallbackUsed: result?.fallbackUsed === true,
    syncStatus: st.syncStatus || "missing",
    yahooCheckSkipped: st.yahooCheckSkipped,
    yahooCheckTriggered: st.yahooCheckTriggered,
    yahooSaleDetected: st.yahooSaleDetected,
  };
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    mode: "daily",
    useRepostNext: false,
    help: false,
    simulateUnpostedAll: false,
    simulatePostedAll: false,
    targetDate: null,
    forceSaleDay: undefined,
    forceNicheDue: undefined,
    forceRoutineDue: undefined,
    emptyBucket: null,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--use-repost-next") out.useRepostNext = true;
    else if (arg === "--mode=daily") out.mode = "daily";
    else if (arg === "--mode=recycle") out.mode = "recycle";
    else if (arg === "--mode=repost") {
      out.mode = "repost";
      out.useRepostNext = true;
    } else if (arg === "--simulate-unposted-all") out.simulateUnpostedAll = true;
    else if (arg === "--simulate-posted-all") out.simulatePostedAll = true;
    else if (arg.startsWith("--date=")) out.targetDate = arg.slice("--date=".length).slice(0, 10);
    else if (arg.startsWith("--force-sale-day=")) {
      out.forceSaleDay = parseBoolFlag(arg.slice("--force-sale-day=".length));
    } else if (arg.startsWith("--force-niche-due=")) {
      out.forceNicheDue = parseBoolFlag(arg.slice("--force-niche-due=".length));
    } else if (arg.startsWith("--force-routine-due=")) {
      out.forceRoutineDue = parseBoolFlag(arg.slice("--force-routine-due=".length));
    } else if (arg.startsWith("--empty-bucket=")) {
      out.emptyBucket = arg.slice("--empty-bucket=".length).trim();
    }
  }

  // 環境のパイプライン指定（recycle 入口）
  const pipeline = resolvePipelineMode();
  if (pipeline === "recycle" && out.mode === "daily" && !out.useRepostNext) {
    out.mode = "recycle";
  }
  if (pipeline === "repost") {
    out.useRepostNext = true;
    out.mode = "repost";
  }

  if (String(process.env.BEAUTY_USE_REPOST || "").toLowerCase() === "true") {
    out.useRepostNext = true;
    out.mode = "repost";
  }

  // env シミュレーションは test mode のみ
  if (String(process.env.BEAUTY_SIMULATE_POSTED_ALL || "").toLowerCase() === "true") {
    out.simulatePostedAll = true;
  }
  if (String(process.env.BEAUTY_SIMULATE_UNPOSTED_ALL || "").toLowerCase() === "true") {
    out.simulateUnpostedAll = true;
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  # 本番日次（朝9時 / run-beauty）: 日付条件戦略で未投稿を選定。在庫0で停止
  node scripts/selectBeautyProduct.cjs
  node scripts/selectBeautyProduct.cjs --dry-run

  # 戦略 dry-run（日付・due 強制。--dry-run 必須）
  node scripts/selectBeautyProduct.cjs --dry-run --date=2026-10-07 --force-sale-day=true
  node scripts/selectBeautyProduct.cjs --dry-run --force-niche-due=true --force-sale-day=false
  node scripts/selectBeautyProduct.cjs --dry-run --force-sale-day=true --empty-bucket=sale

  # recycle（手動・別スケジュール専用）
  bash run-beauty-recycle.sh
  node scripts/selectBeautyProduct.cjs --mode=recycle --dry-run

  # 設定: policy/beauty-select.json`);
    process.exit(0);
  }

  const runtime = describeRuntime();
  console.log(
    `[select] studioEnv=${runtime.studioEnv} pipeline=${runtime.pipelineMode}` +
      ` testMode=${runtime.testMode} postedPath=${runtime.postedPath}`
  );

  const effectiveMode = args.useRepostNext ? "repost" : args.mode;

  // 本番日次ガード: 意図的テスト以外で test フラグが残っていたら即終了
  if (effectiveMode === "daily" && !isTestMode()) {
    const gate = assertProductionDailySafe();
    if (!gate.ok) {
      console.error(gate.message);
      process.exit(3);
    }
  }

  // simulate / 戦略強制は dry-run のみ。posted 汚染 simulate は test mode のみ
  const strategyForce =
    args.targetDate ||
    args.forceSaleDay !== undefined ||
    args.forceNicheDue !== undefined ||
    args.forceRoutineDue !== undefined ||
    args.emptyBucket;
  if (strategyForce && !args.dryRun) {
    console.error(
      "[select] FATAL: --date/--force-*/--empty-bucket は --dry-run と併用してください"
    );
    process.exit(3);
  }
  if (args.simulatePostedAll || args.simulateUnpostedAll) {
    if (!isTestMode()) {
      console.error(
        "[select] FATAL: --simulate-* は CONTENT_STUDIO_ENV=test のときだけ許可"
      );
      process.exit(3);
    }
    if (!args.dryRun) {
      console.error("[select] FATAL: --simulate-* は --dry-run と併用してください");
      process.exit(3);
    }
  }

  if (isTestMode()) {
    console.log(
      "[select] TEST MODE 有効 — posted-beauty.test.json / simulate を使用。本番日次では起動拒否されます"
    );
  }

  const products = readJson(productsPath, {});
  let posted = readJson(resolvePostedPath(), []);
  if (!Array.isArray(posted)) posted = [];

  if (args.dryRun && args.simulateUnpostedAll) {
    console.log("[select:dry-run] simulate: posted=[] （未投稿在庫あり）");
    posted = [];
  } else if (args.dryRun && args.simulatePostedAll) {
    const ids = allItems(products).map((p) => p.id);
    console.log(`[select:dry-run] simulate: posted=all (${ids.length})`);
    posted = ids;
  }

  // 優先バケット在庫切れシミュレーション（dry-run）
  if (args.dryRun && args.emptyBucket) {
    const bucket = args.emptyBucket;
    const ids = (products[bucket] || []).map((p) => p.id).filter(Boolean);
    posted = [...new Set([...posted, ...ids])];
    console.log(
      `[select:dry-run] empty-bucket=${bucket} → 当該バケットを posted 扱いにした (${ids.length}件)`
    );
  }

  console.log(
    `[select] mode=${effectiveMode} dryRun=${args.dryRun}` +
      ` BEAUTY_USE_REPOST=${process.env.BEAUTY_USE_REPOST || "(unset)"}` +
      ` BEAUTY_ALLOW_RECYCLE=${process.env.BEAUTY_ALLOW_RECYCLE || "(unset)"}`
  );

  const selectConfig = loadSelectConfig();
  const tipCfg = selectConfig.tipPosts || {};
  const tipEnabled = tipCfg.enabled !== false;
  const tipWeekday = String(tipCfg.weekday || "sat").toLowerCase();
  const targetDate = args.targetDate || tokyoDayKey();
  if (effectiveMode === "daily" && tipEnabled && tokyoWeekdayKey(targetDate) === tipWeekday) {
    const tips = loadBeautyTips(selectConfig);
    const tip = tips.length ? pickBeautyTip(tips, posted) : null;
    if (!tip) {
      console.error("[select:tip] 土曜ですが話しかけ原稿がありません");
      process.exit(2);
    }
    const article = toTipArticle(tip);
    console.log("選択された話しかけ:", tip.id);
    console.log("selectedSource: tip");
    console.log("weekday:", tokyoWeekdayKey(targetDate));
    if (!isTestMode()) {
      try {
        assertProductionCopyClean([article.title, article.body, tip.ask, tip.aside], "select-tip");
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(3);
      }
    }
    if (args.dryRun) {
      console.log("[select:dry-run] article.json / next-repost は書き込まない");
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            ok: true,
            mode: effectiveMode,
            selectedSource: "tip",
            productId: tip.id,
            ask: tip.ask,
            aside: tip.aside,
            targetDate,
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
    writeJson(articlePath, article);
    console.log("article.json を更新しました (土曜の話しかけ)");
    return;
  }

  const strategyOpts = {
    config: selectConfig,
    targetDate,
    forceSaleDay: args.forceSaleDay,
    forceNicheDue: args.forceNicheDue,
    forceRoutineDue: args.forceRoutineDue,
  };

  let result;
  if (args.useRepostNext || args.mode === "repost") {
    result = selectRepostNext(products);
  } else if (args.mode === "recycle") {
    result = chooseRecycleItem(products, posted, { ignoreRecentCooldown: true });
  } else {
    result = chooseUnpostedOnly(products, posted, strategyOpts);
    // 未投稿0件: 既定は recycle で止めない（BEAUTY_EMPTY_FALLBACK=skip で停止可）
    if (
      !result.item &&
      (result.reason === "unposted_empty" ||
        result.reason === "same_day_already_posted")
    ) {
      const emptyMode = resolveEmptyFallbackMode();
      console.warn(
        `[select:daily] 未投稿候補0件 reason=${result.reason} → EMPTY_FALLBACK=${emptyMode}`,
      );
      if (emptyMode === "recycle") {
        const recycled = chooseRecycleItem(products, posted, {
          ignoreRecentCooldown: true,
        });
        if (recycled.item) {
          result = {
            ...result,
            ...recycled,
            emptyFallbackUsed: true,
            emptyFallbackMode: "recycle",
          };
          console.warn(
            `[select:daily] WARN empty→recycle id=${recycled.item.id}` +
              ` profitScore=${recycled.profitScore ?? "-"}` +
              ` （在庫切れフォールバック。利潤スコア最大の投稿済みを再利用）`,
          );
        } else {
          console.error(
            "[select:daily] empty→recycle も失敗（本番適格候補なし）",
          );
          result = {
            ...result,
            ...recycled,
            emptyFallbackUsed: true,
            emptyFallbackMode: "recycle",
            reason: recycled.reason || "unposted_empty",
          };
        }
      } else {
        console.error(
          "[select:daily] EMPTY_FALLBACK=skip → 投稿せず停止（管理者へ在庫補充が必要）",
        );
        result = {
          ...result,
          emptyFallbackUsed: true,
          emptyFallbackMode: "skip",
        };
      }
    }
  }

  // 必須ログ（朝の自動投稿向け）
  console.log(
    `[select:summary] catalog=${result.catalogCount ?? allItems(products).length}` +
      ` unposted=${result.unpostedCount ?? "?"}` +
      ` selectedId=${result.item ? result.item.id : "(none)"}` +
      ` selectedBucket=${result.selectedBucket || "(none)"}` +
      ` fallbackUsed=${result.fallbackUsed === true}` +
      ` recycleUsed=${result.recycleUsed === true}` +
      ` emptyFallback=${result.emptyFallbackMode || "none"}` +
      ` selectedSource=${result.selectedSource || "(none)"}` +
      ` reason=${result.reason || "?"}` +
      ` profitScore=${result.profitScore ?? "-"}`
  );

  // 明朝確認ログ（sync → 選定の要約。ブログ投稿より前に必ず出る）
  const morning = buildMorningReadyLog(result);
  console.log(
    `[morning:ready]` +
      ` targetDate=${morning.targetDate}` +
      ` provider=${morning.provider}` +
      ` windowsCount=${morning.windowsCount}` +
      ` saleDay=${morning.saleDay}` +
      ` selectedBucket=${morning.selectedBucket}` +
      ` selectedId=${morning.selectedId}` +
      ` fallbackUsed=${morning.fallbackUsed}` +
      ` syncStatus=${morning.syncStatus}` +
      ` yahooCheckSkipped=${morning.yahooCheckSkipped}` +
      ` yahooCheckTriggered=${morning.yahooCheckTriggered}` +
      ` yahooSaleDetected=${morning.yahooSaleDetected}`
  );

  if (!result.item) {
    const code =
      result.reason === "unposted_empty" ||
      result.reason === "same_day_already_posted" ||
      result.reason === "repost_missing" ||
      result.reason === "repost_consumed" ||
      result.reason === "repost_not_in_catalog"
        ? 2
        : 1;
    console.error(`[select] FAIL reason=${result.reason || "unknown"}`);
    if (args.dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            ok: false,
            mode: effectiveMode,
            studioEnv: runtime.studioEnv,
            testMode: runtime.testMode,
            reason: result.reason,
            selectedSource: null,
            productId: null,
            recycleUsed: result.recycleUsed === true,
            catalogCount: result.catalogCount ?? null,
            unpostedCount: result.unpostedCount ?? null,
            targetDate: result.targetDate || null,
            saleDay: result.saleDay ?? null,
            nicheDue: result.nicheDue ?? null,
            routineDue: result.routineDue ?? null,
            priorityOrder: result.priorityOrder || null,
            selectedBucket: result.selectedBucket || null,
            fallbackUsed: result.fallbackUsed === true,
            unpostedCountByBucket: result.unpostedCountByBucket || null,
            morning: buildMorningReadyLog(result),
          },
          null,
          2
        )
      );
    }
    process.exit(code);
  }

  // 日次ガード: 投稿済みIDは通さない（在庫0の empty→recycle だけ例外）
  if (
    effectiveMode === "daily" &&
    Array.isArray(posted) &&
    posted.includes(result.item.id) &&
    !(result.emptyFallbackUsed && result.selectedSource === "recycle")
  ) {
    console.error(
      `[select:daily] GUARD FAIL: ${result.item.id} は posted に存在するのに選定された`,
    );
    process.exit(2);
  }

  // 日次は未投稿優先。在庫0時の empty→recycle だけ例外許可
  if (
    effectiveMode === "daily" &&
    result.selectedSource !== "unposted" &&
    !(result.emptyFallbackUsed && result.selectedSource === "recycle")
  ) {
    console.error(
      `[select:daily] GUARD FAIL: selectedSource=${result.selectedSource} は日次では不正` +
        ` (emptyFallback=${result.emptyFallbackMode || "none"})`,
    );
    process.exit(2);
  }

  // 本番日次: テスト商品・禁止文言・直近重複を最終ガード
  // empty→recycle 時は直近重複ガードを外す（在庫切れで止まらないため）
  if (effectiveMode === "daily" && !runtime.testMode) {
    if (!isProductionEligibleProduct(result.item)) {
      console.error(
        `[select:daily] GUARD FAIL: ${result.item.id} はテスト/非本番商品のため選定不可`,
      );
      process.exit(3);
    }
    const dup = isRecentDuplicateProduct(result.item, loadRecentBeautyPosts());
    if (
      dup.duplicate &&
      !(result.emptyFallbackUsed && result.selectedSource === "recycle")
    ) {
      console.error(
        `[select:daily] GUARD FAIL: 直近投稿と重複 (${dup.reason})`,
      );
      process.exit(3);
    }
    try {
      assertProductionCopyClean(
        [
          result.item.productName,
          result.item.articleTitle,
          result.item.articleBody,
        ],
        "select",
      );
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(3);
    }
  }

  const article = toArticleJson(result.item);
  article.selectedSource = result.selectedSource;
  if (result.emptyFallbackUsed) {
    article.emptyFallbackUsed = true;
    article.emptyFallbackMode = result.emptyFallbackMode || "recycle";
  }

  console.log("選択された商品:", result.item.id);
  console.log("selectedSource:", article.selectedSource);
  console.log("reason:", result.reason);
  console.log("recycleUsed:", result.recycleUsed === true);
  console.log("emptyFallback:", result.emptyFallbackMode || "none");
  console.log("残り未投稿(概算):", result.remainingUnposted);

  if (args.dryRun) {
    console.log("[select:dry-run] article.json / next-repost は書き込まない");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          ok: true,
          mode: effectiveMode,
          studioEnv: runtime.studioEnv,
          testMode: runtime.testMode,
          reason: result.reason,
          selectedSource: article.selectedSource,
          productId: result.item.id,
          productName: result.item.productName,
          remainingUnposted: result.remainingUnposted,
          recycleUsed: result.recycleUsed === true,
          catalogCount: result.catalogCount ?? null,
          unpostedCount: result.unpostedCount ?? null,
          postedPath: runtime.postedPath,
          targetDate: result.targetDate || null,
          saleDay: result.saleDay ?? null,
          nicheDue: result.nicheDue ?? null,
          routineDue: result.routineDue ?? null,
          priorityOrder: result.priorityOrder || null,
          selectedBucket: result.selectedBucket || null,
          fallbackUsed: result.fallbackUsed === true,
          unpostedCountByBucket: result.unpostedCountByBucket || null,
          morning: buildMorningReadyLog(result),
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  writeJson(articlePath, article);
  console.log("article.json を更新しました");

  if (result.selectedSource === "repost" && result.next) {
    const consumed = {
      ...result.next,
      consumed: true,
      consumedAt: new Date().toISOString(),
    };
    writeJson(nextRepostPath, consumed);
    console.log("next-repost.json を consumed=true に更新しました");
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  chooseUnpostedOnly,
  chooseRecycleItem,
  selectRepostNext,
  allItems,
  parseArgs,
  chooseByStrategy,
};
