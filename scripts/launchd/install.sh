#!/bin/bash
# Install the weekly-basket launchd job.
#
#   scripts/launchd/install.sh install    # copy plist + load
#   scripts/launchd/install.sh reload     # replace + reload
#   scripts/launchd/install.sh uninstall  # unload + delete
#   scripts/launchd/install.sh status     # show status + next fire

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_PLIST="$REPO_ROOT/scripts/launchd/com.polytheta.weekly-basket.plist"
LABEL="com.polytheta.weekly-basket"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

cmd="${1:-status}"

case "$cmd" in
  install|reload)
    mkdir -p "$HOME/Library/LaunchAgents"
    cp "$SRC_PLIST" "$TARGET"
    launchctl bootout "gui/$(id -u)" "$TARGET" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$TARGET"
    launchctl enable "gui/$(id -u)/$LABEL"
    echo "installed: $TARGET"
    launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|next" || true
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)" "$TARGET" 2>/dev/null || true
    rm -f "$TARGET"
    echo "uninstalled: $TARGET"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "loaded"
      launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|next|last exit" || true
    else
      echo "not loaded"
    fi
    ;;
  run-now)
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "kicked $LABEL"
    ;;
  *)
    echo "usage: $0 {install|reload|uninstall|status|run-now}"; exit 1;;
esac
