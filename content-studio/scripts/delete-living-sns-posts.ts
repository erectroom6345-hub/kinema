/**
 * living の IG / Threads 投稿を削除する（差し替え用）。
 *
 *   npx tsx scripts/delete-living-sns-posts.ts
 *   npx tsx scripts/delete-living-sns-posts.ts --ig=ID --threads=ID
 *   npx tsx scripts/delete-living-sns-posts.ts --from-summary
 *
 * 必要権限:
 * - Instagram: pages_manage_posts / instagram_manage_contents 等（Appにより異なる）
 * - Threads: threads_delete または manage 系
 *
 * 権限不足のときは手動削除手順を表示して exit 2。
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  applyLivingInstagramEnvOverrides,
  loadInstagramEnvFromFile,
} from "../src/services/instagramAuth.ts";
import {
  applyLivingThreadsEnvOverrides,
  loadThreadsEnvFromFile,
} from "../src/services/threads.ts";

function argValue(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : "";
}

function readSummaryIds(): { ig?: string; threads?: string } {
  const p = path.resolve("output/last-run-summary.json");
  if (!fs.existsSync(p)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as {
      igPostId?: string;
      threadsPostId?: string;
      genre?: string;
    };
    if (j.genre && j.genre !== "living") {
      console.warn(`[delete] last-run-summary genre=${j.genre}（living以外）`);
    }
    return {
      ig: (j.igPostId || "").trim() || undefined,
      threads: (j.threadsPostId || "").trim() || undefined,
    };
  } catch {
    return {};
  }
}

async function deleteInstagram(mediaId: string): Promise<{ ok: boolean; detail: string }> {
  process.env.CONTENT_PIPELINE_GENRE = "living";
  loadInstagramEnvFromFile();
  applyLivingInstagramEnvOverrides();
  const token = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!token) return { ok: false, detail: "INSTAGRAM_ACCESS_TOKEN 未設定" };

  const url = `https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "DELETE" });
  const text = await res.text();
  let body: { success?: boolean; error?: { message?: string; code?: number } } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text.slice(0, 200) } };
  }
  if (res.ok && body.success !== false) {
    return { ok: true, detail: text.slice(0, 200) || "deleted" };
  }
  return {
    ok: false,
    detail: body.error?.message || `HTTP ${res.status} ${text.slice(0, 200)}`,
  };
}

async function deleteThreads(postId: string): Promise<{ ok: boolean; detail: string }> {
  process.env.CONTENT_PIPELINE_GENRE = "living";
  loadThreadsEnvFromFile();
  applyLivingThreadsEnvOverrides();
  const token = (process.env.THREADS_ACCESS_TOKEN || "").trim();
  if (!token) return { ok: false, detail: "THREADS_ACCESS_TOKEN 未設定" };

  const url = `https://graph.threads.net/v1.0/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "DELETE" });
  const text = await res.text();
  let body: { success?: boolean; error?: { message?: string; code?: number } } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text.slice(0, 200) } };
  }
  if (res.ok && (body.success === true || !body.error)) {
    return { ok: true, detail: text.slice(0, 200) || "deleted" };
  }
  return {
    ok: false,
    detail: body.error?.message || `HTTP ${res.status} ${text.slice(0, 200)}`,
  };
}

async function main(): Promise<void> {
  const fromSummary = process.argv.includes("--from-summary");
  const summary = fromSummary || (!argValue("ig") && !argValue("threads"))
    ? readSummaryIds()
    : {};
  const igId = argValue("ig") || summary.ig || "";
  const threadsId = argValue("threads") || summary.threads || "";

  if (!igId && !threadsId) {
    console.error(
      "使い方: npx tsx scripts/delete-living-sns-posts.ts --ig=ID --threads=ID\n" +
        "  または: npx tsx scripts/delete-living-sns-posts.ts --from-summary",
    );
    process.exit(1);
  }

  console.log("---- living SNS delete ----");
  console.log(`ig=${igId || "(skip)"}`);
  console.log(`threads=${threadsId || "(skip)"}`);

  let fail = 0;
  if (igId) {
    const r = await deleteInstagram(igId);
    console.log(`[IG] ${r.ok ? "OK" : "FAIL"} ${r.detail}`);
    if (!r.ok) fail += 1;
  }
  if (threadsId) {
    const r = await deleteThreads(threadsId);
    console.log(`[Threads] ${r.ok ? "OK" : "FAIL"} ${r.detail}`);
    if (!r.ok) fail += 1;
  }

  if (fail) {
    console.error(
      "\n権限不足の可能性が高いです。Meta App に削除権限を追加するか、各アプリから手動削除してください。\n" +
        "- Instagram: 投稿を長押し → 削除\n" +
        "- Threads: 投稿メニュー → 削除\n" +
        "必要スコープ例: instagram_manage_contents / pages_manage_posts / threads_delete",
    );
    process.exit(2);
  }
  console.log("delete OK");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
