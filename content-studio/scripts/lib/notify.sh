#!/bin/bash
# Slack 通知（静か・短い・重複抑制）。音は Slack クライアント側設定に任せる。
#
# 使い方:
#   source scripts/lib/notify.sh
#   notify_event error run_failed "$productId" "$step" "$reason" "$logPath"
#   notify_failure "$step" "$productId" "$reason" "$logPath"   # 互換ラッパ
#
# 環境変数:
#   SLACK_WEBHOOK_URL          必須（送信時）
#   SLACK_DAILY_SUMMARY=true   日次サマリ(info)を送る
#   SLACK_NOTIFY_WARN=true     一般 warn を送る
#   SLACK_NOTIFY_INFO=true     一般 info を送る
#   SLACK_NOTIFY_TOKEN_OK=true token 更新成功(info)
#   SLACK_NOTIFY_TOKEN_WARN=true token スキップ等(warn)
#   SLACK_NOTIFY_REPOST_EMPTY=true 再投稿候補0(warn)
#   SLACK_NOTIFY_REPOST_TOP=true   再投稿上位1(info)
#   SLACK_MACOS_NOTIFY=true    Slack失敗時の macOS 通知（既定OFF）

_notify_root() {
  if [[ -n "${ROOT:-}" && -d "${ROOT}/scripts/lib" ]]; then
    printf '%s' "${ROOT}"
    return
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  printf '%s' "${here}"
}

notify_event() {
  local level="${1:-error}"
  local event_type="${2:-unknown}"
  local product_id="${3:-}"
  local step="${4:-}"
  local reason="${5:-}"
  local log_path="${6:-}"
  local force_flag="${7:-}"
  local root
  root="$(_notify_root)"

  local args=(
    "$root/scripts/send-notify.cjs"
    "--level=${level}"
    "--eventType=${event_type}"
    "--productId=${product_id}"
    "--step=${step}"
    "--reason=${reason}"
    "--logPath=${log_path}"
  )
  if [[ "${force_flag}" == "--force" ]]; then
    args+=(--force)
  fi

  node "${args[@]}" || true

  # macOS は明示ONかつ error のときだけ（Slack 音とは別経路）
  if [[ "${level}" == "error" && "${SLACK_MACOS_NOTIFY:-false}" == "true" ]] \
    && command -v osascript >/dev/null 2>&1; then
    local short="${reason}"
    if [[ ${#short} -gt 120 ]]; then
      short="${short:0:117}..."
    fi
    osascript -e "display notification \"${short//\"/\\\"}\" with title \"content-studio\" subtitle \"${event_type//\"/\\\"}\"" \
      2>/dev/null || true
  fi
  return 0
}

# 後方互換: STEP / productId / reason / log
notify_failure() {
  local step_name="${1:-unknown}"
  local product_id="${2:-}"
  local error_message="${3:-unknown error}"
  local log_path="${4:-}"
  local event_type="run_failed"

  case "${step_name}" in
    *ポリシー*|*policy*|*Policy*) event_type="policy_block" ;;
    *token*|*Token*|*IG\ token*) event_type="ig_token_refresh_failed" ;;
    Threads投稿) event_type="threads_post_failed" ;;
    Threads自動返信) event_type="threads_reply_failed" ;;
  esac
  if [[ "${error_message}" == *ポリシー* || "${error_message}" == *policy*block* ]]; then
    event_type="policy_block"
  fi

  notify_event "error" "${event_type}" "${product_id}" "${step_name}" "${error_message}" "${log_path}"
}
