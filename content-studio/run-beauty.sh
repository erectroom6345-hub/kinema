#!/bin/bash
# Instagram美容投稿の自動実行入口（手動 / launchd 共用）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$ROOT/output"
LOG_FILE="$ROOT/output/beauty-cron.log"

TOTAL_STEPS=6
CURRENT_STEP=0
STEP_NAME=""

on_err() {
  local code=$?
  if [[ -n "${STEP_NAME:-}" ]]; then
    echo "FAILED at STEP ${CURRENT_STEP}: ${STEP_NAME}" >&2
  else
    echo "FAILED: 不明な段階で停止 (exit=${code})" >&2
  fi
  exit "${code}"
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
  STEP_NAME=""
}

# generateInstagramCard.ts が書き込んだ imageUrl を HTTP 200 になるまで短く待つ
wait_pages_ready() {
  local image_url
  image_url="$(
    node -e "
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync('input/instagram-post.json', 'utf8'));
      const u = (j.imageUrl || '').trim();
      if (!u) { console.error('imageUrl が空です'); process.exit(2); }
      process.stdout.write(u);
    "
  )"

  local max_attempts="${PAGES_WAIT_ATTEMPTS:-8}"
  local sleep_sec="${PAGES_WAIT_SECONDS:-15}"
  local i code

  echo "Pages反映確認対象: ${image_url}"
  echo "最大 ${max_attempts} 回、間隔 ${sleep_sec}s"

  for i in $(seq 1 "${max_attempts}"); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${image_url}" || true)"
    if [[ "${code}" == "200" ]]; then
      echo "Pages反映確認OK: HTTP ${code} (${i}/${max_attempts})"
      return 0
    fi
    echo "Pages未反映: HTTP ${code:-000} (${i}/${max_attempts})"
    if [[ "${i}" -lt "${max_attempts}" ]]; then
      sleep "${sleep_sec}"
    fi
  done

  echo "エラー: Pages反映待ちタイムアウト: ${image_url}" >&2
  return 1
}

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty 開始 ========"
echo "cwd=$ROOT"
echo "PATH=$PATH"
echo "log(launchd時)=$LOG_FILE"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "エラー: $ROOT/.env がありません。INSTAGRAM_* を設定してください。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

ensure_ollama() {
  local url="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
  url="${url%/}"
  if curl -sf --max-time 3 "$url/api/tags" >/dev/null; then
    echo "Ollama確認OK: $url"
    return 0
  fi

  echo "Ollama未応答のため起動を試みます: $url"
  if command -v open >/dev/null 2>&1; then
    open -a Ollama 2>/dev/null || true
  fi
  if command -v ollama >/dev/null 2>&1; then
    # すでに serve 中なら失敗するだけなので無視
    (ollama serve >/dev/null 2>&1 &) || true
  fi

  local i
  for i in $(seq 1 20); do
    sleep 3
    if curl -sf --max-time 3 "$url/api/tags" >/dev/null; then
      echo "Ollama起動確認OK (${i}回目)"
      return 0
    fi
    echo "Ollama待機中... (${i}/20)"
  done

  echo "エラー: Ollamaを起動できませんでした。ログイン項目で Ollama.app を有効にするか、手動で ollama serve してください。" >&2
  exit 1
}

ensure_ollama

run_step 1 "商品選択" bash -c '
  node scripts/selectBeautyProduct.cjs
  echo "article.json の内容を確認します..."
  cat input/article.json
'

# 有効な blogUrl が無ければ Blogger 公開 → URL を article / 在庫JSONへ書き戻し
# （IG本文には入れない。X/Threads 用に保持）
run_step 2 "Blogger公開とblogUrl取得" npx tsx src/publishBeautyBlogger.ts

run_step 3 "IG文生成" npx tsx src/generateInstagramCaption.ts

run_step 4 "IGカード生成とpush" npx tsx src/generateInstagramCard.ts

run_step 5 "Pages反映待ち" wait_pages_ready

run_step 6 "IG投稿" bash -c '
  echo "instagram-post.json を補完します..."
  node scripts/prepareInstagramPost.cjs
  echo "instagram-post.json の内容を確認します..."
  cat input/instagram-post.json
  echo "Instagram に投稿します..."
  npx tsx src/postInstagram.ts
'

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty 完了 ========"
