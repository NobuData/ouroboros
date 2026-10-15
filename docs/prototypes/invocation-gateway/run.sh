#!/usr/bin/env bash
# The AF.1 (#234) streaming benchmark — direct, 4-A and 4-B, under rising concurrency.
#
# Starts the fake provider, both relays and a LiteLLM proxy on loopback, runs load.mjs against
# each path at each concurrency, writes one JSON line per run to results/<scenario>.jsonl,
# and stops everything it started. See README.md for what each path is and how to read the
# figures.
#
# Usage: [LITELLM_WORKERS=4] [SECONDS_PER_RUN=20] ./run.sh [paced|saturation|all]   (default: all)
#        INVOKE_URL=… INVOKE_KEY=… INVOKE_BODY=… [REST_PID=…] ./run.sh real
#
# `real` is AF.2's (#235) regression bar: it starts only the fake provider and measures
# `direct` against the shipped `POST /internal/llm/invoke` (label `rest`), which must already
# be running with an alias bound to an openai_compatible connection at http://127.0.0.1:9100/v1.
# INVOKE_BODY is the request body; REST_PID, when given, is the process whose CPU is read.
#
# LITELLM_WORKERS is passed to the proxy's --num_workers; the relays stay single-process,
# as one `ouroboros-rest` instance is.
#
# Needs node (v24, with the repository's root node_modules installed — express and undici)
# and uv (LiteLLM is fetched by uvx at the pinned version on first run).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RESULTS="$HERE/results"
LITELLM_VERSION="${LITELLM_VERSION:-1.105.1}"
SECONDS_PER_RUN="${SECONDS_PER_RUN:-20}"
LITELLM_WORKERS="${LITELLM_WORKERS:-1}"
SCENARIO="${1:-all}"
PIDS=()

mkdir -p "$RESULTS"
cd "$HERE"

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

tree_pids() {
  # $1 a process; prints it and every descendant, comma-separated
  local all="$1" child
  for child in $(pgrep -P "$1"); do all="$all,$(tree_pids "$child")"; done
  echo "$all"
}

start_upstream() {
  # $1 first-token ms, $2 interval ms, $3 tokens
  FIRST_TOKEN_MS="$1" INTERVAL_MS="$2" TOKENS="$3" node upstream.mjs >/dev/null 2>&1 &
  UPSTREAM_PID=$!
  PIDS+=("$UPSTREAM_PID")
  wait_for http://127.0.0.1:9100/health
}

start_gateways() {
  PORT=9200 TARGET=http://127.0.0.1:9100/v1 node relay.mjs >/dev/null 2>&1 &
  RELAY_A_PID=$!
  PIDS+=("$RELAY_A_PID")

  LITELLM_MASTER_KEY=sk-bench LITELLM_LOCAL_MODEL_COST_MAP=True LITELLM_LOG=ERROR \
    uvx --from "litellm[proxy]==${LITELLM_VERSION}" \
    litellm --config litellm.config.yaml --host 127.0.0.1 --port 9300 \
    --num_workers "$LITELLM_WORKERS" >/dev/null 2>&1 &
  LITELLM_ROOT_PID=$!
  PIDS+=("$LITELLM_ROOT_PID")

  PORT=9201 TARGET=http://127.0.0.1:9300/v1 KEY=sk-bench node relay.mjs >/dev/null 2>&1 &
  RELAY_B_PID=$!
  PIDS+=("$RELAY_B_PID")

  wait_for http://127.0.0.1:9200/health
  wait_for http://127.0.0.1:9201/health
  wait_for http://127.0.0.1:9300/health/liveliness
  # uvx runs LiteLLM as a child process, and each worker is a child of that; LiteLLM's CPU is
  # the whole tree's.
  LITELLM_PID="$(tree_pids "$LITELLM_ROOT_PID")"
}

measure() {
  # $1 scenario, $2 concurrency
  local out="$RESULTS/$1.jsonl"

  node load.mjs --label direct --format sse --concurrency "$2" --seconds "$SECONDS_PER_RUN" \
    --url http://127.0.0.1:9100/v1/chat/completions --pids "$UPSTREAM_PID" >>"$out"
  node load.mjs --label 4-A --format ndjson --concurrency "$2" --seconds "$SECONDS_PER_RUN" \
    --url http://127.0.0.1:9200/internal/llm/invoke --pids "$RELAY_A_PID" >>"$out"
  node load.mjs --label litellm-only --format sse --concurrency "$2" --seconds "$SECONDS_PER_RUN" \
    --url http://127.0.0.1:9300/v1/chat/completions --pids "$LITELLM_PID" >>"$out"
  node load.mjs --label 4-B --format ndjson --concurrency "$2" --seconds "$SECONDS_PER_RUN" \
    --url http://127.0.0.1:9201/internal/llm/invoke --pids "$RELAY_B_PID,$LITELLM_PID" >>"$out"
  tail -n 4 "$out"
}

run_scenario() {
  # $1 name, $2 first-token ms, $3 interval ms, $4 tokens, rest: concurrencies
  local name="$1" first="$2" interval="$3" tokens="$4"
  shift 4

  : >"$RESULTS/$name.jsonl"
  start_upstream "$first" "$interval" "$tokens"
  start_gateways

  for concurrency in "$@"; do measure "$name" "$concurrency"; done

  cleanup
  PIDS=()
}

# Paced: a fast hosted model — 200 ms to first token, then ~100 tokens/s, 256 tokens a call.
# The question is what each gateway adds to latency as concurrent streams rise.
if [[ "$SCENARIO" == "paced" || "$SCENARIO" == "all" ]]; then
  run_scenario "paced-w$LITELLM_WORKERS" 200 10 256 1 10 50 100 250 500
fi

# Saturation: the provider sends 2000 tokens as fast as the socket takes them. The question
# is how many tokens a second each gateway can relay, and what CPU that costs.
if [[ "$SCENARIO" == "saturation" || "$SCENARIO" == "all" ]]; then
  run_scenario "saturation-w$LITELLM_WORKERS" 0 0 2000 1 10 50
fi

# Real: the shipped executor (AF.2, #235) against the same paced provider. The criterion is
# first-token overhead within +50 ms at p50 at 250 paced streams, over `direct`.
if [[ "$SCENARIO" == "real" ]]; then
  : "${INVOKE_URL:?set INVOKE_URL to the running REST /internal/llm/invoke URL}"
  : "${INVOKE_KEY:?set INVOKE_KEY to its OURO_ENGINE_SHARED_SECRET}"
  : "${INVOKE_BODY:?set INVOKE_BODY to the request body}"
  out="$RESULTS/real.jsonl"
  : >"$out"
  start_upstream 200 10 256

  for concurrency in 1 10 50 100 250; do
    node load.mjs --label direct --format sse --concurrency "$concurrency" --seconds "$SECONDS_PER_RUN" \
      --url http://127.0.0.1:9100/v1/chat/completions --pids "$UPSTREAM_PID" >>"$out"
    node load.mjs --label rest --format ndjson --concurrency "$concurrency" --seconds "$SECONDS_PER_RUN" \
      --url "$INVOKE_URL" --key "$INVOKE_KEY" --body "$INVOKE_BODY" --pids "${REST_PID:-}" >>"$out"
    tail -n 2 "$out"
  done
fi
