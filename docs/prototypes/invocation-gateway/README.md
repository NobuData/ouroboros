# Invocation gateway — the streaming prototype

The measured half of the invocation gateway ADR,
[`DECISION_INVOCATION_GATEWAY.md`](../../DECISION_INVOCATION_GATEWAY.md) (AF.1,
[#234](https://github.com/NobuData/ouroboros/issues/234)). The ADR's decision rests on what
these files measured. It does not rest on estimates.

The question the prototype answers is *what does each candidate add to a streamed model call,
and where does it stop keeping up?* Both candidates put `ouroboros-rest` on the token hot path,
so that is the path it measures.

## The four paths

Every path streams from the same fake provider, so any difference between their timings comes
from the gateway.

| Label | Path | What it stands for |
|---|---|---|
| `direct` | load → provider | The floor: no gateway at all |
| `4-A` | load → **relay** → provider | A custom executor over the adapter SPI: REST calls the provider itself |
| `litellm-only` | load → **LiteLLM** → provider | LiteLLM's own cost, without REST in front |
| `4-B` | load → **relay** → **LiteLLM** → provider | LiteLLM under our resolution: REST still walks the chain, reframes the stream and counts usage, and calls LiteLLM instead of the provider |

| File | What it is |
|---|---|
| `upstream.mjs` | The fake provider: an OpenAI-compatible `POST /v1/chat/completions` that streams a fixed number of tokens at a fixed pace, with streamed `usage` when asked |
| `relay.mjs` | REST's hot path, reduced: Express 5 (REST's own HTTP stack). It parses every SSE frame, re-emits it as `invoke.contract.ts`'s NDJSON `delta` events as they arrive, counts tokens against a cap, and closes with `usage`, `hop` and `done` |
| `litellm.config.yaml` | LiteLLM 1.105.1 configured as 4-B requires: one concrete model, no retries, no cooldowns, no fallbacks, no budgets, no database, no outbound price-map fetch |
| `load.mjs` | The load generator: closed loop, N concurrent streams for S seconds. It records time to first token (TTFT) and total time per call, aggregate tokens per second, and gateway CPU from `/proc` |
| `run.sh` | Starts everything, runs each path at each concurrency, writes `results/<scenario>.jsonl`, and stops everything |
| `results/` | The figures the ADR quotes, as measured |

## Running it

```bash
# from the repository root, after `yarn install` (express and undici come from node_modules)
cd docs/prototypes/invocation-gateway
./run.sh                       # paced and saturation, one LiteLLM worker (about 20 minutes)
LITELLM_WORKERS=4 ./run.sh     # the same with four LiteLLM workers
SECONDS_PER_RUN=5 ./run.sh saturation   # a quick look
```

You need Node 24 and `uv`. The first run downloads LiteLLM through `uvx` at the pinned
version. Everything binds to loopback: ports 9100 (provider), 9200 (4-A relay),
9201 (4-B relay) and 9300 (LiteLLM).

## The two scenarios

- **Paced** is a fast hosted model: 200 ms to the first token, then a token every 10 ms,
  256 tokens per call. Concurrency runs 1, 10, 50, 100, 250 and 500 streams. It asks how much
  latency each gateway adds as concurrent streams rise.
- **Saturation** has the provider send 2,000 tokens as fast as the socket accepts them.
  Concurrency runs 1, 10 and 50. It asks how many tokens a second each gateway can relay at
  all, and at what CPU cost.

## Reading the figures

Each line of `results/*.jsonl` is one run of one path at one concurrency:

- **`ttftP50`, `ttftP95`, `ttftP99`**: time to first token in ms, measured at the client. The
  provider's own 200 ms is inside the figure, so a gateway's overhead is its figure minus
  `direct`'s at the same concurrency.
- **`totalP50`, `totalP95`**: the whole call, in ms.
- **`tokensPerSecond`**: tokens delivered across all streams, divided by wall time.
- **`gatewayCpuPercent`**: CPU the gateway processes used, as a percentage of one core. For
  `direct` this is the fake provider's own CPU. For `4-B` it is the relay plus every LiteLLM
  process.
- **`calls`**, **`errors`**, **`firstError`**: how many streams completed, and the first
  failure if any.

## What it does not measure

- **A real provider.** Network distance to a vendor adds the same to every path, and the fake
  provider removes it so the gateway's share is visible.
- **NestJS's own routing.** It is a fixed cost per request, not per token. `relay.mjs` runs on
  the same Express that NestJS uses underneath.
- **More than one REST process.** One relay process stands for one `ouroboros-rest` instance.
  REST scales out behind a load balancer, as it already does.
- **A separate load machine.** The load generator shares the machine (16 threads), so the
  highest-concurrency figures include some contention on every path alike.
