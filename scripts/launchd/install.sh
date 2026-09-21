#!/bin/bash
# Install the Polytheta launchd agents.
#
#   scripts/launchd/install.sh install [label]   # copy plist(s) + load
#   scripts/launchd/install.sh reload  [label]   # replace + reload
#   scripts/launchd/install.sh uninstall [label] # unload + delete
#   scripts/launchd/install.sh status            # show status + last exit
#   scripts/launchd/install.sh run-now <label>   # kickstart one agent
#
# Labels: weekly-basket monday-revalidate alert-bridge schwab-snapshot ib-execution ib-heartbeat
#
# Notes:
# - The repo lives under ~/Library/CloudStorage/Dropbox. launchd's xpcproxy is
#   TCC-sandboxed and cannot open stdout/stderr files inside that folder unless
#   the file happens to carry a com.apple.macl grant, which fails with
#   "last exit code = 78: EX_CONFIG" and no output. All plists therefore log to
#   ~/Library/Logs/polytheta/<label>.{out,err}.log — keep it that way.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_DIR="$REPO_ROOT/scripts/launchd"
LOG_DIR="$HOME/Library/Logs/polytheta"
ALL_LABELS="weekly-basket monday-revalidate alert-bridge schwab-snapshot ib-execution ib-heartbeat"
UID_="$(id -u)"

cmd="${1:-status}"
sel="${2:-}"
labels="${sel:-$ALL_LABELS}"

target() { echo "$HOME/Library/LaunchAgents/com.polytheta.$1.plist"; }

case "$cmd" in
  install|reload)
    mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
    for l in $labels; do
      src="$PLIST_DIR/com.polytheta.$l.plist"; tgt="$(target "$l")"
      if grep -q 'CloudStorage/Dropbox/.*\.log' "$src"; then
        echo "refusing $l: plist logs into the Dropbox folder (see header note)"; exit 1
      fi
      cp "$src" "$tgt"
      launchctl bootout "gui/$UID_" "$tgt" 2>/dev/null || true
      launchctl bootstrap "gui/$UID_" "$tgt"
      launchctl enable "gui/$UID_/com.polytheta.$l"
      echo "installed: $tgt"
    done
    ;;
  uninstall)
    for l in $labels; do
      tgt="$(target "$l")"
      launchctl bootout "gui/$UID_" "$tgt" 2>/dev/null || true
      rm -f "$tgt"
      echo "uninstalled: $tgt"
    done
    ;;
  status)
    for l in $labels; do
      if launchctl print "gui/$UID_/com.polytheta.$l" >/dev/null 2>&1; then
        echo "== $l: loaded"
        launchctl print "gui/$UID_/com.polytheta.$l" | grep -E "state =|last exit" || true
      else
        echo "== $l: not loaded"
      fi
    done
    ;;
  run-now)
    [ -n "$sel" ] || { echo "usage: $0 run-now <label>"; exit 1; }
    launchctl kickstart -k "gui/$UID_/com.polytheta.$sel"
    echo "kicked com.polytheta.$sel (logs: $LOG_DIR/$sel.*.log)"
    ;;
  *)
    echo "usage: $0 {install|reload|uninstall|status} [label] | run-now <label>"; exit 1;;
esac
