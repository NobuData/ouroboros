# Decision — the invocation gateway

> **Issue:** [#234](https://github.com/NobuData/ouroboros/issues/234) — AF.1, *Invocation
> gateway ADR* · **Decided:** 2026-10-14 · **Status:** adopted — **option 4-A, a custom
> executor over the adapter SPI**, in `ouroboros-rest`. LiteLLM is not the gateway.

Everything in the product that calls a model waits on this decision: the LLM estimator
([#123](https://github.com/NobuData/ouroboros/issues/123)), workflow execution
([#160](https://github.com/NobuData/ouroboros/issues/160)), traffic-derived provider health
([#208](https://github.com/NobuData/ouroboros/issues/208)), Research
([#620](https://github.com/NobuData/ouroboros/issues/620)) and the Live Loop's stage harness
(DH.2, [#1303](https://github.com/NobuData/ouroboros/issues/1303)). Routing deliberately did
not decide it (decision **M9**, [`ROADMAP_MOCKUP_06_MODEL_ROUTING.md`](ROADMAP_MOCKUP_06_MODEL_ROUTING.md)).
This document decides it, and records:

- what was compared;
- what was measured on this machine;
- what each candidate would have to be to qualify;
- the three gaps the requirements left open;
- what would reopen the question;
- what AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) therefore builds.

**Inputs:**

- **AB.1** ([#207](https://github.com/NobuData/ouroboros/issues/207)) — routing's requirements
  R1–R10, its non-goals and its gaps. See
  [`INVOCATION_GATEWAY_REQUIREMENTS.md`](INVOCATION_GATEWAY_REQUIREMENTS.md).
- **AD.3** ([#224](https://github.com/NobuData/ouroboros/issues/224)) — the contract workers call,
  `POST /internal/llm/invoke`, defined in
  [`invoke.contract.ts`](../ouroboros-rest/src/modules/internal/invoke.contract.ts).
- **P3**, proxied invocation —
  [`SECURITY_MODEL.md` § 4.2](SECURITY_MODEL.md#42-proxied-invocation).
- The Live Loop's **fourth consumer**, an agent harness that makes its own model calls
  (decisions L3 and L6, [`ROADMAP_OOE_LIVE_LOOP.md`](ROADMAP_OOE_LIVE_LOOP.md), and the DG.1
  amendment).
- DH.4's provider-terms record
  ([#1304](https://github.com/NobuData/ouroboros/issues/1304),
  [`MODEL_PROVIDERS.md` § Provider terms](MODEL_PROVIDERS.md#provider-terms--which-connections-may-serve-invocation)).

## The candidates

**4-A — a custom executor over the adapter SPI.** `ouroboros-rest` walks the resolved chain
and calls each hop's provider through the adapter that already validates and discovers for
it. Invocation becomes the adapter's next method, `invoke()`, which the SPI reserved a flag
for. Our semantics — the floor, votes and per-run caps — are written directly, not mapped.
The cost: we own the streaming, retry and back-off plumbing, once per provider format.

**4-B — self-hosted LiteLLM under our resolution.** `ouroboros-rest` still resolves the
route and walks the chain, but sends each hop's **one concrete model** to a LiteLLM proxy
sidecar. The proxy speaks to the provider. LiteLLM is a Python proxy and `ouroboros-rest` is
TypeScript, so in practice 4-B is the proxy as a second service. Its router, aliases,
fallbacks, cooldowns, budgets and price map all go unused.

**4-C — a hosted gateway (OpenRouter, Portkey and the like) — excluded before evaluation.**
Mockup 07's headline promise is *"Keys never leave the control plane — workers never receive
them at all."* A hosted gateway breaks that promise twice:

- **The keys leave.** A hosted gateway calls the provider on the tenant's behalf, so it must
  hold the provider credential, or a gateway credential that stands in for it. Either way the
  secret now lives in a third party's system. That is outside the vault (AD.1) and outside the
  per-request unwrap that P3 requires (R10).
- **The traffic leaves.** Every prompt and every completion crosses a third party's network
  and logs. A self-hosted deployment chooses this product so that its code and prompts stay
  inside its own boundary. A gateway outside that boundary undoes the choice for the most
  sensitive data the product handles.

This is a contradiction of the product's stated promise, not a matter of degree, so 4-C is out
by construction. A hosted gateway can still appear as an optional **adapter** a workspace
connects deliberately, like any other provider, with the provider-terms record applying to
it. It can never be the path every call takes.

## Every requirement, against both

R1–R10 and the non-goals are AB.1's. The last two rows are P3 and AD.3's contract. "Native"
means #235's own code, tested by its own suite. For 4-B, the cell says what has to be true,
and **what this prototype found** where it tested the point.

| Requirement | 4-A — custom executor | 4-B — LiteLLM under our resolution |
|---|---|---|
| **R1** Execute the chain exactly as resolved | Native: walks `chain` where `decision === "kept"`, in order | REST walks the chain and sends one model per call. LiteLLM's retries, cooldowns and fallbacks must be **off**. The prototype's configuration (`litellm.config.yaml`) shows how — `num_retries: 0`, `disable_cooldowns`, no `fallbacks` — and that configuration becomes a tested artefact of its own |
| **R2** Per-hop error taxonomy | Native: the adapter's five error classes map onto `INVOKE_ERROR_CODES` | Translate LiteLLM's exception classes back into our codes. **Measured:** an upstream `400` came back reclassified as `ContextWindowExceededError`, its body rewritten (see R9). Mapping has to be per exception class and tested per adapter, and an unmapped error arrives as `500` |
| **R3** Floor abort | Native | Holds only while LiteLLM never holds the chain. Its own fallbacks would be a second way to reach a model, and that way does not know the floor |
| **R4** Cap and usage per hop, streamed | Native: usage parsed from the provider's own stream. The cap is checked per token as it arrives (`relay.mjs`) | **Measured:** streamed usage comes back only when the *request* sets `stream_options.include_usage`. `always_include_stream_usage: true` under `litellm_settings` did not add it in 1.105.1. The cost map must be disabled (`LITELLM_LOCAL_MODEL_COST_MAP=True`) and LiteLLM's `response_cost` ignored |
| **R5** Votes (deferrable) | Native: a vote is one more single-model call | Same: one more call. No LiteLLM feature involved |
| **R6** Streaming, always, unbuffered | Native: one SSE parser per provider format. Deltas are relayed as they arrive (measured below) | LiteLLM streams every provider. Its overhead under load is the measured figure below, and it is the deciding one |
| **R7** Local providers first-class | Existing `ollama` and `openai-compatible` adapters, with the same events, usage and telemetry | `ollama_chat/` and `hosted_vllm/` exist. Streamed usage from either is undocumented and was not tested here |
| **R8** Per-hop telemetry | Native: `InvokeHopEvent`, plus `alias` and a timestamp (G7, #235) | Derived from LiteLLM's callbacks. Hop numbering and the connection id stay ours, so REST emits the event either way |
| **R9** Anthropic Messages surface for the harness | DH.2's facade, written in REST: `/internal/harness/anthropic/v1/messages` relaying the provider's SSE unchanged | **Measured:** `/v1/messages` relays `ping` events and forwards `anthropic-version` and `anthropic-beta` unchanged. **The upstream error body is not returned unmodified.** LiteLLM wraps it in its own message, which names the model group and offers fallback advice. The vendor's gateway guide requires the body unmodified, so DH.2 would sit in front of LiteLLM anyway to restore it |
| **R10** Keys never leave the control plane | The key is unwrapped inside one request scope, for one hop, and never written anywhere | The proxy's documented model keeps keys in its config, its environment or its own database. Per-request key injection without a key at rest in the sidecar was not shown. **Measured:** the proxy refuses to start without a master key, which adds a second secret to hold and rotate |
| **Non-goals** — no aliases, routes, rules, floors, prices or health in the executor | Nothing to switch off | Model groups, `model_group_alias`, fallbacks, cooldowns, budgets and the price map exist, and all must stay off. The alias–fallback bug ([litellm#15493](https://github.com/BerriAI/litellm/issues/15493)) was closed *not planned* |
| **P3** proxied invocation — a worker never holds a credential | Holds: the worker calls REST, and REST unwraps the key | Holds only if the sidecar is reachable from REST alone, and its key storage meets R10 |
| **AD.3** contract — NDJSON `delta`/`usage`/`hop`/`error`/`done` | REST writes it directly from the provider stream | REST still parses LiteLLM's stream and writes the same NDJSON. LiteLLM removes none of REST's hot-path work (see `4-B` below) |

What the table says: **4-B can meet every row, but only as a configured subset of LiteLLM,
and it removes no work from REST.** REST still resolves, walks, reframes, counts usage and
checks the cap. What 4-B replaces is the provider-specific streaming client, and it adds a
second hop on every token.

## What was measured

The prototype is in [`prototypes/invocation-gateway/`](prototypes/invocation-gateway/README.md):

- a fake provider that streams at a fixed pace;
- `relay.mjs`, REST's hot path on REST's own Express 5 — it parses SSE, writes NDJSON deltas
  as they arrive, counts tokens against a cap and closes with usage;
- LiteLLM **1.105.1**, configured as 4-B requires;
- a closed-loop load generator.

**4-A** is load → relay → provider. **4-B** is load → relay → LiteLLM → provider, because 4-B
keeps REST's relay. `litellm-only` (load → LiteLLM → provider) isolates LiteLLM's share.

The machine was an AMD Ryzen 7 8745H (8 cores, 16 threads), Linux 7.1, Node 24.21, Python
3.12. Runs lasted 20 seconds per path per concurrency, on 2026-10-14. The raw lines are in
[`results/`](prototypes/invocation-gateway/results/).

### Paced streams — what each gateway adds to latency

Each stream is a fast hosted model: 200 ms to the first token, then 100 tokens a second, with
256 tokens per call. The figures are time-to-first-token (TTFT) overhead over `direct` at the
same concurrency, p50 / p95, in ms.

| Concurrent streams | 4-A | 4-B, 1 LiteLLM worker | 4-B, 4 LiteLLM workers |
|---:|---:|---:|---:|
| 1 | +2 / +7 | +11 / +16 | +12 / +23 |
| 10 | +2 / +1 | +56 / +84 | +32 / +44 |
| 50 | +1 / +10 | +256 / +408 | +79 / +137 |
| 100 | 0 / +13 | +2,180 / +7,218 | +200 / +525 |
| 250 | +1 / +65 | +7,403 / +36,994 | +582 / +6,121 |
| 500 | +28 / +66 | +32,559 / +61,087 | +6,873 / +21,637 |

Aggregate tokens delivered per second:

| Concurrent streams | Offered load | direct | 4-A | 4-B ×1 | 4-B ×4 |
|---:|---:|---:|---:|---:|---:|
| 50 | ≈ 4,400 | 4,317 | 4,432 | 3,044 | 4,071 |
| 100 | ≈ 8,800 | 8,592 | 8,867 | 2,868 | 6,540 |
| 250 | ≈ 22,000 | 21,689 | 21,849 | 2,683 | 8,561 |
| 500 | ≈ 44,000 | 41,065 | 40,529 | 2,620 | 6,661 |

- **4-A** keeps pace with `direct` up to 250 streams. Its first-token overhead stays within
  2 ms at p50 there, and its total call times stay within noise. At 500 streams it reaches the
  edge of its one core:
  - In the one-worker run it adds 28 ms at p50 and delivers 40,529 tokens a second against
    `direct`'s 41,065, at `gatewayCpuPercent` 100.
  - In the four-worker run, where four LiteLLM processes shared the machine, it delivers
    35,038 against 39,702, at 96 %.
- **4-B** falls behind once LiteLLM's workers are saturated:
  - One worker saturates at about 30 streams, about 3,000 tokens a second.
  - Four workers saturate between 50 and 100 streams, about 6,500–8,500 tokens a second, at
    3½–4 cores. Past that point every stream slows, first tokens wait seconds, and at 500
  streams one call failed outright (`provider_unavailable`, one-worker run).

### Saturation — what each gateway can relay at all

Here the provider sends 2,000 tokens as fast as the socket takes them. The figures are tokens
per second, with gateway CPU as a percentage of one core.

| Concurrent streams | direct | 4-A | litellm-only ×1 | litellm-only ×4 | 4-B ×4 |
|---:|---:|---:|---:|---:|---:|
| 1 | 233,942 | 140,052 · 61 % | 3,355 · 99 % | 3,298 · 100 % | 3,260 · 115 % |
| 10 | 471,150 | 295,030 · 96 % | 3,239 · 100 % | 10,372 · 333 % | 8,295 · 310 % |
| 50 | 498,177 | 340,244 · 98 % | 3,479 · 101 % | 10,908 · 394 % | 10,118 · 404 % |

**Per core, the relay moves about 340,000 tokens a second, and LiteLLM about 3,000.** That is
a factor of roughly a hundred, in the component 4-B adds to the path, not one it replaces.

With paced, token-by-token frames, the relay's ceiling is lower: about 40,000 tokens a second
per core, which is about 400 concurrent streams at 100 tokens a second, per `ouroboros-rest`
process. That is the figure AF.2 holds itself to. It is in the graduation triggers below.

### Other facts the prototype established

- **Streamed usage through LiteLLM is opt-in per request.** It is not opt-in per config: the
  config flag above had no effect in 1.105.1.
- **LiteLLM refuses to start without a master key**, unless an explicitly named
  *dangerously permit* flag is set. 4-B adds a secret to provision and rotate.
- **Error bodies are rewritten.** An upstream `400` with body
  `{"type":"error","error":{"type":"invalid_request_error","message":"…prompt is too long"}}`
  came back as a `400` whose `message` wraps the original in LiteLLM's own text. That text
  names the internal model group and suggests `context_window_fallback`. It is a fail for R9 as
  written, and it leaks configuration to the harness.
- **`ping` events and the `anthropic-*` headers pass through** LiteLLM's `/v1/messages`
  unchanged.

## The decision

**4-A.** `ouroboros-rest` executes invocations itself, through `invoke()` on the adapters the
provider-terms record clears. There is no gateway sidecar.

Three reasons, in order of weight:

1. **The measurement.** The issue named streaming throughput under load as the honest
   tiebreaker, and the result is not close:
   - 4-B never removes REST from the hot path, because REST still reframes, meters and caps
     every token.
   - What 4-B adds is a second hop that costs about a hundred times more CPU per token than
     REST's own.
   - At 250 streams one REST process adds 1 ms of first-token latency (4-A). 4-B adds more
     than half a second with four LiteLLM cores, and seven seconds with one.
   - Matching one REST core's paced throughput, about 40,000 tokens a second, would take
     roughly twenty LiteLLM workers.
2. **The requirements.** Every AB.1 row is native in 4-A. In 4-B, most rows depend on a
   LiteLLM default being off and staying off across upgrades. R9 fails as measured (rewritten
   error bodies) and R10 is unshown (keys at rest in the sidecar).
3. **What we already own.** The adapters exist. The SPI reserved `invocation` for exactly this
   step. DH.4 has decided which adapters may have it. The streaming work 4-A costs is one SSE
   parser per provider *format*, not per provider:
   - Anthropic Messages;
   - OpenAI chat completions, which covers `openai-compatible` and vLLM;
   - Ollama's `/api/chat`.

What 4-A gives up, stated plainly: LiteLLM's breadth (100+ providers) and its maintained
per-provider quirks. Each new provider format is ours to write, test and keep working. The
graduation triggers below are written so that this cost is watched, not assumed.

## The three gaps this ADR closes

AB.1 left three gaps for this document — G3, G6 and G8 in
[`INVOCATION_GATEWAY_REQUIREMENTS.md` § Gaps](INVOCATION_GATEWAY_REQUIREMENTS.md#gaps-this-document-found).

| Gap | Decision | Why |
|---|---|---|
| **G3** — does `provider_auth_failed` advance or abort? | **It advances to the next hop.** The hop event is `failed_over` with `provider_auth_failed`, and the same hop is never retried. Health records the connection's failure as it would any other (R8 reports, routing acts) | The next hop is normally a different connection with its own credential. Aborting would let one revoked key stop every route that lists it, even routes with a working fallback, which is the outage a chain exists to absorb |
| **G6** — does unpriced usage (`costCents: null`) count toward a cap? | **No. It passes and is not counted.** Usage is stored with a null cost (never `0`), and a capped run whose usage includes unpriced tokens says so wherever its spend is shown (*unpriced spend not counted toward the cap*) | A cap is a statement in money. Tokens with no price carry no money to count. Refusing them would make every local model unusable under any cap, and counting them at zero would break R4's *null, never 0* rule |
| **G8** — do model-specific `config` refusals still abort? | **Two advance:** *context window exceeded* and *model not found*, each under its own new code (`context_window_exceeded`, `model_not_found`). Every other `config`-class refusal and every other `request_invalid` still aborts | Both are facts about the hop's *model*, not about the request. A later hop with a larger window, or a model that exists, can serve the same request. Any other malformed request fails the same way everywhere, so advancing would only spend money proving it |

#235 adds the two G8 codes to `INVOKE_ERROR_CODES` and changes the `provider_auth_failed` rule
in `invoke.contract.ts` from *does not retry* to *does not retry; advances*.

## Graduation triggers

The conditions under which this decision is reopened. Each is something a person can check,
not a feeling:

1. **Throughput.** One `ouroboros-rest` process's invoke path sustains more than **60 % of the
   measured paced ceiling** — about 24,000 tokens a second, roughly 240 concurrent streams —
   at p95, on production hardware, *and* scaling REST out does not resolve it. Re-measure
   first with this prototype against the shipped executor. The ceiling may have moved either
   way.
2. **Provider count.** The provider-terms record clears a **fourth wire format** that none of
   the three parsers covers, or **more than eight cleared adapter kinds** are in the registry.
   Either means the per-format cost is compounding, and LiteLLM's breadth starts to pay for
   its hop.
3. **Operational burden.** Provider-side streaming changes break `invoke()` **more than twice
   in a quarter**, counted from AF.2's conformance-suite failures attributable to a provider
   change.
4. **The measured facts change.** A LiteLLM release relays error bodies unmodified, shows
   per-request key injection with no key at rest, or relays streamed tokens at a cost per
   token within **10×** of the relay's. Rerun `run.sh` and `check-messages.sh` at that version.

None of these reopens 4-C. A reopening compares 4-A with 4-B again, and could reach a hybrid:
LiteLLM's SDK inside one adapter for a long-tail provider, behind the same `invoke()`. Even
then it would not be the gateway every call takes.

## What AF.2 (#235) builds

This scopes [#235](https://github.com/NobuData/ouroboros/issues/235) before it starts:

- **In `ouroboros-rest`, no sidecar.** `POST /internal/llm/invoke` replaces its `501` with the
  executor. `INVOCATION_GATEWAY_AVAILABLE` turns `true` in that commit.
- **`invoke()` on the cleared adapters only**, per DH.4: `anthropic`, `openai_compatible`
  and `ollama`. `copilot` and `cursor` keep `invocation: false` with their stated reasons, and
  the conformance kit already enforces that. Adding the `InvocationCapableAdapter`
  sub-interface and a `supportsInvocation` guard follows the recipe in `provider.adapter.ts`.
- **Three stream parsers:**
  - Anthropic Messages SSE;
  - OpenAI chat-completions SSE, which serves `openai-compatible` and vLLM;
  - Ollama `/api/chat` NDJSON.

  Each is unit-tested on recorded fixtures, including partial frames split across chunks.
  Streamed usage is requested explicitly from every provider that has it.
- **The executor walk:**
  - R1–R5 as specified in the requirements doc;
  - G3 and G8 as decided above, with the two new codes;
  - G6 as decided above;
  - the floor;
  - the cap, checked before the first call and on every usage event and delta;
  - votes refused with a named reason while deferred (G5).
- **Usage and telemetry:**
  - `token_usage` per hop, with the attribution columns gap G2 names;
  - `last_used_at`;
  - `InvokeHopEvent` with `alias` and a timestamp (G7);
  - the resolution snapshot id carried with every call (G1).
- **The prototype's figures as a regression bar.** AF.2's streaming criterion is met when
  `docs/prototypes/invocation-gateway/run.sh`, pointed at the real endpoint, shows first-token
  overhead within **+50 ms at p50 at 250 paced streams**. 4-A measured +1 ms there, and the
  margin is for real framework and database cost. Record the figures in the PR.
- **DH.2 builds on this, in REST:** the Messages facade relays the provider's SSE byte for
  byte, `ping` included, and returns upstream error bodies unmodified. That is the property
  4-B failed.

**Spend governance.** [`ROADMAP_SPEND_GOVERNANCE.md`](ROADMAP_SPEND_GOVERNANCE.md) asked this
ADR to say how each candidate meets its reserve → call → settle gate (option 2-A, decision
V7), and what becomes of LiteLLM's budgets. With 4-A there is **one** budget system: the
executor's pre-flight calls the gate, the call goes out, and the metered usage settles it,
all in `ouroboros-rest` and PostgreSQL. LiteLLM's budget tables never exist, so option 2-D's
backstop does not apply, and EB.3 keeps the shape it was written in.

## What this decision does not cover

- **Hard cap enforcement beyond blocking** is AF.4
  ([#237](https://github.com/NobuData/ouroboros/issues/237)).
- **The cloud adapters** (OpenAI, Google, Bedrock and the others) are AF.3
  ([#236](https://github.com/NobuData/ouroboros/issues/236)). Each lands with its own
  provider-terms row and, if needed, its own parser. That is the count trigger 2 watches.
- **Vote execution** is deferred to [#371](https://github.com/NobuData/ouroboros/issues/371).
  Until then, AF.2 refuses with a named reason (R5).
- **Orchestration** — custom interpreter, Temporal or Hatchet — is
  [#155](https://github.com/NobuData/ouroboros/issues/155)'s decision, on its own axis
  (decision L2).

## Sources

- AB.1 [#207](https://github.com/NobuData/ouroboros/issues/207) →
  [`INVOCATION_GATEWAY_REQUIREMENTS.md`](INVOCATION_GATEWAY_REQUIREMENTS.md); AD.3
  [#224](https://github.com/NobuData/ouroboros/issues/224) →
  [`invoke.contract.ts`](../ouroboros-rest/src/modules/internal/invoke.contract.ts);
  [`SECURITY_MODEL.md` § 4.2](SECURITY_MODEL.md#42-proxied-invocation);
  [`MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md); mockup 07
  ([`mockups/07-providers.html`](mockups/07-providers.html));
  [`ROADMAP_OOE_LIVE_LOOP.md`](ROADMAP_OOE_LIVE_LOOP.md) decisions L2, L3, L6 and issue DH.2.
- The prototype and its raw results:
  [`prototypes/invocation-gateway/`](prototypes/invocation-gateway/README.md), run 2026-10-14
  against LiteLLM 1.105.1 from PyPI.
- LiteLLM documentation as cited in the requirements document's sources, read 2026-10-14.
