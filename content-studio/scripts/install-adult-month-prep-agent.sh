#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.adult-month-prep"
PLIST_SRC="$ROOT/launchd/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

chmod +x "$ROOT/run-adult-month-prep.sh"
chmod +x "$ROOT/scripts/prep-adult-next-month.sh"
chmod +x "$ROOT/scripts/install-adult-month-prep-agent.sh"
chmod +x "$ROOT/scripts/uninstall-adult-month-prep-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/output"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "登録完了: $PLIST_DST"
echo "スケジュール: 毎月 27–29日 10:00（EN+JP 取得→翌月パック／30–31で予約想定）"
echo "ログ: $ROOT/output/adult-month-prep.log"
echo "手動: bash $ROOT/run-adult-month-prep.sh"
echo "解除: bash $ROOT/scripts/uninstall-adult-month-prep-agent.sh"
echo "メモ: スリープ中は動かない。月末は起きているか電源接続を推奨"
