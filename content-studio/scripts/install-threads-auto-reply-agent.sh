#!/bin/bash
# Threads 自動返信 LaunchAgent を登録する
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/launchd/com.miyasakaharuki.threads-auto-reply.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.miyasakaharuki.threads-auto-reply.plist"

chmod +x "$ROOT/run-threads-auto-reply.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/com.miyasakaharuki.threads-auto-reply" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "間隔: 2時間ごと / ログ: $ROOT/output/threads-auto-reply.log"
echo "手動1回: launchctl kickstart -k gui/$(id -u)/com.miyasakaharuki.threads-auto-reply"
