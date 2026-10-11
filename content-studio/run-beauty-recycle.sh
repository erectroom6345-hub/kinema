#!/bin/bash
# 美容 recycle 投稿入口（手動 / 別スケジュール専用）
# 朝9時の run-beauty.sh（本番日次）とは分離。未投稿在庫ローテ再投稿用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "エラー: $ROOT/.env がありません" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$ROOT/.env"

# 本番日次ガードを迂回するため、パイプライン種別を明示
export BEAUTY_PIPELINE_MODE=recycle
# テスト設定は recycle 入口でも持ち込まない（明示したいときだけ外で立てる）
unset BEAUTY_TEST_MODE || true
unset BEAUTY_ALLOW_RECYCLE || true
unset BEAUTY_USE_REPOST || true
unset BEAUTY_SIMULATE_POSTED_ALL || true
unset BEAUTY_SIMULATE_UNPOSTED_ALL || true

echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty-recycle 開始 ========"
echo "mode=recycle BEAUTY_PIPELINE_MODE=recycle（日次自動投稿とは別入口）"

if [[ "${1:-}" == "--full" ]]; then
  echo "商品選定: --mode=recycle"
  node scripts/selectBeautyProduct.cjs --mode=recycle
  echo "選定後の article.selectedSource を確認:"
  node -e "const j=require('./input/article.json'); console.log(j.selectedSource, j.product&&j.product.id)"
  if [[ "$(node -e "const j=require('./input/article.json'); process.stdout.write(j.selectedSource||'')")" != "recycle" ]]; then
    echo "ERROR: selectedSource が recycle ではありません。中止します。" >&2
    exit 2
  fi
  export BEAUTY_SKIP_SELECT=true
  export BEAUTY_PIPELINE_MODE=recycle
  exec bash "$ROOT/run-beauty.sh"
fi

node scripts/selectBeautyProduct.cjs --mode=recycle "$@"
echo "======== $(date '+%Y-%m-%d %H:%M:%S') run-beauty-recycle 選定完了 ========"
echo "フル投稿まで続ける場合: bash run-beauty-recycle.sh --full"
