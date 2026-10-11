/**
 * Ollama 実行プロファイル（朝ラン / 手動通常）。
 *
 * 朝ラン目標: 9:00開始 → 9:15〜9:25完了。
 * 冷起動での即fallbackを避けるため、朝は短め予熱→生成（既定90s）を優先。
 * それでも超過したらフォールバックで完走する。
 */

export type OllamaRuntimeProfile = "morning" | "manual";

export type OllamaRuntime = {
  profile: OllamaRuntimeProfile;
  morningMode: boolean;
  /** Blogger本文 / IG caption 生成の待ち上限 */
  generateTimeoutMs: number;
  /** ウォームアップ待ち上限 */
  warmupTimeoutMs: number;
  /** 朝は予熱スキップ推奨 */
  skipWarmup: boolean;
  blogNumPredict: number;
  captionNumPredict: number;
};

function tokyoHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  }).format(now);
  return Number(h);
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const v = String(raw).toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

/**
 * BEAUTY_MORNING_MODE:
 *   true/false … 明示
 *   auto（既定）… Asia/Tokyo の 8〜10時を朝扱い
 */
export function isMorningMode(now = new Date()): boolean {
  const flag = String(process.env.BEAUTY_MORNING_MODE || "auto").toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes" || flag === "on") {
    return true;
  }
  if (flag === "false" || flag === "0" || flag === "no" || flag === "off") {
    return false;
  }
  const hour = tokyoHour(now);
  return hour >= 8 && hour <= 10;
}

export function resolveOllamaRuntime(now = new Date()): OllamaRuntime {
  const morningMode = isMorningMode(now);
  if (morningMode) {
    return {
      profile: "morning",
      morningMode: true,
      // 朝: 予熱後に生成。45sだと冷起動でほぼ毎回fallbackしていた
      generateTimeoutMs: envNum("OLLAMA_MORNING_TIMEOUT_MS", 90_000),
      warmupTimeoutMs: envNum("OLLAMA_MORNING_WARMUP_TIMEOUT_MS", 45_000),
      skipWarmup: envFlag("OLLAMA_MORNING_SKIP_WARMUP", false),
      blogNumPredict: envNum("OLLAMA_MORNING_BLOG_NUM_PREDICT", 900),
      captionNumPredict: envNum("OLLAMA_MORNING_CAPTION_NUM_PREDICT", 280),
    };
  }
  return {
    profile: "manual",
    morningMode: false,
    // 手動でも 600s は使わない（既定 180s）
    generateTimeoutMs: envNum("OLLAMA_TIMEOUT_MS", 180_000),
    warmupTimeoutMs: envNum("OLLAMA_WARMUP_TIMEOUT_MS", 60_000),
    skipWarmup: envFlag("OLLAMA_SKIP_WARMUP", false),
    blogNumPredict: envNum("OLLAMA_BLOG_NUM_PREDICT", 2000),
    captionNumPredict: envNum("OLLAMA_CAPTION_NUM_PREDICT", 400),
  };
}

export function logOllamaRuntime(runtime: OllamaRuntime = resolveOllamaRuntime()): void {
  console.log(
    `[ollama-runtime] profile=${runtime.profile}` +
      ` morningMode=${runtime.morningMode}` +
      ` generateTimeoutMs=${runtime.generateTimeoutMs}` +
      ` warmupTimeoutMs=${runtime.warmupTimeoutMs}` +
      ` skipWarmup=${runtime.skipWarmup}` +
      ` blogNumPredict=${runtime.blogNumPredict}` +
      ` captionNumPredict=${runtime.captionNumPredict}`,
  );
}
