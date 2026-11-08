#!/bin/bash
# Instagram美容投稿の自動実行入口（手動 / launchd 共用）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export CONTENT_PIPELINE_GENRE="${CONTENT_PIPELINE_GENRE:-beauty}"
# shellcheck source=scripts/lib/pipeline-lock.sh
source "$ROOT/scripts/lib/pipeline-lock.sh"
pipeline_lock

mkdir -p "$ROOT/output" "$ROOT/output/run-history" "$ROOT/output/metrics" "$ROOT/output/policy" "$ROOT/output/notify"
# 前回の blog 準備フラグを消す（SNSは今回の Blogger 成功時だけ通す）
rm -f "$ROOT/output/blog-ready.json"
LOG_FILE="$ROOT/output/beauty-cron.log"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib/notify.sh"

TOTAL_STEPS=9
CURRENT_STEP=0
STEP_NAME=""
RUN_STATUS="success"
LAST_ERROR=""

# STEP 状態ファイルを初期化
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
    node "$ROOT/scripts/write-run-summary.cjs" --startedAt="$STARTED_AT" --status="$status" --error="$err" || true
  else
    node "$ROOT/scripts/write-run-summary.cjs" --startedAt="$STARTED_AT" --status="$status" || true
  fi
}

fail_and_exit() {
  local code="${1:-1}"
  local err="${LAST_ERROR:-FAILED at STEP ${CURRENT_STEP}: ${STEP_NAME}}"
  echo "---- fail_and_exit code=${code} ----" >&2
  echo "${err}" >&2
  record_step "${CURRENT_STEP}" "${STEP_NAME:-unknown}" "fail" "${err}" || true
  notify_failure "${STEP_NAME:-unknown}" "$(current_product_id)" "${err}" "${LOG_FILE}" || true
  write_summary "failed" "${err}" || true
  echo "---- fail_and_exit: summary/notify 完了 ----" >&2
  exit "${code}"
}

on_err() {
  local code=$?
  if [[ -n "${STEP_NAME:-}" ]]; then
    LAST_ERROR="FAILED at STEP ${CURRENT_STEP}: ${STEP_NAME} (exit=${code})"
    echo "${LAST_ERROR}" >&2
  else
    LAST_ERROR="FAILED: 不明な段階で停止 (exit=${code})"
    echo "${LAST_ERROR}" >&2
  fi
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

# generateInstagramCard.ts が書き込んだ imageUrl / imageUrls を HTTP 200 になるまで短く待つ
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
  echo "最大 ${max_attempts} 回、間隔 ${sleep_sec}s"

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

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty 開始 ========"
echo "cwd=$ROOT"
echo "PATH=$PATH"
echo "log(launchd時)=$LOG_FILE"
echo "startedAt=${STARTED_AT}"

if [[ ! -f "$ROOT/.env" ]]; then
  LAST_ERROR="エラー: $ROOT/.env がありません。INSTAGRAM_* を設定してください。"
  echo "${LAST_ERROR}" >&2
  CURRENT_STEP=0
  STEP_NAME="環境準備"
  fail_and_exit 1
fi

# launchd / 親プロセスで既に渡された値は .env で上書きしない
# （過去: .env の BEAUTY_MORNING_MODE=auto が plist の true を潰し、朝が manual 180s 待ちになっていた）
# macOS bash 3.2 互換のため連想配列は使わない
_SAVED_BEAUTY_MORNING_MODE="${BEAUTY_MORNING_MODE-__UNSET__}"
_SAVED_BEAUTY_PIPELINE_MODE="${BEAUTY_PIPELINE_MODE-__UNSET__}"
_SAVED_BEAUTY_EMPTY_FALLBACK="${BEAUTY_EMPTY_FALLBACK-__UNSET__}"
_SAVED_OLLAMA_MORNING_TIMEOUT_MS="${OLLAMA_MORNING_TIMEOUT_MS-__UNSET__}"
_SAVED_OLLAMA_MORNING_WARMUP_TIMEOUT_MS="${OLLAMA_MORNING_WARMUP_TIMEOUT_MS-__UNSET__}"
_SAVED_OLLAMA_MORNING_SKIP_WARMUP="${OLLAMA_MORNING_SKIP_WARMUP-__UNSET__}"
_SAVED_CONTENT_STUDIO_ENV="${CONTENT_STUDIO_ENV-__UNSET__}"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

[[ "${_SAVED_BEAUTY_MORNING_MODE}" != "__UNSET__" ]] && export BEAUTY_MORNING_MODE="${_SAVED_BEAUTY_MORNING_MODE}"
[[ "${_SAVED_BEAUTY_PIPELINE_MODE}" != "__UNSET__" ]] && export BEAUTY_PIPELINE_MODE="${_SAVED_BEAUTY_PIPELINE_MODE}"
[[ "${_SAVED_BEAUTY_EMPTY_FALLBACK}" != "__UNSET__" ]] && export BEAUTY_EMPTY_FALLBACK="${_SAVED_BEAUTY_EMPTY_FALLBACK}"
[[ "${_SAVED_OLLAMA_MORNING_TIMEOUT_MS}" != "__UNSET__" ]] && export OLLAMA_MORNING_TIMEOUT_MS="${_SAVED_OLLAMA_MORNING_TIMEOUT_MS}"
[[ "${_SAVED_OLLAMA_MORNING_WARMUP_TIMEOUT_MS}" != "__UNSET__" ]] && export OLLAMA_MORNING_WARMUP_TIMEOUT_MS="${_SAVED_OLLAMA_MORNING_WARMUP_TIMEOUT_MS}"
[[ "${_SAVED_OLLAMA_MORNING_SKIP_WARMUP}" != "__UNSET__" ]] && export OLLAMA_MORNING_SKIP_WARMUP="${_SAVED_OLLAMA_MORNING_SKIP_WARMUP}"
[[ "${_SAVED_CONTENT_STUDIO_ENV}" != "__UNSET__" ]] && export CONTENT_STUDIO_ENV="${_SAVED_CONTENT_STUDIO_ENV}"
unset _SAVED_BEAUTY_MORNING_MODE _SAVED_BEAUTY_PIPELINE_MODE _SAVED_BEAUTY_EMPTY_FALLBACK
unset _SAVED_OLLAMA_MORNING_TIMEOUT_MS _SAVED_OLLAMA_MORNING_WARMUP_TIMEOUT_MS
unset _SAVED_OLLAMA_MORNING_SKIP_WARMUP _SAVED_CONTENT_STUDIO_ENV

# ---- 本番日次ガード: テスト設定が混在していたら即終了 ----
# recycle / repost 入口は BEAUTY_PIPELINE_MODE を明示する
export BEAUTY_PIPELINE_MODE="${BEAUTY_PIPELINE_MODE:-daily}"
echo "BEAUTY_PIPELINE_MODE=${BEAUTY_PIPELINE_MODE}"
echo "CONTENT_STUDIO_ENV=${CONTENT_STUDIO_ENV:-production}"
echo "BEAUTY_TEST_MODE=${BEAUTY_TEST_MODE:-false}"
echo "BEAUTY_MORNING_MODE=${BEAUTY_MORNING_MODE:-auto} (after .env merge)"
echo "BEAUTY_EMPTY_FALLBACK=${BEAUTY_EMPTY_FALLBACK:-recycle}"

if [[ "${BEAUTY_PIPELINE_MODE}" == "daily" ]]; then
  # 意図的なテストパイプラインのみ例外（launchd 本番では絶対に立てない）
  if [[ "${BEAUTY_ALLOW_TEST_PIPELINE:-}" == "true" ]]; then
    echo "WARNING: BEAUTY_ALLOW_TEST_PIPELINE=true — テスト用パイプラインとして続行します"
    export CONTENT_STUDIO_ENV=test
    export BEAUTY_TEST_MODE=true
  else
    if [[ "${BEAUTY_TEST_MODE:-}" == "true" || "${CONTENT_STUDIO_ENV:-}" == "test" ]]; then
      LAST_ERROR="FATAL: 本番日次 run-beauty に TEST MODE が有効です。朝の自動投稿を中止します。"
      echo "${LAST_ERROR}" >&2
      echo "意図的テスト: BEAUTY_ALLOW_TEST_PIPELINE=true bash run-beauty.sh" >&2
      CURRENT_STEP=0
      STEP_NAME="本番日次ガード"
      fail_and_exit 3
    fi
    if [[ "${BEAUTY_ALLOW_RECYCLE:-}" == "true" || "${BEAUTY_USE_REPOST:-}" == "true" || "${BEAUTY_SKIP_SELECT:-}" == "true" ]]; then
      LAST_ERROR="FATAL: 本番日次にテスト/recycle フラグが残っています (ALLOW_RECYCLE=${BEAUTY_ALLOW_RECYCLE:-} USE_REPOST=${BEAUTY_USE_REPOST:-} SKIP_SELECT=${BEAUTY_SKIP_SELECT:-})"
      echo "${LAST_ERROR}" >&2
      CURRENT_STEP=0
      STEP_NAME="本番日次ガード"
      fail_and_exit 3
    fi
    if ! node -e '
      const { assertProductionDailySafe, describeRuntime } = require("./scripts/lib/beauty-runtime.cjs");
      const r = describeRuntime();
      console.log("[beauty-runtime]", JSON.stringify(r));
      const g = assertProductionDailySafe();
      if (!g.ok) { console.error(g.message); process.exit(3); }
    '; then
      LAST_ERROR="FATAL: beauty-runtime が本番日次を拒否しました"
      CURRENT_STEP=0
      STEP_NAME="本番日次ガード"
      fail_and_exit 3
    fi
  fi
fi

# 朝ラン軽量モード（9:00定時は完了時刻優先。冷起動前提で長待ちしない）
# BEAUTY_MORNING_MODE=true|false|auto（auto=Asia/Tokyo 8-10時）
resolve_morning_mode() {
  local flag="${BEAUTY_MORNING_MODE:-auto}"
  flag="$(printf '%s' "$flag" | tr '[:upper:]' '[:lower:]')"
  if [[ "$flag" == "true" || "$flag" == "1" || "$flag" == "yes" || "$flag" == "on" ]]; then
    export BEAUTY_MORNING_MODE=true
    return 0
  fi
  if [[ "$flag" == "false" || "$flag" == "0" || "$flag" == "no" || "$flag" == "off" ]]; then
    export BEAUTY_MORNING_MODE=false
    return 0
  fi
  # date +%H は 09 を返す。bash の [[ -ge ]] は 09 を八進数解釈して失敗する → 10# で強制十進
  local hour
  hour="$(TZ=Asia/Tokyo date +%H)"
  hour=$((10#$hour))
  if [[ "${hour}" -ge 8 && "${hour}" -le 10 ]]; then
    export BEAUTY_MORNING_MODE=true
  else
    export BEAUTY_MORNING_MODE=false
  fi
}

ensure_ollama() {
  local url="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
  local model="${OLLAMA_MODEL:-gemma3:4b}"
  url="${url%/}"
  resolve_morning_mode
  local morning="${BEAUTY_MORNING_MODE:-false}"
  local warm_max="${OLLAMA_WARMUP_TIMEOUT_MS:-60000}"
  if [[ "${morning}" == "true" ]]; then
    warm_max="${OLLAMA_MORNING_WARMUP_TIMEOUT_MS:-45000}"
    echo "[morning-mode] ON — Ollama予熱あり / 生成90s目安 / 超過時フォールバック"
    # 既定は予熱する（冷起動→即fallbackを避ける）。明示 false 以外は予熱。
    export OLLAMA_MORNING_SKIP_WARMUP="${OLLAMA_MORNING_SKIP_WARMUP:-false}"
  else
    echo "[morning-mode] OFF — 手動/通常タイムアウト"
  fi

  if curl -sf --max-time 3 "$url/api/tags" >/dev/null; then
    echo "Ollama確認OK: $url"
  else
    echo "Ollama未応答のため起動を試みます: $url"
    if command -v open >/dev/null 2>&1; then
      open -a Ollama 2>/dev/null || true
    fi
    if command -v ollama >/dev/null 2>&1; then
      # すでに serve 中なら失敗するだけなので無視
      (ollama serve >/dev/null 2>&1 &) || true
    fi

    local i
    local max_wait=20
    if [[ "${morning}" == "true" ]]; then
      # 朝も起動待ちを極端に切らない（未起動→全fallbackの原因になる）
      max_wait=12
    fi
    for i in $(seq 1 "${max_wait}"); do
      sleep 3
      if curl -sf --max-time 3 "$url/api/tags" >/dev/null; then
        echo "Ollama起動確認OK (${i}回目)"
        break
      fi
      echo "Ollama待機中... (${i}/${max_wait})"
      if [[ "${i}" -eq "${max_wait}" ]]; then
        echo "WARN: Ollama未起動のまま続行（本文/captionはフォールバックで完走）" >&2
        return 0
      fi
    done
  fi

  # 朝でも既定は予熱する。OLLAMA_MORNING_SKIP_WARMUP=true のときだけスキップ
  if [[ "${morning}" == "true" && "${OLLAMA_MORNING_SKIP_WARMUP:-false}" == "true" ]]; then
    echo "Ollamaモデル予熱スキップ (OLLAMA_MORNING_SKIP_WARMUP=true)"
    return 0
  fi

  local warm_sec=$((warm_max / 1000))
  if [[ "${warm_sec}" -lt 5 ]]; then warm_sec=5; fi
  echo "Ollamaモデル予熱: ${model} (keep_alive=45m, max ${warm_sec}s)"
  local warm_code
  warm_code="$(
    curl -sS -o /tmp/ollama-warmup-beauty.json -w '%{http_code}' --max-time "${warm_sec}" \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"${model}\",\"prompt\":\"OK\",\"stream\":false,\"keep_alive\":\"45m\",\"options\":{\"num_predict\":8}}" \
      "${url}/api/generate" 2>/dev/null || true
  )"
  if [[ "${warm_code}" == "200" ]]; then
    echo "Ollamaモデル予熱OK"
  else
    echo "Ollamaモデル予熱スキップ/失敗 (HTTP ${warm_code:-000})。caption側フォールバックに委ねます"
  fi
  return 0
}

CURRENT_STEP=0
STEP_NAME="Ollama起動確認"
ensure_ollama
record_step 0 "Ollama起動確認" "ok"
STEP_NAME=""

# セール期間の自動供給（一次: beauty-sale-windows → products。補助: policy mirror）
# STEP番号は商品選択に含めず、選定直前の前処理として必ず実行する。
# 本番既定: official-page。Yahoo は 5/15/25/月末だけ軽量確認（日付だけでは sale にしない）。
# sync 失敗でも日次全体は止めず、windows=0 → saleDay=false → main 系へ倒す。
BEAUTY_SALE_PROVIDER="${BEAUTY_SALE_PROVIDER:-official-page}"
echo "[pre-select] セール期間同期 provider=${BEAUTY_SALE_PROVIDER}"
set +e
node scripts/sync-beauty-sale-windows.cjs --provider="${BEAUTY_SALE_PROVIDER}"
SALE_SYNC_CODE=$?
set -e
if [[ "${BEAUTY_SALE_SYNC_STRICT:-}" == "true" && "${SALE_SYNC_CODE}" -ne 0 ]]; then
  LAST_ERROR="ERROR: sale-sync failed under BEAUTY_SALE_SYNC_STRICT (exit=${SALE_SYNC_CODE})"
  CURRENT_STEP=1
  STEP_NAME="セール期間同期"
  fail_and_exit "${SALE_SYNC_CODE}"
fi
if [[ "${SALE_SYNC_CODE}" -ne 0 ]]; then
  echo "WARN: sale-sync exit=${SALE_SYNC_CODE} → windows をクリアして非セール日で続行" >&2
  set +e
  node scripts/sync-beauty-sale-windows.cjs --provider=none
  set -e
fi
node -e '
const { loadSyncStatus, loadWindows } = require("./scripts/lib/beauty-sale-windows.cjs");
const st = loadSyncStatus();
const win = loadWindows();
const count = Object.keys(win.items || {}).length;
console.log(
  `[pre-select:sale-sync] provider=${st.provider || process.env.BEAUTY_SALE_PROVIDER || "official-page"}` +
    ` windowsCount=${count}` +
    ` syncStatus=${st.syncStatus || "unknown"}`
);
'

# カタログ自動補充（公式一覧 → candidate queue → 品質ゲート → 適格のみ投入）
# 失敗しても選定は続行（止めない）
if [[ "${BEAUTY_INGEST_ENABLED:-true}" == "true" ]]; then
  echo "[pre-select] カタログ自動補充 ingest"
  set +e
  node scripts/ingest-beauty-catalog.cjs
  INGEST_CODE=$?
  set -e
  if [[ "${INGEST_CODE}" -ne 0 ]]; then
    echo "WARN: beauty-ingest exit=${INGEST_CODE} → 既存カタログのまま選定続行" >&2
  fi
else
  echo "[pre-select] カタログ自動補充スキップ (BEAUTY_INGEST_ENABLED!=true)"
fi

# 日次は未投稿専用。recycle / repost は別入口（run-beauty-recycle.sh / --use-repost-next）
run_step 1 "商品選択" bash -c '
  set -euo pipefail
  if [[ "${BEAUTY_PIPELINE_MODE:-daily}" != "daily" && "${BEAUTY_SKIP_SELECT:-}" == "true" ]]; then
    echo "BEAUTY_SKIP_SELECT=true pipeline=${BEAUTY_PIPELINE_MODE} → 選定スキップ（recycle/repost 入口から委譲時）"
    node -e "const j=require(\"./input/article.json\"); console.log(\"selectedSource=\"+(j.selectedSource||\"?\")+\" id=\"+((j.product&&j.product.id)||\"?\"));"
  else
    # 朝9時本体: --mode=daily 固定。残留フラグを無効化
    unset BEAUTY_USE_REPOST || true
    unset BEAUTY_ALLOW_RECYCLE || true
    node scripts/selectBeautyProduct.cjs --mode=daily
  fi
  echo "article.json の内容を確認します..."
  cat input/article.json
  # 日次ガード: unposted 以外は停止。在庫0の empty→recycle だけ例外
  if [[ "${BEAUTY_PIPELINE_MODE:-daily}" == "daily" ]]; then
    src="$(node -e "const j=require(\"./input/article.json\"); process.stdout.write(j.selectedSource||\"\")")"
    pid="$(node -e "const j=require(\"./input/article.json\"); process.stdout.write((j.product&&j.product.id)||\"\")")"
    empty_fb="$(node -e "const j=require(\"./input/article.json\"); process.stdout.write(j.emptyFallbackUsed? String(j.emptyFallbackMode||\"recycle\") : \"\")")"
    echo "[daily-guard] selectedSource=${src} selectedId=${pid} emptyFallback=${empty_fb:-none}"
    if [[ "$src" == "unposted" || "$src" == "tip" ]]; then
      :
    elif [[ "$src" == "recycle" && -n "$empty_fb" ]]; then
      echo "WARN: 未投稿在庫0のため empty→recycle で継続 id=${pid}" >&2
      # 管理者警告（失敗しても選定は継続）。force で warn フラグ未設定でも送る
      node scripts/send-notify.cjs \
        --level=warn \
        --eventType=beauty_empty_recycle \
        --productId="${pid}" \
        --step=商品選択 \
        --reason="未投稿在庫0のため empty→recycle で継続。カタログ補充を検討してください。" \
        --logPath="output/beauty-cron.log" \
        --force \
        || true
    else
      echo "ERROR: 日次自動投稿なのに selectedSource=${src} です。recycle/repost 混入のため停止。" >&2
      exit 2
    fi
  fi
'

BEAUTY_TIP_POST=false
if node -e '
  const j = require("./input/article.json");
  const tip = j.selectedSource === "tip" || String((j.product && j.product.postType) || "") === "tip";
  process.exit(tip ? 0 : 1);
'; then
  BEAUTY_TIP_POST=true
  echo "[tip] 土曜の話しかけ。商品URLとブログは出しません"
fi

if [[ "${BEAUTY_TIP_POST}" == "true" ]]; then
  echo "[STEP 2/${TOTAL_STEPS}] 商品URL解決 スキップ (tip)"
  record_step 2 "商品URL解決" "skipped"
  echo "[STEP 3/${TOTAL_STEPS}] Blogger公開とblogUrl取得 スキップ (tip)"
  record_step 3 "Blogger公開とblogUrl取得" "skipped"
else
# 選定直後: 通常の商品ページURLを article.product.url に確定（LinkSwitch 用）
# product-url-map.json → 失敗時は PRODUCT_URL_REQUIRE=true ならここで停止
run_step 2 "商品URL解決" bash -c '
  set -euo pipefail
  node scripts/resolveProductUrl.cjs
  echo "URL解決後の article.product.url:"
  node -e "const j=require(\"./input/article.json\"); console.log((j.product&&j.product.url)||\"(空)\")"
'

# 完全自動利益化の本線:
#   1) 商品ピックアップ → 2) 商品URL解決 → 3) Blogger公開 → 4以降) ブログ導線がある時だけ SNS
# （IG本文にはURLを入れない。X/Threads 末尾に blogUrl+UTM を付ける）
run_step 3 "Blogger公開とblogUrl取得" bash -c '
  set -euo pipefail
  echo "本番前ガード（禁止語・直近重複）..."
  node scripts/assert-beauty-prepublish.cjs --phase=article
  echo "ポリシーチェック（article）..."
  node scripts/check-policy.cjs --phase=article --channel=blogger --fail-on-block
  npx tsx src/publishBeautyBlogger.ts
'

# ブログが無い/失敗なら SNS には進まない
CURRENT_STEP=3
STEP_NAME="blogUrl確認(SNSゲート)"
echo "[STEP 3/${TOTAL_STEPS}] blogUrl確認(SNSゲート)"
if ! node "$ROOT/scripts/require-blog-url.cjs"; then
  LAST_ERROR="Blogger未準備のため SNS 投稿を中止（商品紹介導線なし）"
  echo "${LAST_ERROR}" >&2
  fail_and_exit 3
fi
record_step 3 "blogUrl確認(SNSゲート)" "ok"
# 画像0件でも本文公開は許容するが partial warning にする
IMAGE_STATUS="$(
  node -e '
    try {
      const j = require("./output/blog-ready.json");
      process.stdout.write(String(j.imageStatus || ""));
    } catch { process.stdout.write(""); }
  ' 2>/dev/null || true
)"
IMAGE_COUNT="$(
  node -e '
    try {
      const j = require("./output/blog-ready.json");
      process.stdout.write(String(Number(j.imageCount || 0)));
    } catch { process.stdout.write("0"); }
  ' 2>/dev/null || echo 0
)"
if [[ "${IMAGE_STATUS}" == "missing" || "${IMAGE_STATUS}" == "broken" || "${IMAGE_STATUS}" == "fixed-skipped" ]]; then
  echo "WARN: 商品画像なしで Blogger 公開済み (imageStatus=${IMAGE_STATUS} imageCount=${IMAGE_COUNT}) → RUN_STATUS=partial" >&2
  RUN_STATUS="partial"
  if [[ -z "${LAST_ERROR}" ]]; then
    LAST_ERROR="Blogger商品画像なし (${IMAGE_STATUS})"
  fi
elif [[ "${IMAGE_STATUS}" == "ok" && "${IMAGE_COUNT}" == "0" ]]; then
  echo "WARN: imageStatus=ok なのに最終HTML画像0件 → RUN_STATUS=partial" >&2
  RUN_STATUS="partial"
  if [[ -z "${LAST_ERROR}" ]]; then
    LAST_ERROR="Blogger商品画像なし (html-count-0)"
  fi
fi
STEP_NAME=""
fi

run_step 4 "IG文生成" npx tsx src/generateInstagramCaption.ts

run_step 5 "IGカード生成とpush" npx tsx src/generateInstagramCard.ts

run_step 6 "Pages反映待ち" wait_pages_ready

# 投稿前ポリシー: IG caption / Threads 元文 / blogger導入 を再チェック（block で停止）
run_step 7 "IG投稿" bash -c '
  set -euo pipefail
  echo "本番前ガード（禁止語・直近重複）..."
  node scripts/assert-beauty-prepublish.cjs --phase=social
  echo "ポリシーチェック（social）..."
  node scripts/check-policy.cjs --phase=social --channel=instagram --fail-on-block
  echo "instagram-post.json を補完します..."
  node scripts/prepareInstagramPost.cjs
  echo "instagram-post.json の内容を確認します..."
  cat input/instagram-post.json
  echo "Instagram に投稿します..."
  npx tsx src/postInstagram.ts
'

# Threads は独立失敗扱い（失敗しても run-beauty 全体は成功継続）
CURRENT_STEP=8
STEP_NAME="Threads投稿"
echo "[STEP 8/${TOTAL_STEPS}] Threads投稿 開始"
if [[ "${THREADS_ENABLED:-}" == "true" ]]; then
  # IG投稿前に social チェック済みだが、Threads直前にも再確認（block は独立失敗扱いで停止）
  if ! node scripts/check-policy.cjs --phase=social --channel=threads --fail-on-block; then
    LAST_ERROR="Threads投稿 ポリシーblock"
    echo "[STEP 8/${TOTAL_STEPS}] ${LAST_ERROR}" >&2
    record_step 8 "Threads投稿" "fail" "${LAST_ERROR}"
    notify_failure "ポリシーチェック" "$(current_product_id)" "${LAST_ERROR}" "${LOG_FILE}"
    RUN_STATUS="partial"
  elif npx tsx src/postThreads.ts; then
    echo "[STEP 8/${TOTAL_STEPS}] Threads投稿 成功"
    record_step 8 "Threads投稿" "ok"
  else
    LAST_ERROR="Threads投稿 失敗（独立失敗）"
    echo "[STEP 8/${TOTAL_STEPS}] ${LAST_ERROR}" >&2
    record_step 8 "Threads投稿" "fail" "${LAST_ERROR}"
    notify_failure "Threads投稿" "$(current_product_id)" "${LAST_ERROR}" "${LOG_FILE}"
    RUN_STATUS="partial"
  fi
else
  echo "[STEP 8/${TOTAL_STEPS}] Threads投稿 スキップ (THREADS_ENABLED!=true)"
  record_step 8 "Threads投稿" "skipped"
fi
STEP_NAME=""

# Threads 自動返信は独立（失敗しても全体は成功継続・exit で止めない）
CURRENT_STEP=9
STEP_NAME="Threads自動返信"
echo "[STEP 9/${TOTAL_STEPS}] Threads自動返信 開始"
if [[ "${THREADS_AUTO_REPLY:-}" == "true" ]]; then
  if npx tsx src/replyThreadsComments.ts; then
    record_step 9 "Threads自動返信" "ok"
  else
    LAST_ERROR="Threads自動返信 失敗（独立失敗）"
    echo "[STEP 9/${TOTAL_STEPS}] ${LAST_ERROR}" >&2
    record_step 9 "Threads自動返信" "fail" "${LAST_ERROR}"
    notify_failure "Threads自動返信" "$(current_product_id)" "${LAST_ERROR}" "${LOG_FILE}"
    if [[ "${RUN_STATUS}" == "success" ]]; then
      RUN_STATUS="partial"
    fi
  fi
  echo "[STEP 9/${TOTAL_STEPS}] Threads自動返信 終了（エラーがあっても継続）"
else
  echo "[STEP 9/${TOTAL_STEPS}] Threads自動返信 スキップ (THREADS_AUTO_REPLY!=true)"
  record_step 9 "Threads自動返信" "skipped"
fi
STEP_NAME=""

write_summary "${RUN_STATUS}" "${LAST_ERROR}"

# KPI: 直近IG insights 取得 → UTM/KPIサマリ（失敗しても本線は止めない）
if [[ "${BEAUTY_KPI_ENABLED:-true}" == "true" ]]; then
  echo "[kpi] IG insights / UTM 集計"
  set +e
  node "$ROOT/scripts/fetch-ig-insights.cjs" --recent="${BEAUTY_KPI_RECENT_DAYS:-14}"
  node "$ROOT/scripts/summarize-kpi.cjs" --days="${BEAUTY_KPI_RECENT_DAYS:-14}"
  set -e
fi

# 日次サマリ（info・既定OFF）。SLACK_DAILY_SUMMARY=true のときだけ Slack 送信
if [[ "${RUN_STATUS}" == "success" || "${RUN_STATUS}" == "partial" ]]; then
  node "$ROOT/scripts/send-daily-summary.cjs" || true
fi

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty 完了 status=${RUN_STATUS} ========"
