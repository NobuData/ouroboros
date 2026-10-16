# Stage executor — the Agent SDK harness prototype

This prototype measures the stage-execution axis of the execution-engine ADR,
[`DECISION_EXECUTION_ENGINE.md`](../../DECISION_EXECUTION_ENGINE.md) § *Axis 2* (DH.1,
[#1302](https://github.com/NobuData/ouroboros/issues/1302)). It asks one question: *if the
`implement` stage runs inside the Claude Agent SDK, does the engine's tool policy hold?* In
particular, does a denied write stay unwritten, and what happens when the hook itself fails?

The test runs one `implement` stage on a throwaway sandbox repository. The harness is the
Python `claude-agent-sdk` and the CLI bundled in its wheel. It talks to a **stub facade** on
loopback: a scripted model behind a real Anthropic Messages-format endpoint, standing where
DH.2's facade will stand. No provider is called and no key exists. The `PreToolUse` hook asks
the engine's own `ouroboros_engine.execution.policy.evaluate`, the policy the conformance kit
tests. The prototype then maps what it saw into the DH.1 event vocabulary and checks it with
the kit's `check_stream`.

| File | What it is |
|---|---|
| `stub_facade.py` | `POST /v1/messages`, streamed as the Messages API frames it, replaying a script turn by turn. It logs every request: tools offered, headers, and whether a credential was presented (its value is never logged) |
| `prototype.py` | The harness under L5. It sets `tools` to the five file tools, uses `setting_sources=[]` and an isolated `CLAUDE_CONFIG_DIR`, and runs one hook into the engine's policy. It runs the scenarios below and writes `results/` |
| `run.sh` | Runs `prototype.py` in the engine's environment, with `claude-agent-sdk==0.2.167` overlaid for this run only. The lockfile is not touched |
| `facade_compat.py`, `facade_compat.sh` | DH.2's (#1303) compatibility run: the same pinned SDK through `ouroboros-rest`'s **real** Messages facade, with a canary provider key — see [The facade compatibility run](#the-facade-compatibility-run) |
| `anthropic-redirect.mjs` | A Node preload for that run's recorded mode: it sends REST's calls to `api.anthropic.com` to the stub instead. Test-only |
| `harness_sandbox.py`, `harness_sandbox.sh` | DH.3's (#1308) **manual** real-model check of the shipped executor — see [The real-model sandbox run](#the-real-model-sandbox-run-dh3) |
| `results/` | The figures the ADR quotes, as measured. `<scenario>.json` uses the SDK's default permission mode and `<scenario>.dontAsk.json` uses `permission_mode="dontAsk"` |

## Scenarios

| Scenario | The script | The question |
|---|---|---|
| `halt` | Read README → write `src/greet.py` → write `.github/workflows/ci.yml` → write `src/after.py` | Is the CI write denied (`touch_ci: false`)? Does the hook's `continue: false` stop the session before `after.py`? |
| `deny-continue` | Write `../escape.txt` → `Bash` → write `.git/hooks/pre-commit` → write `src/ok.py` | Deny *without* halting. Do the escapes stay out? Does an unoffered tool reach the hook? |
| `pause-resume` | Read → write (the hook pauses here) → *new client, `resume=<session id>`* → write again | Is the harness's own session resumable, and from what? |
| `resume-elsewhere` | As above, but the resuming client gets an empty `CLAUDE_CONFIG_DIR` | An engine restarted on another container, with no shared volume |
| `hook-timeout` | The hook sleeps past its 1 s timeout on a write the policy would allow | Fail closed? |
| `hook-raises` | The hook raises on that write | Fail closed? |
| `hook-raises-ci` | The hook raises on a CI write the policy would **deny** | Does the policy get bypassed? |

## Running it

```bash
# from the repository root; needs uv and network access the first time (to fetch the wheel)
docs/prototypes/stage-executor/run.sh                              # every scenario, default mode
docs/prototypes/stage-executor/run.sh --permission-mode dontAsk    # every scenario, dontAsk
docs/prototypes/stage-executor/run.sh halt                         # one scenario
```

A scenario takes about 0.4 s. Almost all of that is the CLI's start-up, because the stub
answers immediately. `hook-timeout` takes about 1.4 s. The results in `results/` were
recorded on 2026-10-14 with SDK 0.2.167 and bundled CLI 2.1.300.

## The facade compatibility run

DH.2 ([#1303](https://github.com/NobuData/ouroboros/issues/1303)) builds the real facade. This run
puts the harness version above through it. Re-run it whenever DH.3 moves the pinned SDK.

1. **The stack.** Seed a throwaway database. Start REST with the preload and
   `OURO_TEST_ANTHROPIC_REDIRECT`, so its Anthropic calls reach the stub:

   ```bash
   OURO_TEST_ANTHROPIC_REDIRECT=http://127.0.0.1:9410 \
   NODE_OPTIONS="--import $PWD/docs/prototypes/stage-executor/anthropic-redirect.mjs" \
   OURO_PROVIDER_HEALTH_INTERVAL_SECONDS=3600 TEST=true PORT=4303 node dist/main
   ```

2. **The canary.** Sign in as a seeded owner and add an Anthropic provider whose API key is a
   canary such as `sk-ant-api03-CANARY…` (`POST /api/v1/providers`). The add validates the key
   with `GET /v1/models`, so answer that from 9410 for the moment it takes. Then bind the alias
   to the new connection (`model_aliases.provider_connection_id`).

3. **The run.**

   ```bash
   OURO_ENGINE_SHARED_SECRET=… docs/prototypes/stage-executor/facade_compat.sh \
     --rest http://127.0.0.1:4303 --run <a live run> --alias coder-max --stage implement \
     --canary <the canary key>
   ```

   It mints a credential, then runs a Read → Write → done session through the facade. It
   reconciles the SDK's `modelUsage` against REST's usage rows, revokes the credential and checks
   the revoked one is refused. It also scans every descendant process's environment and
   arguments, plus the harness's stderr, config directory and working tree, for the canary. It
   writes `results/facade-compat.json` and exits non-zero on any failed check.

`--real` drops the stub: start REST without the preload, store a real key, and pass it as
`--canary`. That is a manual check, never CI.

Recorded on 2026-10-14 with SDK 0.2.167: 3 turns and 3 upstream calls, all six checks passed.
The SDK's own totals (7,242 in, 90 out) equal the sum of the three usage rows.

## The real-model sandbox run (DH.3)

DH.3 ([#1308](https://github.com/NobuData/ouroboros/issues/1308)) ships the executor this
prototype measured: `ouroboros-engine/src/ouroboros_engine/execution/executors/claude_agent.py`.
Its automated tests run the real bundled CLI against a copy of `stub_facade.py`
(`ouroboros-engine/tests/harness_stub_facade.py`). `harness_sandbox.sh` is the one check that
uses a **real model**. It is manual, never CI, and it spends tokens.

1. Start `ouroboros-rest` with an Anthropic connection that holds a real provider key, bound to
   the alias you pass (`model_aliases.provider_connection_id`). The key stays in REST's vault.
2. Find a live, non-terminal run to bind the credential to. Minting refuses a finished run.
3. Run it from the repository root, in the engine's environment (the SDK is a pinned engine
   dependency now):

   ```bash
   OURO_ENGINE_SHARED_SECRET=… docs/prototypes/stage-executor/harness_sandbox.sh \
     --rest http://127.0.0.1:4000 --run <a live run> --alias coder-max
   ```

It runs one `implement` attempt on a throwaway sandbox repository, printing every event. It
checks four things: the attempt completed, a file changed, the stream passes DH.1's
`check_stream`, and nothing outside the tree changed. It exits non-zero if any check fails.
REST's side (the usage rows, the stored reconciliation and the revoked credential) is in
REST's database.

## What it does not show

- **Model quality.** The model is a script, so turns, tokens and wall-clock describe the
  harness's overhead and nothing about how well a real model edits code. The *tokens* come from
  the stub's estimate of request size (bytes ÷ 4), not from a real tokenizer. They show how
  much the harness sends per turn and nothing more precise.
- **A real facade.** DH.2 builds that. The stub only shows that the harness reaches whatever
  `ANTHROPIC_BASE_URL` names, what it sends there, and that it needs nothing else on the
  network for these runs (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`).
