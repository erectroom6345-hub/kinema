/**
 * Slack 通知コア（静か・短い・重複抑制）。
 * 音はコードでは制御しない → Slack クライアント側のミュート設定に任せる。
 *
 * level: error | warn | info
 * 既定: error は送る / warn・info はフラグまたは明示許可時のみ
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const root = path.join(__dirname, "..", "..");
const notifyDir = path.join(root, "output", "notify");
const dedupPath = path.join(notifyDir, "dedup.json");
const historyPath = path.join(notifyDir, "notify-history.jsonl");

const LEVEL_RANK = { error: 3, warn: 2, info: 1 };

function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function envFlag(name, defaultValue = false) {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

function normalizeLevel(level) {
  const l = String(level || "error").toLowerCase();
  if (l === "warn" || l === "warning") return "warn";
  if (l === "info") return "info";
  return "error";
}

function dedupKey({ eventType, productId, day }) {
  const pid = (productId || "_").trim() || "_";
  return `${day}|${eventType}|${pid}`;
}

function isDuplicate(key) {
  const store = readJson(dedupPath, { keys: {} });
  return Boolean(store.keys && store.keys[key]);
}

function markDedup(key, meta = {}) {
  const store = readJson(dedupPath, { keys: {} });
  if (!store.keys) store.keys = {};
  store.keys[key] = {
    at: new Date().toISOString(),
    ...meta,
  };
  // 古いキーを軽く掃除（14日超）
  const cutoff = Date.now() - 14 * 86_400_000;
  for (const [k, v] of Object.entries(store.keys)) {
    const t = Date.parse(v?.at || "");
    if (Number.isFinite(t) && t < cutoff) delete store.keys[k];
  }
  writeJson(dedupPath, store);
}

/** warn/info を送ってよいか */
function levelAllowed(level, eventType) {
  if (level === "error") return true;

  // イベント個別フラグ
  if (eventType === "daily_summary") return envFlag("SLACK_DAILY_SUMMARY", false);
  if (eventType === "ig_token_refresh_ok") return envFlag("SLACK_NOTIFY_TOKEN_OK", false);
  if (eventType === "ig_token_refresh_skipped") return envFlag("SLACK_NOTIFY_TOKEN_WARN", false);
  if (eventType === "repost_candidates_empty") return envFlag("SLACK_NOTIFY_REPOST_EMPTY", false);
  if (eventType === "repost_top_candidate") return envFlag("SLACK_NOTIFY_REPOST_TOP", false);
  if (eventType === "policy_warn") return false; // 常にログのみ

  if (level === "warn") return envFlag("SLACK_NOTIFY_WARN", false);
  if (level === "info") return envFlag("SLACK_NOTIFY_INFO", false);
  return false;
}

function formatText(payload) {
  const {
    level,
    eventType,
    productId,
    step,
    reason,
    logPath,
    at,
    extraLines,
  } = payload;
  const lines = [
    `[${level}] ${eventType}`,
    `productId: ${productId || "-"}`,
    `step: ${step || "-"}`,
    `reason: ${(reason || "-").replace(/\s+/g, " ").slice(0, 240)}`,
    `log: ${logPath || "-"}`,
    `at: ${at}`,
  ];
  if (Array.isArray(extraLines) && extraLines.length) {
    for (const line of extraLines.slice(0, 5)) {
      const s = String(line || "").trim();
      if (s) lines.push(s.slice(0, 160));
    }
  }
  return lines.join("\n");
}

function postSlackWebhook(webhookUrl, text) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(webhookUrl);
    } catch {
      resolve({ ok: false, detail: "invalid webhook url" });
      return;
    }
    const body = JSON.stringify({ text });
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || undefined,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          const ok = res.statusCode === 200 && data.trim() === "ok";
          resolve({ ok, detail: `HTTP ${res.statusCode} ${data.trim()}` });
        });
      },
    );
    req.on("error", (err) => resolve({ ok: false, detail: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

/**
 * @returns {Promise<{ sent: boolean, skipped?: string, detail?: string }>}
 */
async function sendNotify(input = {}) {
  const level = normalizeLevel(input.level);
  const eventType = String(input.eventType || "unknown").trim() || "unknown";
  const productId = (input.productId || "").trim();
  const step = (input.step || "").trim();
  const reason = String(input.reason || "").trim();
  const logPath = (input.logPath || "").trim();
  const at = input.at || new Date().toISOString();
  const force = Boolean(input.force);
  const day = todayKey();

  const record = {
    level,
    eventType,
    productId: productId || null,
    step: step || null,
    reason: reason || null,
    logPath: logPath || null,
    at,
    day,
  };

  fs.mkdirSync(notifyDir, { recursive: true });

  if (!levelAllowed(level, eventType) && !force) {
    console.log(
      `[notify] skip level=${level} eventType=${eventType} (フラグ未許可・ログのみ)`,
    );
    fs.appendFileSync(
      historyPath,
      `${JSON.stringify({ ...record, result: "skipped_level" })}\n`,
      "utf8",
    );
    return { sent: false, skipped: "level_not_allowed" };
  }

  const key = dedupKey({ eventType, productId, day });
  if (!force && isDuplicate(key)) {
    console.log(`[notify] skip dedup key=${key}`);
    fs.appendFileSync(
      historyPath,
      `${JSON.stringify({ ...record, result: "skipped_dedup", dedupKey: key })}\n`,
      "utf8",
    );
    return { sent: false, skipped: "dedup", detail: key };
  }

  const text = formatText({
    ...record,
    extraLines: input.extraLines,
  });

  console.log("---- notify ----");
  console.log(text);
  console.log("----------------");

  const webhook = (process.env.SLACK_WEBHOOK_URL || "").trim();
  let sent = false;
  let detail = "";

  if (webhook) {
    const res = await postSlackWebhook(webhook, text);
    sent = res.ok;
    detail = res.detail;
    if (sent) console.log("[notify] Slack 送信OK");
    else console.error(`[notify] Slack 送信失敗: ${detail}`);
  } else {
    detail = "SLACK_WEBHOOK_URL unset";
    console.log("[notify] SLACK_WEBHOOK_URL 未設定");
  }

  // macOS 通知は既定OFF（うるささ防止）。error かつ Slack失敗時のみ任意
  if (
    !sent &&
    level === "error" &&
    envFlag("SLACK_MACOS_NOTIFY", false)
  ) {
    detail = `${detail}; macos_notify_requested`;
  }

  if (sent || force) {
    markDedup(key, { eventType, productId, level });
  } else if (!sent && webhook) {
    // 送信失敗時は dedup しない（再送チャンスを残す）
  } else if (!webhook && level === "error") {
    // Webhook無しでも同日重複ログ抑制
    markDedup(key, { eventType, productId, level, localOnly: true });
  }

  fs.appendFileSync(
    historyPath,
    `${JSON.stringify({
      ...record,
      result: sent ? "sent" : "failed",
      detail,
      dedupKey: key,
    })}\n`,
    "utf8",
  );

  writeJson(path.join(notifyDir, "last-notify.json"), {
    ...record,
    result: sent ? "sent" : "failed",
    detail,
    text,
  });

  return { sent, detail, skipped: sent ? undefined : detail };
}

module.exports = {
  sendNotify,
  formatText,
  dedupKey,
  todayKey,
  levelAllowed,
  notifyDir,
};
