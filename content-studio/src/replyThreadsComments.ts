/**
 * Threads コメント自動返信の薄い入口（ポーリング）
 *
 *   THREADS_AUTO_REPLY_FORCE=true npx tsx src/replyThreadsComments.ts
 *
 * 失敗しても process.exit(1) にしない（投稿フローを止めない）
 */
import fs from "node:fs";
import { loadThreadsEnvFromFile } from "./services/threads.ts";
import { pollAndAutoReply } from "./services/threadsReplies.ts";

loadThreadsEnvFromFile(process.cwd());

async function main(): Promise<void> {
  const result = await pollAndAutoReply();

  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/last-threads-auto-reply.json",
    `${JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  if (result.errors.length > 0) {
    console.warn(
      `[Threads返信] エラー ${result.errors.length} 件あり（投稿フローは継続扱い）`,
    );
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[Threads返信] エラー:", msg);
  process.exit(0);
});
