#!/usr/bin/env bash
# DH.3 (#1308) manual check — the shipped Claude Agent executor against a real model, through
# a running ouroboros-rest facade. See harness_sandbox.py. Manual, never CI: it spends tokens.
# Runs in the engine's own environment (the SDK is a pinned engine dependency since DH.3).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
exec uv run --project "$repo/ouroboros-engine" python "$here/harness_sandbox.py" "$@"
