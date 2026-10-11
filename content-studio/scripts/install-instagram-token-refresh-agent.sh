#!/bin/bash
# Instagram token 定期更新 LaunchAgent を登録する
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.instagram-token-refresh"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-instagram-token-refresh.sh"
chmod +x "$ROOT/scripts/install-instagram-token-refresh-agent.sh"
chmod +x "$ROOT/scripts/uninstall-instagram-token-refresh-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output/token"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎週日曜 08:30"
echo "ログ: $ROOT/output/instagram-token-refresh.log"
echo "状態: $ROOT/output/token/instagram-token-status.json"
echo "手動1回: bash $ROOT/run-instagram-token-refresh.sh"
echo "kickstart: launchctl kickstart -k gui/$(id -u)/${LABEL}"
