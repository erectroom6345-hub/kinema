#!/bin/bash
# Slack 通知の手動テスト（重複抑制を回避するため --force）
#   ./scripts/test-slack-notify.sh
#   ./scripts/test-slack-notify.sh "任意のエラー文"
#   ./scripts/test-slack-notify.sh --summary

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/notify.sh"

if [[ "${1:-}" == "--summary" ]]; then
  SLACK_DAILY_SUMMARY=true node "$ROOT/scripts/send-daily-summary.cjs" --force
  echo "日次サマリテスト完了"
  exit 0
fi

PRODUCT_ID="$(
  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync('input/article.json','utf8'));
      process.stdout.write((j.product && j.product.id) || 'beauty-test');
    } catch { process.stdout.write('beauty-test'); }
  " 2>/dev/null || echo "beauty-test"
)"

ERR_MSG="${1:-これは Slack 通知の手動テストです}"

if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
  echo "警告: SLACK_WEBHOOK_URL が未設定です。.env を確認してください。" >&2
fi

notify_event "error" "notify_test" "${PRODUCT_ID}" "手動テスト" "${ERR_MSG}" \
  "$ROOT/output/beauty-cron.log" --force
echo "テスト完了（force のため dedup 無視）"
