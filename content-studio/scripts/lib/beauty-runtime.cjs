/**
 * 美容パイプラインの本番 / テスト / recycle 入口を分離する。
 *
 * 本番 (CONTENT_STUDIO_ENV=production または未設定):
 *   - 日次は未投稿選定のみ
 *   - BEAUTY_TEST_MODE / ALLOW_RECYCLE 等が残っていれば即エラー
 *
 * 意図的テスト (CONTENT_STUDIO_ENV=test または BEAUTY_ALLOW_TEST_PIPELINE=true):
 *   - data/posted-beauty.test.json を使う
 *   - simulate はここでだけ許可
 *
 * recycle (BEAUTY_PIPELINE_MODE=recycle):
 *   - 手動 or 専用スケジュール入口のみ
 */
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const FORBIDDEN_IN_PRODUCTION_DAILY = [
  "BEAUTY_TEST_MODE",
  "BEAUTY_ALLOW_RECYCLE",
  "BEAUTY_USE_REPOST",
  "BEAUTY_SKIP_SELECT",
  "BEAUTY_SIMULATE_POSTED_ALL",
  "BEAUTY_SIMULATE_UNPOSTED_ALL",
  "BEAUTY_ALLOW_TEST_PIPELINE",
];

function envFlag(name) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function resolvePipelineMode() {
  const raw = String(process.env.BEAUTY_PIPELINE_MODE || "daily")
    .trim()
    .toLowerCase();
  if (raw === "recycle" || raw === "repost" || raw === "daily") return raw;
  return "daily";
}

/**
 * 意図的テストかどうか。
 * BEAUTY_TEST_MODE 単独は「本番汚染」扱い（CONTENT_STUDIO_ENV=test が必要）。
 */
function isIntentionalTestMode() {
  if (envFlag("BEAUTY_ALLOW_TEST_PIPELINE")) return true;
  const raw = String(process.env.CONTENT_STUDIO_ENV || "")
    .trim()
    .toLowerCase();
  return raw === "test" || raw === "development" || raw === "dev";
}

function resolveStudioEnv() {
  if (isIntentionalTestMode()) return "test";
  const raw = String(process.env.CONTENT_STUDIO_ENV || "")
    .trim()
    .toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  return "production";
}

function isTestMode() {
  return isIntentionalTestMode();
}

function resolvePostedPath() {
  const override = String(process.env.POSTED_PRODUCTS_PATH || "").trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(ROOT, override);
  }
  if (isTestMode()) {
    return path.join(ROOT, "data", "posted-beauty.test.json");
  }
  return path.join(ROOT, "data", "posted-beauty.json");
}

/**
 * 本番日次で禁止のフラグ/設定を列挙する（空なら安全）
 */
function listProductionDailyViolations() {
  const violations = [];
  const pipeline = resolvePipelineMode();

  if (pipeline !== "daily") {
    return violations;
  }

  // 意図的テストは「本番日次」ではないので、ここでは違反にしない
  // （呼び出し側が production daily のときだけ assert する）
  if (isIntentionalTestMode()) {
    return violations;
  }

  for (const key of FORBIDDEN_IN_PRODUCTION_DAILY) {
    if (envFlag(key)) {
      violations.push(`${key}=true`);
    }
  }

  const postedOverride = String(process.env.POSTED_PRODUCTS_PATH || "").trim();
  if (postedOverride) {
    const norm = postedOverride.replace(/\\/g, "/");
    if (
      !norm.endsWith("data/posted-beauty.json") &&
      norm !== "data/posted-beauty.json"
    ) {
      violations.push(
        `POSTED_PRODUCTS_PATH=${postedOverride} (本番日次は既定パスのみ)`
      );
    }
  }

  return violations;
}

function assertProductionDailySafe() {
  const violations = listProductionDailyViolations();
  if (!violations.length) {
    return { ok: true, violations: [] };
  }
  return {
    ok: false,
    violations,
    message:
      "[beauty-runtime] FATAL: 本番日次フローにテスト設定が混在しています。起動を中止します。\n" +
      violations.map((v) => `  - ${v}`).join("\n") +
      "\n本番: CONTENT_STUDIO_ENV=production（既定）で test フラグをすべて外す\n" +
      "意図的テスト: CONTENT_STUDIO_ENV=test または BEAUTY_ALLOW_TEST_PIPELINE=true\n" +
      "recycle: bash run-beauty-recycle.sh（BEAUTY_PIPELINE_MODE=recycle）",
  };
}

function describeRuntime() {
  return {
    studioEnv: resolveStudioEnv(),
    pipelineMode: resolvePipelineMode(),
    testMode: isTestMode(),
    postedPath: resolvePostedPath(),
    violations: listProductionDailyViolations(),
  };
}

module.exports = {
  ROOT,
  FORBIDDEN_IN_PRODUCTION_DAILY,
  envFlag,
  resolvePipelineMode,
  resolveStudioEnv,
  isIntentionalTestMode,
  isTestMode,
  resolvePostedPath,
  listProductionDailyViolations,
  assertProductionDailySafe,
  describeRuntime,
};
