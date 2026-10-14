#!/usr/bin/env bash
# #155 (T.1) prototype — every scenario, or the ones named, into results/<scenario>.json.
# The Agent SDK is overlaid for this run only (`uv run --with`); the engine's lockfile is untouched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
cd "$here"
exec uv run --project "$repo/ouroboros-engine" --with "claude-agent-sdk==0.2.167" \
  python "$here/driver.py" "$@"
