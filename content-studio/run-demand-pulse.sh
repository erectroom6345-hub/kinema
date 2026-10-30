#!/bin/bash
# 困りごと需要の週次楽天脈拍（候補化のみ。手動OKが必要）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p output
LOG="output/demand-pulse.log"
{
  echo "==== demand-pulse $(date '+%Y-%m-%d %H:%M:%S %z') ===="
  node scripts/run-demand-pulse.cjs "$@"
  echo "==== done ===="
} 2>&1 | tee -a "$LOG"
