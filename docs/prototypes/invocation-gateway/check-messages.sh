#!/usr/bin/env bash
# R9's pass-through questions, asked of LiteLLM's Anthropic `/v1/messages` endpoint.
#
# INVOCATION_GATEWAY_REQUIREMENTS.md § R9 says a Messages-format surface must relay `ping`
# events, forward `anthropic-version` and `anthropic-beta` unchanged, and return upstream error
# bodies unmodified. For 4-B those had to be verified rather than assumed. This script asks
# each question of LiteLLM, with the fake provider on the other side, and prints a verdict per
# question to results/messages-check.txt.
#
# Usage: ./check-messages.sh   (ports 9110 and 9310, so it can run beside nothing else)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LITELLM_VERSION="${LITELLM_VERSION:-1.105.1}"
OUT="$HERE/results/messages-check.txt"
PIDS=()

cd "$HERE"
mkdir -p results

cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 120); do
    curl -sf "$1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "timed out waiting for $1" >&2
  return 1
}

PORT=9110 INTERVAL_MS=20 node upstream.mjs >/dev/null 2>&1 &
PIDS+=("$!")
LITELLM_MASTER_KEY=sk-bench LITELLM_LOCAL_MODEL_COST_MAP=True LITELLM_LOG=ERROR \
  uvx --from "litellm[proxy]==${LITELLM_VERSION}" \
  litellm --config litellm.messages.yaml --host 127.0.0.1 --port 9310 >/dev/null 2>&1 &
PIDS+=("$!")

wait_for http://127.0.0.1:9110/health
wait_for http://127.0.0.1:9310/health/liveliness

ask() {
  # $1 model; prints the raw response, status last
  curl -sN -w '\nHTTP %{http_code}\n' http://127.0.0.1:9310/v1/messages \
    -H 'content-type: application/json' \
    -H 'x-api-key: sk-bench' \
    -H 'anthropic-version: 2023-06-01' \
    -H 'anthropic-beta: bench-beta-2026-10-14' \
    -d "{\"model\":\"$1\",\"max_tokens\":5,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
}

streamed="$(ask claude-bench)"
headers="$(curl -s http://127.0.0.1:9110/last-headers)"
refused="$(ask claude-refuse)"
canary="upstream-refusal-canary: prompt is too long"

{
  echo "LiteLLM ${LITELLM_VERSION} — /v1/messages pass-through, $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "Upstream sent 2 ping events. Relayed: $(grep -c '^event: ping' <<<"$streamed" || true)"
  echo "message_delta usage relayed: $(grep -c '"output_tokens": *5' <<<"$streamed" || true) frame(s)"
  echo "anthropic-version at upstream: $(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("anthropic-version","(absent)"))' "$headers")"
  echo "anthropic-beta at upstream:    $(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("anthropic-beta","(absent)"))' "$headers")"
  echo "Refusal status relayed:        $(tail -n 1 <<<"$refused")"
  if grep -qF "$canary" <<<"$refused"; then
    if grep -qxF "$(python3 -c 'import json; print(json.dumps({"type":"error","error":{"type":"invalid_request_error","message":"upstream-refusal-canary: prompt is too long"}}, separators=(",",":")))')" <<<"$refused"; then
      echo "Refusal body:                  unmodified"
    else
      echo "Refusal body:                  message kept, envelope rewritten"
    fi
  else
    echo "Refusal body:                  upstream message lost"
  fi
  echo
  echo "--- streamed response ---"
  echo "$streamed"
  echo
  echo "--- refused response ---"
  echo "$refused"
} >"$OUT"

cat "$OUT"
