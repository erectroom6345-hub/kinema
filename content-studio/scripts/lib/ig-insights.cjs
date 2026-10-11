/**
 * Instagram Media Insights 取得（最低限KPI）。
 * GET /{ig-media-id}/insights?metric=reach,saved,profile_visits,total_interactions
 */
const DEFAULT_GRAPH = "v23.0";

const PRIMARY_METRICS = ["reach", "saved", "profile_visits", "total_interactions"];
const FALLBACK_METRIC_SETS = [
  ["reach", "saved", "total_interactions"],
  ["reach", "saved"],
  ["reach"],
];

function graphVersion() {
  return String(process.env.INSTAGRAM_GRAPH_VERSION || DEFAULT_GRAPH).replace(/^\/*/, "");
}

function metricValue(entry) {
  if (!entry || typeof entry !== "object") return null;
  const values = entry.values;
  if (Array.isArray(values) && values.length) {
    const v = values[values.length - 1]?.value;
    if (typeof v === "number") return v;
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  if (typeof entry.value === "number") return entry.value;
  return null;
}

/** 再試行しても取れない永久エラー（削除済み / 別アカウント / 非対応オブジェクト） */
function isPermanentInsightsError(message) {
  const msg = String(message || "");
  if (!msg) return false;
  return (
    /does not exist/i.test(msg) ||
    /unsupported get request/i.test(msg) ||
    /cannot be loaded due to missing permissions/i.test(msg) ||
    /nonexisting field/i.test(msg)
  );
}

/**
 * @returns {Promise<{ ok:boolean, metrics:Record<string, number|null>, raw?:any, error?:string, permanent?:boolean }>}
 */
async function fetchMediaInsights(igMediaId, accessToken, opts = {}) {
  const id = String(igMediaId || "").trim();
  const token = String(accessToken || "").trim();
  if (!id || !token) {
    return { ok: false, metrics: {}, error: "missing_id_or_token" };
  }

  const sets = [PRIMARY_METRICS, ...FALLBACK_METRIC_SETS];
  let lastError = "";
  for (const metrics of sets) {
    const url =
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(id)}/insights` +
      `?metric=${encodeURIComponent(metrics.join(","))}` +
      `&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(Number(opts.timeoutMs) || 20000),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        lastError =
          data?.error?.message ||
          `HTTP ${res.status}`;
        continue;
      }
      const out = {};
      for (const name of PRIMARY_METRICS) out[name] = null;
      for (const row of data.data || []) {
        const name = String(row.name || "");
        if (!name) continue;
        out[name] = metricValue(row);
      }
      return { ok: true, metrics: out, raw: data, requested: metrics };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  const error = lastError || "insights_failed";
  return {
    ok: false,
    metrics: {},
    error,
    permanent: isPermanentInsightsError(error),
  };
}

module.exports = {
  PRIMARY_METRICS,
  fetchMediaInsights,
  isPermanentInsightsError,
  metricValue,
  graphVersion,
};
