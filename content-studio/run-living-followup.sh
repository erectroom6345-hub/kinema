#!/bin/bash
# living 伸び判定 → まとめ追記 → Blogger反映（投稿本体とは別ジョブ）
#
#   bash run-living-followup.sh
#   bash run-living-followup.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export CONTENT_PIPELINE_GENRE=living
export POSTED_PRODUCTS_PATH="${POSTED_PRODUCTS_PATH:-data/posted-living.json}"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
  esac
done

mkdir -p "$ROOT/output" "$ROOT/output/living" "$ROOT/output/metrics"
LOG_FILE="$ROOT/output/living-followup-cron.log"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') living-followup 開始 dryRun=${DRY_RUN} ========" | tee -a "$LOG_FILE"
echo "startedAt=${STARTED_AT}" | tee -a "$LOG_FILE"

APPLY_FLAG="--apply"
if [[ "${DRY_RUN}" == "true" ]]; then
  APPLY_FLAG="--dry-run"
fi

echo "[1/3] 伸び判定" | tee -a "$LOG_FILE"
node scripts/check-living-growth.cjs ${APPLY_FLAG} 2>&1 | tee -a "$LOG_FILE"

echo "[2/3] まとめ追記" | tee -a "$LOG_FILE"
node scripts/append-living-blog.cjs ${APPLY_FLAG} 2>&1 | tee -a "$LOG_FILE"

echo "[3/3] Blogger roundups 反映" | tee -a "$LOG_FILE"
if [[ "${DRY_RUN}" == "true" ]]; then
  npx tsx scripts/publish-living-roundups.ts --dry-run 2>&1 | tee -a "$LOG_FILE" || true
else
  # レジストリ未seedでも本線投稿は止めない
  if npx tsx scripts/publish-living-roundups.ts --apply 2>&1 | tee -a "$LOG_FILE"; then
    echo "roundups publish OK" | tee -a "$LOG_FILE"
  else
    echo "roundups publish スキップ/失敗（seed未実施の可能性）" | tee -a "$LOG_FILE"
  fi
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') living-followup 完了 ========" | tee -a "$LOG_FILE"
