/**
 * Threads テキスト投稿の最小疎通テスト（自動運用フロー非接続）
 *
 * 使い方:
 *   npx tsx scripts/test-threads-post.ts
 *   THREADS_TEST_TEXT='任意の一文' npx tsx scripts/test-threads-post.ts
 *
 * 必要 env: THREADS_ACCESS_TOKEN, THREADS_USER_ID
 */
import "dotenv/config";

const apiVersion = (process.env.THREADS_API_VERSION ?? "v1.0").trim() || "v1.0";
const base = `https://graph.threads.net/${apiVersion}`;

function maskSecret(value: string, head = 6, tail = 4): string {
  const v = value.trim();
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function requireEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    throw new Error(`${name} が空です。.env を確認してください。`);
  }
  return v;
}

async function postForm(
  label: string,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const redacted = { ...fields };
  if (redacted.access_token) {
    redacted.access_token = maskSecret(redacted.access_token);
  }
  console.log(`[${label}] request URL: ${url}`);
  console.log(`[${label}] request payload (redacted):`, JSON.stringify(redacted, null, 2));

  const body = new URLSearchParams(fields);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text.slice(0, 500) };
  }

  console.log(`[${label}] HTTP ${res.status}`);
  console.log(`[${label}] response:`, JSON.stringify(json, null, 2));

  if (!res.ok) {
    const err = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
    throw new Error(
      `${label} 失敗: HTTP ${res.status}` +
        (err?.code != null ? ` code=${err.code}` : "") +
        (err?.error_subcode != null ? ` subcode=${err.error_subcode}` : "") +
        (err?.message ? ` message=${err.message}` : ` body=${text.slice(0, 300)}`),
    );
  }
  return json;
}

async function main(): Promise<void> {
  const accessToken = requireEnv("THREADS_ACCESS_TOKEN");
  const userId = requireEnv("THREADS_USER_ID");
  const text =
    (process.env.THREADS_TEST_TEXT ?? "").trim() ||
    `Threads API 疎通テスト ${new Date().toISOString().slice(0, 19)}`;

  console.log("=== Threads 最小テキスト投稿テスト ===");
  console.log(`userId=${userId}`);
  console.log(`token=${maskSecret(accessToken)}`);
  console.log(`text=${text}`);

  // 1) container 作成（画像なし TEXT）
  const createUrl = `${base}/${encodeURIComponent(userId)}/threads`;
  const created = await postForm("container作成", createUrl, {
    media_type: "TEXT",
    text,
    access_token: accessToken,
  });

  const creationId = String(created.id ?? "").trim();
  if (!creationId) {
    throw new Error("container作成応答に id がありません");
  }
  console.log(`creation_id=${creationId}`);

  // 2) publish
  const publishUrl = `${base}/${encodeURIComponent(userId)}/threads_publish`;
  const published = await postForm("publish", publishUrl, {
    creation_id: creationId,
    access_token: accessToken,
  });

  const postId = String(published.id ?? "").trim();
  console.log("=== 成功 ===");
  console.log(`post_id=${postId || "(なし)"}`);
  console.log(`creation_id=${creationId}`);
  console.log("full publish response:", JSON.stringify(published));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("=== 失敗 ===");
  console.error(msg);
  process.exit(1);
});
