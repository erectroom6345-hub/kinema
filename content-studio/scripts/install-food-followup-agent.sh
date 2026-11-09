#!/bin/bash
# food 伸び判定〜まとめ追記 LaunchAgent
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio-food-followup"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-food-followup.sh"
chmod +x "$ROOT/scripts/install-food-followup-agent.sh"
chmod +x "$ROOT/scripts/uninstall-food-followup-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎日 11:30（growth → append → roundups）"
echo "ログ: $ROOT/output/food-followup-cron.log"
echo "手動: bash $ROOT/run-food-followup.sh"
echo "dry-run: bash $ROOT/run-food-followup.sh --dry-run"
echo "解除: bash $ROOT/scripts/uninstall-food-followup-agent.sh"
