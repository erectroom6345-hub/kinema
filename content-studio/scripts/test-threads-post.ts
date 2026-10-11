/**
 * Threads テキスト投稿の最小疎通テスト（自動運用フロー非接続）
 * service 層を直接叩く。
 *
 *   npx tsx scripts/test-threads-post.ts
 *   THREADS_TEST_TEXT='任意の一文' npx tsx scripts/test-threads-post.ts
 */
import {
  loadThreadsEnvFromFile,
  publishThreadsTextPost,
  readThreadsCredentialsFromEnv,
} from "../src/services/threads.ts";

loadThreadsEnvFromFile(process.cwd());

async function main(): Promise<void> {
  const creds = readThreadsCredentialsFromEnv();
  const text =
    (process.env.THREADS_TEST_TEXT ?? "").trim() ||
    `Threads API 疎通テスト ${new Date().toISOString().slice(0, 19)}`;

  console.log("=== Threads 最小テキスト投稿テスト ===");
  const result = await publishThreadsTextPost({ text, credentials: creds });
  console.log("=== 成功 ===");
  console.log(`post_id=${result.postId}`);
  console.log(`creation_id=${result.creationId}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("=== 失敗 ===");
  console.error(msg);
  process.exit(1);
});
