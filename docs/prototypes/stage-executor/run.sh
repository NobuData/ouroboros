#!/usr/bin/env bash
# DH.1 (#1302) prototype — runs every scenario and writes results/<scenario>.json.
# The SDK is overlaid for this run only (`uv run --with`); the engine's lockfile is untouched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
cd "$here"
exec uv run --project "$repo/ouroboros-engine" --with "claude-agent-sdk==0.2.167" \
  python "$here/prototype.py" "$@"
