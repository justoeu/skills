#!/usr/bin/env bash
# Stable entrypoint; orchestration uses argv, never eval.
set -euo pipefail
SCAN_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCAN_SCRIPT_DIR/scan.py" "$@"
