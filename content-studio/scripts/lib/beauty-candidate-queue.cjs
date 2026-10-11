/**
 * 美容候補キュー（Catalog Ingest の中間状態）。
 * data/beauty-candidate-queue.json
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_QUEUE_PATH = path.join(ROOT, "data", "beauty-candidate-queue.json");

const STATUSES = [
  "discovered",
  "ready",
  "needsReview",
  "rejected",
  "promoted",
];

function normalizeUrlKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return s.split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

function candidateIdFromUrl(url) {
  const key = normalizeUrlKey(url) || String(url || "");
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
  return `cand-${hash}`;
}

function catalogIdFromUrl(url) {
  const key = normalizeUrlKey(url) || String(url || "");
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
  return `beauty-auto-${hash}`;
}

function emptyQueue() {
  return {
    version: 1,
    updatedAt: null,
    items: [],
  };
}

function loadQueue(filePath = DEFAULT_QUEUE_PATH) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyQueue();
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return emptyQueue();
    return {
      version: Number(data.version) || 1,
      updatedAt: data.updatedAt || null,
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return emptyQueue();
  }
}

function saveQueue(queue, filePath = DEFAULT_QUEUE_PATH) {
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: Array.isArray(queue.items) ? queue.items : [],
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function indexByUrl(queue) {
  const map = new Map();
  for (const item of queue.items || []) {
    const key = normalizeUrlKey(item.productUrl);
    if (key) map.set(key, item);
  }
  return map;
}

function upsertCandidate(queue, draft) {
  const url = String(draft.productUrl || "").trim();
  if (!url) return { queue, item: null, created: false };
  const key = normalizeUrlKey(url);
  const id = draft.id || candidateIdFromUrl(url);
  const byUrl = indexByUrl(queue);
  const existing = byUrl.get(key);
  if (existing) {
    const merged = {
      ...existing,
      ...draft,
      id: existing.id || id,
      productUrl: existing.productUrl || url,
      updatedAt: new Date().toISOString(),
    };
    // promoted / rejected は上書きで戻さない（再発見でも status 維持）
    if (existing.status === "promoted" || existing.status === "rejected") {
      merged.status = existing.status;
      merged.gate = existing.gate || draft.gate;
      merged.catalogId = existing.catalogId || draft.catalogId || null;
    }
    queue.items = (queue.items || []).map((x) =>
      x.id === existing.id || normalizeUrlKey(x.productUrl) === key ? merged : x,
    );
    return { queue, item: merged, created: false };
  }
  const item = {
    id,
    brand: draft.brand || "",
    productName: draft.productName || "",
    productUrl: url,
    imageUrl: draft.imageUrl || "",
    source: draft.source || "official-listing",
    status: draft.status || "discovered",
    bucket: draft.bucket || "main",
    genre: draft.genre || "",
    category: draft.category || "",
    gate: draft.gate || null,
    discoveredAt: draft.discoveredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promotedAt: null,
    catalogId: null,
  };
  queue.items = [...(queue.items || []), item];
  return { queue, item, created: true };
}

function summarizeQueue(queue) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const item of queue.items || []) {
    const st = String(item.status || "discovered");
    counts[st] = (counts[st] || 0) + 1;
  }
  return {
    total: (queue.items || []).length,
    ...counts,
  };
}

module.exports = {
  DEFAULT_QUEUE_PATH,
  STATUSES,
  normalizeUrlKey,
  candidateIdFromUrl,
  catalogIdFromUrl,
  emptyQueue,
  loadQueue,
  saveQueue,
  indexByUrl,
  upsertCandidate,
  summarizeQueue,
};
