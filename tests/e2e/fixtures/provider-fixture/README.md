# `provider-fixture` — the recorded provider

The e2e suite's stand-in for a model provider at the **HTTP boundary**
([#1314](https://github.com/NobuData/ouroboros/issues/1314), DI.5; infrastructure option 6-A of
[`docs/ROADMAP_OOE_LIVE_LOOP.md`](../../../../docs/ROADMAP_OOE_LIVE_LOOP.md)). It speaks the
Anthropic Messages format and replays one recorded, tool-using exchange — the live slice's
`plan` and `implement` sessions over `acme-robotics/helios-greeter` — so the slice runs from an
issue to a pull request with no model and no key, deterministically, on every run.

It sits **below** `ouroboros-rest`'s Messages facade. The seeded connection
`Anthropic · recorded fixture` (`ouroboros-db/migrations/R__dev_seed_live_slice.sql`, workspace
`acme-live-slice`) names this container as its `base_url`; the facade opens that connection and
relays the harness's request here. Everything above this socket — the stage executor, the
facade, the run-scoped credential, metering, the working tree, the runner, the push, the pull
request — is the product.

## The recording

`recordings/live-slice.json`, format 1. Its provenance is stored beside its turns, as the issue
asks:

| field | what it records |
|---|---|
| `source` | the issue, the repository, the workflow, and how the file was produced |
| `recorded_at` | when |
| `harness.sdk`, `harness.cli` | the Claude Agent SDK and bundled CLI versions the harness's side was captured from |
| `harness.anthropic_version`, `harness.anthropic_beta` | the API version and the sorted beta set that harness sends — the fingerprint the check below compares |
| `harness.tools` | the tools the executor offered |
| `sessions.<name>` | `alias`, `model`, `prompt_prefix`, the `turns`, and `files_after` (a digest of what the session leaves on disk) |

**The model's turns are scripted; the harness's side is captured.** The assistant content in
each turn is the script in `ouroboros-engine/tests/live_slice_recording.py` — one session that
reads the greeter and plans, one that finds the file, makes a deliberately wrong `Edit` (the
failure the harness reports back as `is_error`), then the right one. What is *recorded* is what
the pinned SDK actually sent while that script played: its beta set, the tools it offered, the
tool-result shapes each turn arrives with. The engine test `test_live_slice_recording.py` holds
the committed file to the pinned SDK: when DH.3 moves the pin, that test goes red until the
recording is made again with `OURO_RECORD_LIVE_SLICE=1`.

Every path in the turns is relative to the working tree — the harness's `Glob` answers
`bin/greet`, and its `Read` and `Edit` take that back — so the recording does not depend on
where the engine puts a run's tree, and the replay answers it verbatim.

## How a request is answered (`replay.mjs`)

1. The key must begin with the accepted prefix, else `401 authentication_error`.
2. A request that does not offer the `Write` tool is the harness's side traffic and gets the
   recording's one-word answer.
3. The session is the one whose `model` (the hop's id, which the facade writes into
   `body.model`) or `alias` matches; failing that, the one whose `prompt_prefix` opens the first
   user text.
4. **The harness check.** The request's `anthropic-beta` set must equal the recording's. A
   different set is answered `400` with a message that names the recorded SDK and CLI and the
   betas missing and extra, and is logged with `mismatch: "harness"`. This is deliberate and
   loud: a recording made with a different harness is *reported as such*, in the first line a
   person reads, instead of failing somewhere deep in a session.
5. The turn is the number of `tool_use` blocks in the assistant history — content, never
   message counts, because a resumed session replays its history one block per message.
6. The turn's expected tool results (ids and `is_error`) must be what the request carries;
   otherwise `400` naming the turn, expected and observed, and the harness version
   (`mismatch: "turn"`). The deliberate failure-then-correction is such an expectation.
7. The answer — the recorded blocks, verbatim — is streamed as the Messages API frames it (`message_start`, `ping`,
   `content_block_*`, `message_delta`, `message_stop`) or returned as one `message` document.

## Routes

```
GET  /healthz                        compose's probe
GET  …/v1/models                     the recording's models — what a key check reads
POST …/v1/messages                   the session
POST …/v1/messages/count_tokens      a rough count
GET  /__fixture/recording            provenance and session shapes, without the turns
GET  /__fixture/requests             every request answered since the last reset
POST /__fixture/reset                forget them
```

The provider routes match by suffix: the facade relays `/internal/harness/anthropic/v1/…`, and
the engine's recording test points the harness at this socket directly.

## Environment

| variable | default | why |
|---|---|---|
| `PROVIDER_FIXTURE_RECORDING` | `./recordings/live-slice.json` (relative to `server.mjs`) | another recording |
| `PROVIDER_FIXTURE_PORT` | `8080` | a host where 8080 is taken; the engine test picks a free port |
| `PROVIDER_FIXTURE_KEY_PREFIX` | `ouro-e2e-` | behind the facade the key is the one the leg stores on the connection; the engine test drives the harness here with no facade, so the run-scoped credential `ouro_hrn_…` arrives unswapped and the test sets this to `ouro_hrn_` |

The process stops at start, naming the path, when the recording is missing or malformed —
a fixture that started without one would answer `400` to every session and look like a harness
problem.

## Re-recording

```bash
cd ouroboros-engine
OURO_RECORD_LIVE_SLICE=1 uv run pytest tests/test_live_slice_recording.py
```

Needs the bundled CLI (`uv sync`). Commit the new `recordings/live-slice.json` with the SDK
bump that made it necessary.
