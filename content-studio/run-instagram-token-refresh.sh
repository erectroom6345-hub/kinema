#!/bin/bash
# Instagram token 定期更新（投稿ジョブとは分離。launchd / 手動共用）
# 残日数が閾値以下のときだけ交換を試す（ensureInstagramAccessToken 既定）。
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1

mkdir -p "$ROOT/output" "$ROOT/output/token" "$ROOT/output/notify" "$ROOT/logs"
LOG_FILE="${INSTAGRAM_TOKEN_REFRESH_LOG:-$ROOT/output/instagram-token-refresh.log}"
STATUS_FILE="$ROOT/output/token/instagram-token-status.json"

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/notify.sh"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') instagram-token-refresh 開始 ========" | tee -a "$LOG_FILE"

set +e
npx tsx scripts/refresh-instagram-token.ts "$@" >>"$LOG_FILE" 2>&1
code=$?
set -e

echo "exit=${code}" | tee -a "$LOG_FILE"

status_json() {
  local key="$1"
  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const v = j[process.argv[2]];
      process.stdout.write(v == null ? '' : String(v));
    } catch { process.stdout.write(''); }
  " "${STATUS_FILE}" "${key}" 2>/dev/null || true
}

if [[ "${code}" -eq 0 ]]; then
  action="$(status_json action)"
  kind="$(status_json kind)"
  # 成功 info は既定OFF（SLACK_NOTIFY_TOKEN_OK=true で送信）
  notify_event "info" "ig_token_refresh_ok" "instagram" "IG token更新" \
    "action=${action:-ok} kind=${kind:-unknown}" "${LOG_FILE}"
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') instagram-token-refresh 成功 ========" | tee -a "$LOG_FILE"
  exit 0
fi

err_msg="Instagram token 更新失敗 (exit=${code})"
err_from_status="$(status_json error)"
status_val="$(status_json status)"
if [[ -n "${err_from_status}" ]]; then
  err_msg="${err_msg}: ${err_from_status}"
elif [[ -n "${status_val}" ]]; then
  err_msg="${err_msg}: status=${status_val}"
fi

# 期限接近で secret 未設定など → warn（SLACK_NOTIFY_TOKEN_WARN で送信）
if [[ "${code}" -eq 2 ]]; then
  notify_event "warn" "ig_token_refresh_skipped" "instagram" "IG token更新" \
    "${err_msg}" "${LOG_FILE}"
else
  notify_event "error" "ig_token_refresh_failed" "instagram" "IG token更新" \
    "${err_msg}" "${LOG_FILE}"
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') instagram-token-refresh 失敗 ========" | tee -a "$LOG_FILE"
exit "${code}"
