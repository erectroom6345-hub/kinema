# 同時刻に複数ジャンルが起きても、共有の article.json / instagram-post.json /
# instagram-cards の git を同時に触らない。
#
# trap は関数ローカル変数を参照できない（set -u で unbound になる）ため、
# 解除パスは ROOT 由来の固定パスにする。

PIPELINE_LOCK_DIR_NAME=".pipeline.lockdir"

pipeline_lock_dir() {
  echo "${ROOT}/output/${PIPELINE_LOCK_DIR_NAME}"
}

pipeline_unlock() {
  local dir
  dir="$(pipeline_lock_dir)"
  rm -rf "${dir}"
}

pipeline_lock() {
  local lockdir
  local waited=0
  local max="${PIPELINE_LOCK_WAIT_SEC:-7200}"
  lockdir="$(pipeline_lock_dir)"
  mkdir -p "${ROOT}/output"
  if [[ -d "${lockdir}" ]]; then
    local now epoch owner_pid
    now="$(date +%s)"
    epoch="$(stat -f %m "${lockdir}" 2>/dev/null || echo "${now}")"
    owner_pid="$(awk '{print $1}' "${lockdir}/owner" 2>/dev/null || true)"
    if [[ -n "${owner_pid}" ]] && ! kill -0 "${owner_pid}" 2>/dev/null; then
      echo "所有者プロセスがいない投稿ロックを外します (pid=${owner_pid})"
      rm -rf "${lockdir}"
    elif (( now - epoch > 10800 )); then
      echo "3時間以上前の投稿ロックを外します"
      rm -rf "${lockdir}"
    fi
  fi
  while ! mkdir "${lockdir}" 2>/dev/null; do
    echo "別ジャンルの投稿が動いているので待ちます (${waited}s)"
    sleep 20
    waited=$((waited + 20))
    if (( waited >= max )); then
      echo "投稿ロック待ちがタイムアウトしました"
      exit 1
    fi
    # 待ち中にも所有者死亡を拾う
    if [[ -d "${lockdir}" ]]; then
      local owner_pid
      owner_pid="$(awk '{print $1}' "${lockdir}/owner" 2>/dev/null || true)"
      if [[ -n "${owner_pid}" ]] && ! kill -0 "${owner_pid}" 2>/dev/null; then
        echo "所有者プロセスがいない投稿ロックを外します (pid=${owner_pid})"
        rm -rf "${lockdir}"
      fi
    fi
  done
  echo "$$ $(date -u +%Y-%m-%dT%H:%M:%SZ) ${CONTENT_PIPELINE_GENRE:-unknown}" > "${lockdir}/owner"
  trap 'pipeline_unlock' EXIT
  echo "投稿ロック取得: ${CONTENT_PIPELINE_GENRE:-unknown}"
}
