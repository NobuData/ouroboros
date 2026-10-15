#!/usr/bin/env bash
# The DH.2 (#1303) compatibility run — see facade_compat.py. Runs in the engine's environment
# with the harness version this prototype pins overlaid for this run only; the lockfile is not
# touched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
cd "$here"
exec uv run --project "$repo/ouroboros-engine" --with "claude-agent-sdk==0.2.167" \
  python "$here/facade_compat.py" "$@"
