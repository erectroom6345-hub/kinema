#!/bin/bash
set -euo pipefail
LABEL="com.miyasakaharuki.gadget-token-refresh"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "解除完了: ${LABEL}"
