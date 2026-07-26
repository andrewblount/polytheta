#!/usr/bin/env bash
# Rebuild both Python venvs after the repo moved to .../polytheta.
#
# The old venvs baked the previous absolute path into ~40 script shebangs and
# into the editable-install .pth files, so they stopped working when the
# directory was renamed. Recreating is cleaner than rewriting those in place.
#
#   bash scripts/rebuild_venvs.sh
#
# Requires python3.11 on PATH (the venvs were originally built against 3.11).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3.11}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: $PYTHON not found on PATH. Set PYTHON=/path/to/python3.11 and re-run." >&2
  exit 1
fi

echo "repo root: $REPO_ROOT"
echo "python:    $($PYTHON --version) at $(command -v "$PYTHON")"
echo

for pkg in tradingview_equity_downloader yahoo_equity_downloader; do
  dir="$REPO_ROOT/python/$pkg"

  if [ ! -f "$dir/pyproject.toml" ]; then
    echo "skip $pkg — no pyproject.toml at $dir" >&2
    continue
  fi

  echo "=== $pkg ==="

  # Drop stale bytecode caches; they hold the old absolute paths too.
  find "$dir/src" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

  rm -rf "$dir/.venv"
  "$PYTHON" -m venv "$dir/.venv"
  "$dir/.venv/bin/python" -m pip install --quiet --upgrade pip
  "$dir/.venv/bin/python" -m pip install --quiet -e "$dir"

  echo "  rebuilt $dir/.venv"
done

echo
echo "=== verifying entry points ==="
"$REPO_ROOT/python/tradingview_equity_downloader/.venv/bin/polytheta-tradingview-downloader" --help >/dev/null \
  && echo "  polytheta-tradingview-downloader OK"
"$REPO_ROOT/python/yahoo_equity_downloader/.venv/bin/polytheta-yahoo-downloader" --help >/dev/null \
  && echo "  polytheta-yahoo-downloader OK"

echo
echo "Done. Next: reload the launchd job so it picks up the new paths:"
echo "  launchctl unload ~/Library/LaunchAgents/com.polytheta.weekly-basket.plist 2>/dev/null"
echo "  cp $REPO_ROOT/scripts/launchd/com.polytheta.weekly-basket.plist ~/Library/LaunchAgents/"
echo "  launchctl load ~/Library/LaunchAgents/com.polytheta.weekly-basket.plist"
