#!/bin/bash
# Threads コメント自動返信（ポーリング）— launchd / 手動 共用
# 投稿フロー（run-beauty.sh）とは独立。失敗しても exit 0。

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$ROOT/output"
LOG_FILE="$ROOT/output/threads-auto-reply.log"

echo "======== $(date '+%Y-%m-%d %H:%M:%S') threads-auto-reply 開始 ========"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "エラー: .env がありません" >&2
  exit 0
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

# launchd から呼ぶときは FORCE でも動くようにする
export THREADS_AUTO_REPLY_FORCE="${THREADS_AUTO_REPLY_FORCE:-true}"

npx tsx src/replyThreadsComments.ts >>"$LOG_FILE" 2>&1 || true

echo "======== $(date '+%Y-%m-%d %H:%M:%S') threads-auto-reply 終了 ========"
exit 0
