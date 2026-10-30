#!/bin/bash
# 困りごと需要ウォッチ（週1楽天脈拍）LaunchAgent
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio-demand-pulse"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-demand-pulse.sh"
chmod +x "$ROOT/scripts/install-demand-pulse-agent.sh"
chmod +x "$ROOT/scripts/uninstall-demand-pulse-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎週月曜 08:30（候補化のみ・自動投稿切替なし）"
echo "ログ: $ROOT/output/demand-pulse-cron.log / demand-pulse.log"
echo "手動1回: bash $ROOT/run-demand-pulse.sh"
echo "状態: npm run demand:status"
echo "OK例: npm run demand:approve -- --theme=stinkbug"
echo "解除: bash $ROOT/scripts/uninstall-demand-pulse-agent.sh"
