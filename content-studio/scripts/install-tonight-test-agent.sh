#!/bin/bash
# 約5〜6分後に1回だけ run-beauty を動かす一時LaunchAgentを登録する
# 本番: com.miyasakaharuki.contentstudio（9:00）は変更しない
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.miyasakaharuki.contentstudio.tonight-test"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
WRAPPER="$ROOT/scripts/run-beauty-tonight-test.sh"
UID_NUM="$(id -u)"

chmod +x "$WRAPPER"
mkdir -p "$ROOT/output" "$HOME/Library/LaunchAgents"

# 現在時刻+6分（秒による取りこぼし回避）
MONTH="$(python3 -c 'from datetime import datetime,timedelta; t=datetime.now()+timedelta(minutes=6); print(t.month)')"
DAY="$(python3 -c 'from datetime import datetime,timedelta; t=datetime.now()+timedelta(minutes=6); print(t.day)')"
HOUR="$(python3 -c 'from datetime import datetime,timedelta; t=datetime.now()+timedelta(minutes=6); print(t.hour)')"
MINUTE="$(python3 -c 'from datetime import datetime,timedelta; t=datetime.now()+timedelta(minutes=6); print(t.minute)')"
WHEN="$(python3 -c 'from datetime import datetime,timedelta; t=datetime.now()+timedelta(minutes=6); print(t.strftime("%Y-%m-%d %H:%M"))')"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${WRAPPER}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${ROOT}</string>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>HOME</key>
      <string>${HOME}</string>
    </dict>

    <key>StartCalendarInterval</key>
    <dict>
      <key>Month</key>
      <integer>${MONTH}</integer>
      <key>Day</key>
      <integer>${DAY}</integer>
      <key>Hour</key>
      <integer>${HOUR}</integer>
      <key>Minute</key>
      <integer>${MINUTE}</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>${ROOT}/output/beauty-tonight-test.log</string>
    <key>StandardErrorPath</key>
    <string>${ROOT}/output/beauty-tonight-test.log</string>

    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
EOF

# 既存の同名テストがあれば外してから入れ直す
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"

# 未投稿の確認（beauty-sale-002 がなければ警告）
ROOT="$ROOT" node <<NODE
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;
const products = JSON.parse(fs.readFileSync(path.join(root, 'input/products-beauty.json'), 'utf8'));
const posted = JSON.parse(fs.readFileSync(path.join(root, 'data/posted-beauty.json'), 'utf8'));
const all = [...(products.sale||[]), ...(products.main||[]), ...(products.niche||[]), ...(products.routine||[])];
const unposted = all.filter(p => !posted.includes(p.id));
console.log('未投稿件数:', unposted.length);
console.log('次に選ばれる候補:', unposted[0]?.id || '(なし→ローテ)');
if (!unposted.some(p => p.id === 'beauty-sale-002')) {
  console.warn('注意: beauty-sale-002 が未投稿リストにありません');
} else {
  console.log('テスト商品 beauty-sale-002 は未投稿です（優先選択される想定）');
}
NODE

echo ""
echo "登録完了"
echo "  Label : ${LABEL}"
echo "  実行  : ${WHEN} 頃に1回"
echo "  本体  : ${WRAPPER} → run-beauty.sh"
echo "  ログ  : ${ROOT}/output/beauty-tonight-test.log"
echo "  本番  : com.miyasakaharuki.contentstudio（9:00）はそのまま"
echo ""
echo "確認: launchctl print gui/${UID_NUM}/${LABEL} | head -30"
echo "取消: ${ROOT}/scripts/uninstall-tonight-test-agent.sh"
