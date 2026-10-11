#!/bin/bash
# 今夜の1回限りテスト用ラッパー（本番9時ジョブとは別Label）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio.tonight-test"
LOG="$ROOT/output/beauty-tonight-test.log"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$ROOT/output"
{
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') tonight-test 開始 ========"
  echo "label=$LABEL"
  echo "本番9時ジョブ (com.miyasakaharuki.contentstudio) には触れません"
} | tee -a "$LOG"

# 本体は本番日次と同じ経路。
# ※ .env に BEAUTY_TEST_MODE / BEAUTY_ALLOW_RECYCLE 等を残さないこと（残っていると本番ガードで停止）
set +e
/bin/bash "$ROOT/run-beauty.sh" >>"$LOG" 2>&1
STATUS=$?
set -e

{
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') tonight-test 終了 exit=$STATUS ========"
} | tee -a "$LOG"

# 1回実行後に自分自身を外す（翌日同刻の再発火を防ぐ）
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"
echo "一時テストAgentを削除しました: $LABEL" | tee -a "$LOG"

exit "$STATUS"
