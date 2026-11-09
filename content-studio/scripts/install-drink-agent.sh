#!/bin/bash
# 銘酒・季節酒（drink）日次 LaunchAgent を登録する
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio-drink"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-drink.sh"
chmod +x "$ROOT/scripts/install-drink-agent.sh"
chmod +x "$ROOT/scripts/uninstall-drink-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎日 9:40（living 9:10 の次 / caffeinate付き）"
echo "ログ: $ROOT/output/drink-cron.log"
echo "手動1回: bash $ROOT/run-drink.sh"
echo "kickstart: launchctl kickstart -k gui/$(id -u)/${LABEL}"
echo "解除: bash $ROOT/scripts/uninstall-drink-agent.sh"
echo "Mac起床: bash $ROOT/scripts/install-morning-wake.sh  （08:55 wake）"
echo "追記ジョブ: bash $ROOT/scripts/install-drink-followup-agent.sh  （11:40）"
echo "token更新: bash $ROOT/scripts/install-drink-token-refresh-agent.sh  （日曜08:55）"
