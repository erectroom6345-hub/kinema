#!/bin/bash
# 暮らし便利グッズ（living）— SNS先行 / 楽天一本 / 固定ページCTA
#
#   bash run-living.sh --dry-run   # 公開なし（文面・UTM確認）
#   bash run-living.sh             # 本番: 選品→SNS投稿
#
# ブログまとめ追記は別バッチ:
#   node scripts/check-living-growth.cjs --apply
#   node scripts/append-living-blog.cjs --apply
#   npx tsx scripts/publish-living-roundups.ts --apply

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export CONTENT_PIPELINE_GENRE=living
export POSTED_PRODUCTS_PATH="${POSTED_PRODUCTS_PATH:-data/posted-living.json}"
export THREADS_AUTO_REPLY=false
# shellcheck source=scripts/lib/pipeline-lock.sh
source "$ROOT/scripts/lib/pipeline-lock.sh"
pipeline_lock

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
  esac
done

mkdir -p "$ROOT/output" "$ROOT/output/run-history" "$ROOT/output/metrics" "$ROOT/output/policy" "$ROOT/output/notify" "$ROOT/output/living"
rm -f "$ROOT/output/blog-ready.json"
LOG_FILE="$ROOT/output/living-cron.log"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib/notify.sh"

TOTAL_STEPS=8
CURRENT_STEP=0
STEP_NAME=""
RUN_STATUS="success"
LAST_ERROR=""

: > "$ROOT/output/.run-steps.json"
echo '{}' > "$ROOT/output/.run-steps.json"

current_product_id() {
  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync('input/article.json','utf8'));
      process.stdout.write((j.product && j.product.id) || '');
    } catch { process.stdout.write(''); }
  " 2>/dev/null || true
}

record_step() {
  local n="$1"
  local name="$2"
  local status="$3"
  local err="${4:-}"
  if [[ -n "${err}" ]]; then
    node "$ROOT/scripts/record-run-step.cjs" --n="$n" --name="$name" --status="$status" --error="$err" || true
  else
    node "$ROOT/scripts/record-run-step.cjs" --n="$n" --name="$name" --status="$status" || true
  fi
}

write_summary() {
  local status="$1"
  local err="${2:-}"
  if [[ -n "${err}" ]]; then
    node "$ROOT/scripts/write-run-summary.cjs" --startedAt="$STARTED_AT" --status="$status" --error="$err" --genre=living || true
  else
    node "$ROOT/scripts/write-run-summary.cjs" --startedAt="$STARTED_AT" --status="$status" --genre=living || true
  fi
}

fail_and_exit() {
  local code="${1:-1}"
  local err="${LAST_ERROR:-FAILED at STEP ${CURRENT_STEP}: ${STEP_NAME}}"
  echo "---- fail_and_exit code=${code} ----" >&2
  echo "${err}" >&2
  record_step "${CURRENT_STEP}" "${STEP_NAME:-unknown}" "fail" "${err}" || true
  notify_failure "${STEP_NAME:-unknown}" "$(current_product_id)" "[living] ${err}" "${LOG_FILE}" || true
  write_summary "failed" "${err}" || true
  exit "${code}"
}

on_err() {
  local code=$?
  if [[ -n "${STEP_NAME:-}" ]]; then
    LAST_ERROR="FAILED at STEP ${CURRENT_STEP}: ${STEP_NAME} (exit=${code})"
  else
    LAST_ERROR="FAILED: 不明な段階で停止 (exit=${code})"
  fi
  echo "${LAST_ERROR}" >&2
  fail_and_exit "${code}"
}
trap on_err ERR

run_step() {
  local n="$1"
  local name="$2"
  shift 2
  CURRENT_STEP="$n"
  STEP_NAME="$name"
  echo "[STEP ${n}/${TOTAL_STEPS}] ${name} 開始"
  "$@"
  echo "[STEP ${n}/${TOTAL_STEPS}] ${name} 成功"
  record_step "$n" "$name" "ok"
  STEP_NAME=""
}

wait_pages_ready() {
  local urls
  urls="$(
    node -e "
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync('input/instagram-post.json', 'utf8'));
      const list = Array.isArray(j.imageUrls)
        ? j.imageUrls.map((u) => String(u || '').trim()).filter(Boolean)
        : [];
      const single = String(j.imageUrl || '').trim();
      const urls = list.length ? list : (single ? [single] : []);
      const video = String(j.videoUrl || '').trim();
      if (video && !urls.includes(video)) urls.push(video);
      if (!urls.length) { console.error('imageUrl が空です'); process.exit(2); }
      process.stdout.write(urls.join('\n'));
    "
  )"
  local max_attempts="${PAGES_WAIT_ATTEMPTS:-8}"
  local sleep_sec="${PAGES_WAIT_SECONDS:-15}"
  local i code url all_ok
  echo "Pages反映確認対象:"
  echo "${urls}"
  for i in $(seq 1 "${max_attempts}"); do
    all_ok=1
    while IFS= read -r url; do
      [[ -z "${url}" ]] && continue
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${url}" || true)"
      if [[ "${code}" != "200" ]]; then
        all_ok=0
        echo "Pages未反映: HTTP ${code:-000} (${i}/${max_attempts}) ${url}"
      else
        echo "Pages反映OK: HTTP ${code} (${i}/${max_attempts}) ${url}"
      fi
    done <<< "${urls}"
    if [[ "${all_ok}" -eq 1 ]]; then
      echo "Pages反映確認OK: 全画像 HTTP 200 (${i}/${max_attempts})"
      return 0
    fi
    if [[ "${i}" -lt "${max_attempts}" ]]; then
      sleep "${sleep_sec}"
    fi
  done
  echo "エラー: Pages反映待ちタイムアウト" >&2
  return 1
}

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-living 開始 dryRun=${DRY_RUN} mode=sns-first ========"
echo "cwd=$ROOT"
echo "CONTENT_PIPELINE_GENRE=${CONTENT_PIPELINE_GENRE}"
echo "startedAt=${STARTED_AT}"
echo "log(launchd時)=$LOG_FILE"

if [[ ! -f "$ROOT/.env" ]]; then
  LAST_ERROR="エラー: $ROOT/.env がありません"
  CURRENT_STEP=0
  STEP_NAME="環境準備"
  fail_and_exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
export CONTENT_PIPELINE_GENRE=living
export POSTED_PRODUCTS_PATH="${POSTED_PRODUCTS_PATH:-data/posted-living.json}"
# living は美容の自動返信設定を引き継がない
export THREADS_AUTO_REPLY=false

# 暮らし専用アカウントへ差し替え（美容の .env 値はファイル上そのまま）
apply_living_sns_env() {
  if [[ -n "${LIVING_INSTAGRAM_ACCESS_TOKEN:-}" ]]; then
    export INSTAGRAM_ACCESS_TOKEN="${LIVING_INSTAGRAM_ACCESS_TOKEN}"
  fi
  if [[ -n "${LIVING_INSTAGRAM_ACCOUNT_ID:-}" ]]; then
    export INSTAGRAM_ACCOUNT_ID="${LIVING_INSTAGRAM_ACCOUNT_ID}"
  fi
  if [[ -n "${LIVING_FACEBOOK_PAGE_ID:-}" ]]; then
    export FACEBOOK_PAGE_ID="${LIVING_FACEBOOK_PAGE_ID}"
  fi
  if [[ -n "${LIVING_INSTAGRAM_PREFER_PAGE_TOKEN:-}" ]]; then
    export INSTAGRAM_PREFER_PAGE_TOKEN="${LIVING_INSTAGRAM_PREFER_PAGE_TOKEN}"
  fi
  if [[ -n "${LIVING_FACEBOOK_APP_ID:-}" ]]; then
    export FACEBOOK_APP_ID="${LIVING_FACEBOOK_APP_ID}"
  fi
  if [[ -n "${LIVING_FACEBOOK_APP_SECRET:-}" ]]; then
    export FACEBOOK_APP_SECRET="${LIVING_FACEBOOK_APP_SECRET}"
  fi

  if [[ -n "${LIVING_THREADS_ACCESS_TOKEN:-}" ]]; then
    export THREADS_ACCESS_TOKEN="${LIVING_THREADS_ACCESS_TOKEN}"
  fi
  if [[ -n "${LIVING_THREADS_USER_ID:-}" ]]; then
    export THREADS_USER_ID="${LIVING_THREADS_USER_ID}"
  fi
  if [[ -n "${LIVING_THREADS_APP_ID:-}" ]]; then
    export THREADS_APP_ID="${LIVING_THREADS_APP_ID}"
  fi
  if [[ -n "${LIVING_THREADS_APP_SECRET:-}" ]]; then
    export THREADS_APP_SECRET="${LIVING_THREADS_APP_SECRET}"
  fi
  if [[ -n "${LIVING_THREADS_REDIRECT_URI:-}" ]]; then
    export THREADS_REDIRECT_URI="${LIVING_THREADS_REDIRECT_URI}"
  fi
  if [[ -n "${LIVING_THREADS_ENABLED:-}" ]]; then
    export THREADS_ENABLED="${LIVING_THREADS_ENABLED}"
  fi

  # X OAuth 1.0a（暮らし専用）
  if [[ -n "${LIVING_X_ENABLED:-}" ]]; then
    export X_ENABLED="${LIVING_X_ENABLED}"
  fi
  if [[ -n "${LIVING_X_API_KEY:-}" ]]; then
    export X_API_KEY="${LIVING_X_API_KEY}"
  fi
  if [[ -n "${LIVING_X_API_SECRET:-}" ]]; then
    export X_API_SECRET="${LIVING_X_API_SECRET}"
  fi
  if [[ -n "${LIVING_X_ACCESS_TOKEN:-}" ]]; then
    export X_ACCESS_TOKEN="${LIVING_X_ACCESS_TOKEN}"
  fi
  if [[ -n "${LIVING_X_ACCESS_TOKEN_SECRET:-}" ]]; then
    export X_ACCESS_TOKEN_SECRET="${LIVING_X_ACCESS_TOKEN_SECRET}"
  fi
}
apply_living_sns_env

if [[ -z "${LIVING_FIXED_PAGE_URL:-}" && "${DRY_RUN}" != "true" ]]; then
  LAST_ERROR="LIVING_FIXED_PAGE_URL が未設定です（ブログまとめ用。SNS誘導には使わない）"
  CURRENT_STEP=0
  STEP_NAME="環境準備"
  fail_and_exit 1
fi

if [[ "${DRY_RUN}" != "true" ]]; then
  if [[ -z "${LIVING_INSTAGRAM_ACCESS_TOKEN:-}" || -z "${LIVING_INSTAGRAM_ACCOUNT_ID:-}" ]]; then
    echo "警告: LIVING_INSTAGRAM_* 未設定。美容アカウントの INSTAGRAM_* が使われます" >&2
  fi
  if [[ "${THREADS_ENABLED:-}" == "true" && -z "${LIVING_THREADS_ACCESS_TOKEN:-}" ]]; then
    echo "警告: LIVING_THREADS_* 未設定。美容アカウントの THREADS_* が使われます" >&2
  fi
fi

ensure_ollama() {
  local url="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
  url="${url%/}"
  if curl -sf --max-time 3 "$url/api/tags" >/dev/null; then
    echo "Ollama確認OK: $url"
    return 0
  fi
  echo "Ollama未応答（living caption はテンプレ4段を使用）"
  return 0
}

CURRENT_STEP=0
STEP_NAME="Ollama起動確認"
ensure_ollama
record_step 0 "Ollama起動確認" "ok"
STEP_NAME=""

# 前段: 楽天APIで products-living.json の main[] を自動生成（既存選定はファイル読みのまま）
# LIVING_RAKUTEN_INGEST_ENABLED=false でスキップ可。未設定キー時は script が fail → 本線停止。
if [[ "${LIVING_RAKUTEN_INGEST_ENABLED:-true}" != "false" ]]; then
  run_step 0 "楽天カタログ取得" bash -c '
    set -euo pipefail
    node scripts/fetch-living-rakuten-catalog.cjs
    node scripts/check-living-catalog-no-sample.cjs
  '
else
  echo "[STEP 0/${TOTAL_STEPS}] 楽天カタログ取得 スキップ (LIVING_RAKUTEN_INGEST_ENABLED=false)"
  record_step 0 "楽天カタログ取得" "skipped"
fi

run_step 1 "商品選択" bash -c '
  node scripts/selectLivingProduct.cjs
  cat input/article.json
'

run_step 2 "楽天URL確認" bash -c '
  set -euo pipefail
  node -e "
    const fs = require(\"fs\");
    const j = JSON.parse(fs.readFileSync(\"input/article.json\",\"utf8\"));
    const tip = j.product && (j.product.affiliate === false || j.product.postType === \"tip\" || (j.product.labels && j.product.labels.tip));
    const u = (j.product && (j.product.rakutenUrl || j.product.url) || \"\").trim();
    if (tip) {
      j.product.url = \"\";
      j.product.rakutenUrl = \"\";
      j.product.affiliate = false;
      fs.writeFileSync(\"input/article.json\", JSON.stringify(j, null, 2) + \"\\n\");
      console.log(\"tip投稿: rakutenUrl スキップ（アフィ無し）\");
      process.exit(0);
    }
    if (!u) { console.error(\"rakutenUrl が空です\"); process.exit(2); }
    j.product.url = u;
    j.product.rakutenUrl = u;
    fs.writeFileSync(\"input/article.json\", JSON.stringify(j, null, 2) + \"\\n\");
    console.log(\"rakutenUrl:\", u);
  "
'

if [[ "${DRY_RUN}" == "true" ]]; then
  export LIVING_ALLOW_SAMPLE_CTA=true
  export OLLAMA_CAPTION_FALLBACK=true
  run_step 3 "SNS文面生成(dry-run)" bash -c '
    set -euo pipefail
    node scripts/check-policy.cjs --phase=social --channel=living-pipeline --fail-on-block || true
    npx tsx src/generateLivingCaption.ts
    npx tsx src/postX.ts
  '
  record_step 4 "IGカード生成とpush" "skipped"
  record_step 5 "Pages反映待ち" "skipped"
  record_step 6 "IG投稿" "skipped"
  record_step 7 "Threads投稿" "skipped"
  record_step 8 "X投稿" "skipped"
  node "$ROOT/scripts/sample-living-report.cjs" || true
  write_summary "success"
  echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-living dry-run 完了 ========"
  exit 0
fi

run_step 3 "SNS文面生成" bash -c '
  set -euo pipefail
  node scripts/check-policy.cjs --phase=social --channel=living-pipeline --fail-on-block
  npx tsx src/generateLivingCaption.ts
'

run_step 4 "IGカード生成とpush" npx tsx src/generateInstagramCard.ts

run_step 5 "Pages反映待ち" wait_pages_ready

run_step 6 "IG投稿" bash -c '
  set -euo pipefail
  node scripts/check-policy.cjs --phase=social --channel=instagram --fail-on-block
  node scripts/prepareInstagramPost.cjs
  cat input/instagram-post.json
  POSTED_PRODUCTS_PATH=data/posted-living.json npx tsx src/postInstagram.ts
'

CURRENT_STEP=7
STEP_NAME="Threads投稿"
echo "[STEP 7/${TOTAL_STEPS}] Threads投稿 開始"
if [[ "${THREADS_ENABLED:-}" == "true" ]]; then
  if ! node scripts/check-policy.cjs --phase=social --channel=threads --fail-on-block; then
    LAST_ERROR="Threads投稿 ポリシーblock"
    record_step 7 "Threads投稿" "fail" "${LAST_ERROR}"
    notify_failure "ポリシーチェック" "$(current_product_id)" "[living] ${LAST_ERROR}" "${LOG_FILE}"
    RUN_STATUS="partial"
  elif npx tsx src/postThreads.ts; then
    echo "[STEP 7/${TOTAL_STEPS}] Threads投稿 成功"
    record_step 7 "Threads投稿" "ok"
  else
    LAST_ERROR="Threads投稿 失敗（独立失敗）"
    record_step 7 "Threads投稿" "fail" "${LAST_ERROR}"
    notify_failure "Threads投稿" "$(current_product_id)" "[living] ${LAST_ERROR}" "${LOG_FILE}"
    RUN_STATUS="partial"
  fi
else
  echo "[STEP 7/${TOTAL_STEPS}] Threads投稿 スキップ (THREADS_ENABLED!=true)"
  record_step 7 "Threads投稿" "skipped"
fi
STEP_NAME=""

CURRENT_STEP=8
STEP_NAME="X投稿"
echo "[STEP 8/${TOTAL_STEPS}] X投稿 開始"
if [[ "${X_ENABLED:-}" == "true" ]]; then
  if npx tsx src/postX.ts; then
    record_step 8 "X投稿" "ok"
  else
    LAST_ERROR="X投稿 失敗（独立失敗）"
    record_step 8 "X投稿" "fail" "${LAST_ERROR}"
    notify_failure "X投稿" "$(current_product_id)" "[living] ${LAST_ERROR}" "${LOG_FILE}"
    if [[ "${RUN_STATUS}" == "success" ]]; then
      RUN_STATUS="partial"
    fi
  fi
else
  echo "[STEP 8/${TOTAL_STEPS}] X投稿 スキップ (X_ENABLED!=true) — 下書きのみ"
  npx tsx src/postX.ts || true
  record_step 8 "X投稿" "skipped"
fi
STEP_NAME=""

# 伸び判定用に SNS 履歴へ1行
node "$ROOT/scripts/record-living-sns-post.cjs" || true

write_summary "${RUN_STATUS}" "${LAST_ERROR}"

if [[ "${RUN_STATUS}" == "success" || "${RUN_STATUS}" == "partial" ]]; then
  node "$ROOT/scripts/send-daily-summary.cjs" || true
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-living 完了 status=${RUN_STATUS} ========"
