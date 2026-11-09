#!/bin/bash
# 毎朝 08:55 に Mac を起こし、美容 9:00 / living 9:10 の launchd が遅れないようにする。
# LaunchAgent はスリープ中だと定時を逃し、復帰後に遅延実行される。
#
# Usage:
#   bash scripts/install-morning-wake.sh
#   bash scripts/install-morning-wake.sh --show
#   bash scripts/install-morning-wake.sh --clear
set -euo pipefail

if [[ "${1:-}" == "--show" ]]; then
  pmset -g sched || true
  exit 0
fi

if [[ "${1:-}" == "--clear" ]]; then
  echo "sudo pmset repeat cancel を実行します（要パスワード）"
  sudo pmset repeat cancel
  pmset -g sched || true
  exit 0
fi

echo "毎朝 08:55 に wakeorpoweron を設定します（sudo 必要）"
echo "目的: 美容 9:00 / living 9:10 がスリープで遅れないようにする"
sudo pmset repeat wakeorpoweron MTWRFSU 08:55:00
echo "設定後:"
pmset -g sched || true
echo ""
echo "確認: 電源アダプタ接続 + ログイン状態を推奨。蓋閉じでも起動する設定は Energy Saver 側も確認。"
echo "補足: living 本体/followup は caffeinate -i 付きで実行中のスリープを抑止します。"
