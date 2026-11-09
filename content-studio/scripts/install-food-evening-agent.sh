#!/bin/bash
# 食べ物（food）夜枠試験: 1日2本目。同じ垢・evening口調のみ。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio-food-evening"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-food.sh"
chmod +x "$ROOT/scripts/install-food-evening-agent.sh"
chmod +x "$ROOT/scripts/uninstall-food-evening-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎日 20:40（FOOD_POST_SLOT=evening）"
echo "ログ: $ROOT/output/food-evening-cron.log"
echo "手動1回: FOOD_POST_SLOT=evening bash $ROOT/run-food.sh"
echo "kickstart: launchctl kickstart -k gui/$(id -u)/${LABEL}"
echo "解除: bash $ROOT/scripts/uninstall-food-evening-agent.sh"
