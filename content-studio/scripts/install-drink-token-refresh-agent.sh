#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.drink-token-refresh"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-drink-token-refresh.sh"
chmod +x "$ROOT/scripts/install-drink-token-refresh-agent.sh"
chmod +x "$ROOT/scripts/uninstall-drink-token-refresh-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output/token"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎週日曜 08:55"
echo "ログ: $ROOT/output/drink-token-refresh.log"
echo "手動: bash $ROOT/run-drink-token-refresh.sh"
echo "解除: bash $ROOT/scripts/uninstall-drink-token-refresh-agent.sh"
echo "メモ: IG自動延長には DRINK_FACEBOOK_APP_ID / SECRET（token発行Appと一致）が必要"
