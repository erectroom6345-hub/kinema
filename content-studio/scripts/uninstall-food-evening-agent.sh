#!/bin/bash
set -euo pipefail
LABEL=com.miyasakaharuki.contentstudio-food-evening
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
echo "解除完了: ${LABEL}"
