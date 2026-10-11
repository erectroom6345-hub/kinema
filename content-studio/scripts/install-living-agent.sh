#!/bin/bash
# 暮らし便利グッズ（living）日次 LaunchAgent を登録する
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio-living"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-living.sh"
chmod +x "$ROOT/scripts/install-living-agent.sh"
chmod +x "$ROOT/scripts/uninstall-living-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎日 10:00（美容 9:00 の後）"
echo "ログ: $ROOT/output/living-cron.log"
echo "手動1回: bash $ROOT/run-living.sh"
echo "kickstart: launchctl kickstart -k gui/$(id -u)/${LABEL}"
echo "解除: bash $ROOT/scripts/uninstall-living-agent.sh"
