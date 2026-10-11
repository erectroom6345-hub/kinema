#!/bin/bash
set -euo pipefail
LABEL=com.miyasakaharuki.threads-auto-reply
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
echo "解除完了: ${LABEL}"
