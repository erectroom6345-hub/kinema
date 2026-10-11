#!/bin/bash
# Threads 自動返信（ポーリング）— launchd から呼ぶ薄い入口
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="/Users/miyasakaharuki/treasure-shop-hp/content-studio"
cd "$ROOT" || exit 0

mkdir -p "$ROOT/logs"

npx tsx src/replyThreadsComments.ts
exit 0
