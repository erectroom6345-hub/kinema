#!/bin/bash
# 月末: adult-en / adult-jp の在庫取得〜翌月パック生成
# launchd: 毎月 27–29日 10:00（30–31の予約前に取得）
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1
mkdir -p "$ROOT/output/adult-en" "$ROOT/output/adult-jp"
LOG_FILE="${ADULT_MONTH_PREP_LOG:-$ROOT/output/adult-month-prep.log}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') adult-month-prep 開始 ========" | tee -a "$LOG_FILE"

# 27–29以外は何もしない（plist連打・手動実行の誤爆対策）
if ! python3 - <<'PY'
from datetime import date
import sys
t = date.today()
sys.exit(0 if t.day in (27, 28, 29) else 1)
PY
then
  echo "[adult-month-prep] skip (not day 27–29)" | tee -a "$LOG_FILE"
  exit 0
fi

set +e
bash "$ROOT/scripts/prep-adult-next-month.sh" >>"$LOG_FILE" 2>&1
code=$?
set -e

echo "exit=${code}" | tee -a "$LOG_FILE"
if [[ "${code}" -eq 0 ]]; then
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') adult-month-prep 成功 ========" | tee -a "$LOG_FILE"
  exit 0
fi
echo "======== $(date '+%Y-%m-%d %H:%M:%S') adult-month-prep 失敗 ========" | tee -a "$LOG_FILE"
exit "${code}"
