#!/bin/bash
# food IG / Threads token 定期更新
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1

mkdir -p "$ROOT/output" "$ROOT/output/token"
LOG_FILE="${FOOD_TOKEN_REFRESH_LOG:-$ROOT/output/food-token-refresh.log}"

export CONTENT_PIPELINE_GENRE=food
export POSTED_PRODUCTS_PATH=data/posted-food.json

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') food-token-refresh 開始 ========" | tee -a "$LOG_FILE"

set +e
npx tsx scripts/refresh-food-tokens.ts "$@" >>"$LOG_FILE" 2>&1
code=$?
set -e

echo "exit=${code}" | tee -a "$LOG_FILE"
if [[ "${code}" -eq 0 ]]; then
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') food-token-refresh 成功 ========" | tee -a "$LOG_FILE"
  exit 0
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') food-token-refresh 失敗 ========" | tee -a "$LOG_FILE"
exit "${code}"
