#!/bin/bash
# drink IG / Threads token 定期更新
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1

mkdir -p "$ROOT/output" "$ROOT/output/token"
LOG_FILE="${DRINK_TOKEN_REFRESH_LOG:-$ROOT/output/drink-token-refresh.log}"

export CONTENT_PIPELINE_GENRE=drink
export POSTED_PRODUCTS_PATH=data/posted-drink.json

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') drink-token-refresh 開始 ========" | tee -a "$LOG_FILE"

set +e
npx tsx scripts/refresh-drink-tokens.ts "$@" >>"$LOG_FILE" 2>&1
code=$?
set -e

echo "exit=${code}" | tee -a "$LOG_FILE"
if [[ "${code}" -eq 0 ]]; then
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') drink-token-refresh 成功 ========" | tee -a "$LOG_FILE"
  exit 0
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') drink-token-refresh 失敗 ========" | tee -a "$LOG_FILE"
exit "${code}"
