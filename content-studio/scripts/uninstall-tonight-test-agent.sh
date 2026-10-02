#!/bin/bash
# 今夜テスト用の一時LaunchAgentを削除（本番9時ジョブは触らない）
set -euo pipefail

LABEL="com.miyasakaharuki.contentstudio.tonight-test"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"

echo "削除しました: ${LABEL}"
echo "本番ジョブは残っています: com.miyasakaharuki.contentstudio"
launchctl print "gui/${UID_NUM}/com.miyasakaharuki.contentstudio" 2>&1 | head -15 || true
