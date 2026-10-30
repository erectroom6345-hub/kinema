/**
 * 困りごと需要ウォッチ（辞書 / 脈拍 / 手動アクティブ窓）。
 * 自動で投稿ジャンルは切り替えない。approve 後だけ選定で優先する。
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const POLICY_PATH = path.join(root, "policy", "demand-watch.json");
const PULSE_PATH = path.join(root, "data", "demand-pulse.json");
const CANDIDATES_PATH = path.join(root, "data", "demand-candidates.json");
const ACTIVE_PATH = path.join(root, "data", "demand-active.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function tokyoMonth(d = new Date()) {
  const key = tokyoDayKey(d);
  return Number(key.slice(5, 7));
}

function addDays(dayKey, days) {
  const [y, m, dd] = String(dayKey)
    .split("-")
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, dd, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

function loadDemandPolicy(filePath = POLICY_PATH) {
  const raw = readJson(filePath, null);
  if (!raw || typeof raw !== "object") {
    return {
      version: 0,
      pulse: {},
      themes: [],
      notifyOnCandidate: true,
      configPath: filePath,
    };
  }
  return {
    version: Number(raw.version) || 1,
    description: String(raw.description || ""),
    pulse: raw.pulse && typeof raw.pulse === "object" ? raw.pulse : {},
    notifyOnCandidate: raw.notifyOnCandidate !== false,
    themes: Array.isArray(raw.themes) ? raw.themes : [],
    configPath: filePath,
  };
}

function themeById(policy, themeId) {
  const id = String(themeId || "").trim();
  return (policy.themes || []).find((t) => String(t.id || "") === id) || null;
}

function loadPulseState(filePath = PULSE_PATH) {
  const raw = readJson(filePath, { version: 1, themes: {} });
  if (!raw.themes || typeof raw.themes !== "object") raw.themes = {};
  return raw;
}

function savePulseState(state, filePath = PULSE_PATH) {
  writeJson(filePath, state);
}

function loadCandidates(filePath = CANDIDATES_PATH) {
  const raw = readJson(filePath, { version: 1, pending: [] });
  if (!Array.isArray(raw.pending)) raw.pending = [];
  return raw;
}

function saveCandidates(state, filePath = CANDIDATES_PATH) {
  writeJson(filePath, state);
}

function loadActive(filePath = ACTIVE_PATH) {
  const raw = readJson(filePath, { version: 1, windows: [] });
  if (!Array.isArray(raw.windows)) raw.windows = [];
  return raw;
}

function saveActive(state, filePath = ACTIVE_PATH) {
  writeJson(filePath, state);
}

function productBlob(item) {
  return [
    item?.name,
    item?.nameRaw,
    item?.productName,
    item?.description,
    item?.articleBody,
    ...(Array.isArray(item?.features) ? item.features : []),
  ]
    .map((x) => String(x || ""))
    .join("\n");
}

function isDemandProduct(item, theme) {
  if (!item || !theme) return false;
  const labels = item.labels && typeof item.labels === "object" ? item.labels : {};
  if (labels.demandTheme && String(labels.demandTheme) === String(theme.id)) {
    return true;
  }
  const patterns = Array.isArray(theme.productNamePatterns)
    ? theme.productNamePatterns
    : [];
  if (!patterns.length) return false;
  const blob = productBlob(item);
  return patterns.some((p) => {
    const s = String(p || "").trim();
    if (!s) return false;
    try {
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob);
    } catch {
      return blob.toLowerCase().includes(s.toLowerCase());
    }
  });
}

function listActiveWindows(opts = {}) {
  const active = opts.active || loadActive(opts.activePath);
  const today = opts.today || tokyoDayKey(opts.now || new Date());
  return (active.windows || []).filter((w) => {
    const start = String(w.start || "").slice(0, 10);
    const end = String(w.end || "").slice(0, 10);
    if (!start || !end) return false;
    return today >= start && today <= end;
  });
}

function listActiveThemesForGenre(genre, opts = {}) {
  const policy = opts.policy || loadDemandPolicy(opts.policyPath);
  const g = String(genre || "").trim().toLowerCase();
  const windows = listActiveWindows(opts);
  const out = [];
  for (const w of windows) {
    const theme = themeById(policy, w.themeId);
    if (!theme) continue;
    const genres = Array.isArray(theme.genres)
      ? theme.genres.map((x) => String(x).toLowerCase())
      : [];
    if (g && !genres.includes(g)) continue;
    out.push({ theme, window: w });
  }
  return out;
}

/**
 * 選定用: アクティブ需要テーマに合う商品を優先して1件返す。
 * pickBest(candidates, ops) を外から渡す。
 */
function pickDemandFromPool(pool, genre, ops, pickBest, normalizeCategory, opts = {}) {
  const actives = listActiveThemesForGenre(genre, opts);
  if (!actives.length || !Array.isArray(pool) || !pool.length) return null;

  for (const { theme, window } of actives) {
    const matched = pool.filter((item) => isDemandProduct(item, theme));
    if (!matched.length) continue;
    const preferred = Array.isArray(theme.preferredCategories?.[genre])
      ? theme.preferredCategories[genre]
      : [];
    const scheduled = opts.scheduled || null;
    const blockedCat = opts.blockedCat || null;
    const tryCats = [
      ...preferred,
      ...(scheduled ? [scheduled] : []),
    ].filter((c, i, arr) => c && arr.indexOf(c) === i);

    for (const cat of tryCats) {
      if (blockedCat && cat === blockedCat) continue;
      const hit = pickBest(
        matched.filter(
          (item) => normalizeCategory(item.category, ops.categories) === cat,
        ),
        ops,
      );
      if (hit) {
        return {
          item: hit,
          theme,
          window,
          chosenCat: cat,
          usedFallback: Boolean(scheduled && cat !== scheduled),
        };
      }
    }
    const any = pickBest(matched, ops);
    if (any) {
      return {
        item: any,
        theme,
        window,
        chosenCat: normalizeCategory(any.category, ops.categories),
        usedFallback: true,
      };
    }
  }
  return null;
}

function scorePulseSample(sample, policyPulse = {}) {
  const minReviewSum = Number(policyPulse.minReviewSum) || 80;
  const minApiCount = Number(policyPulse.minApiCount) || 30;
  const reviewSum = Number(sample.reviewSum) || 0;
  const apiCount = Number(sample.apiCount) || 0;
  return {
    reviewSum,
    apiCount,
    strongEnough: reviewSum >= minReviewSum || apiCount >= minApiCount,
  };
}

function detectSurge(prev, curr, policyPulse = {}) {
  const ratioNeed = Number(policyPulse.surgeRatio) || 1.35;
  const scored = scorePulseSample(curr, policyPulse);
  if (!scored.strongEnough) {
    return { surged: false, reason: "below_floor", ratio: null, scored };
  }
  if (!prev) {
    // 初回はカレンダー月ヒントがあるときだけ候補化（誤爆抑制）
    return {
      surged: Boolean(curr.calendarBoost),
      reason: curr.calendarBoost ? "first_sample_calendar" : "first_sample",
      ratio: null,
      scored,
    };
  }
  const prevScore = Math.max(
    1,
    Number(prev.reviewSum) || 0,
    (Number(prev.apiCount) || 0) * 0.5,
  );
  const currScore = Math.max(
    1,
    Number(curr.reviewSum) || 0,
    (Number(curr.apiCount) || 0) * 0.5,
  );
  const ratio = currScore / prevScore;
  const surged = ratio >= ratioNeed || (curr.calendarBoost && ratio >= 1.15);
  return {
    surged,
    reason: surged ? (ratio >= ratioNeed ? "ratio" : "calendar_soft") : "flat",
    ratio: Math.round(ratio * 1000) / 1000,
    scored,
  };
}

function upsertCandidate(candidate, opts = {}) {
  const state = loadCandidates(opts.candidatesPath);
  const id = String(candidate.themeId || "").trim();
  const rest = state.pending.filter((p) => String(p.themeId) !== id);
  rest.push({
    ...candidate,
    status: "pending",
    updatedAt: new Date().toISOString(),
  });
  state.pending = rest;
  state.updatedAt = new Date().toISOString();
  saveCandidates(state, opts.candidatesPath);
  return state;
}

function approveTheme(themeId, opts = {}) {
  const policy = opts.policy || loadDemandPolicy(opts.policyPath);
  const theme = themeById(policy, themeId);
  if (!theme) {
    throw new Error(`未知の themeId: ${themeId}`);
  }
  const today = opts.today || tokyoDayKey(opts.now || new Date());
  const days = Number(opts.days) > 0 ? Number(opts.days) : Number(theme.defaultDays) || 14;
  const start = String(opts.start || today).slice(0, 10);
  const end = String(opts.end || addDays(start, days)).slice(0, 10);

  const active = loadActive(opts.activePath);
  active.windows = (active.windows || []).filter(
    (w) => String(w.themeId) !== String(theme.id),
  );
  active.windows.push({
    themeId: theme.id,
    title: theme.title,
    start,
    end,
    approvedAt: new Date().toISOString(),
    approvedBy: opts.approvedBy || "manual",
    note: String(opts.note || ""),
    genres: theme.genres || [],
    ingestHints: theme.ingestHints || [],
  });
  active.updatedAt = new Date().toISOString();
  saveActive(active, opts.activePath);

  const candidates = loadCandidates(opts.candidatesPath);
  candidates.pending = (candidates.pending || []).filter(
    (p) => String(p.themeId) !== String(theme.id),
  );
  candidates.updatedAt = new Date().toISOString();
  saveCandidates(candidates, opts.candidatesPath);

  return { theme, window: active.windows[active.windows.length - 1], active };
}

function clearTheme(themeId, opts = {}) {
  const id = String(themeId || "").trim();
  const active = loadActive(opts.activePath);
  const before = active.windows.length;
  active.windows = (active.windows || []).filter((w) => String(w.themeId) !== id);
  active.updatedAt = new Date().toISOString();
  saveActive(active, opts.activePath);
  return { removed: before - active.windows.length, active };
}

function pruneExpiredWindows(opts = {}) {
  const today = opts.today || tokyoDayKey(opts.now || new Date());
  const active = loadActive(opts.activePath);
  const keep = (active.windows || []).filter((w) => {
    const end = String(w.end || "").slice(0, 10);
    return end && end >= today;
  });
  const removed = active.windows.length - keep.length;
  if (removed > 0) {
    active.windows = keep;
    active.updatedAt = new Date().toISOString();
    saveActive(active, opts.activePath);
  }
  return { removed, active };
}

module.exports = {
  POLICY_PATH,
  PULSE_PATH,
  CANDIDATES_PATH,
  ACTIVE_PATH,
  tokyoDayKey,
  tokyoMonth,
  addDays,
  loadDemandPolicy,
  themeById,
  loadPulseState,
  savePulseState,
  loadCandidates,
  saveCandidates,
  loadActive,
  saveActive,
  isDemandProduct,
  listActiveWindows,
  listActiveThemesForGenre,
  pickDemandFromPool,
  scorePulseSample,
  detectSurge,
  upsertCandidate,
  approveTheme,
  clearTheme,
  pruneExpiredWindows,
};
