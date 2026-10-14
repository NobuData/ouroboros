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

## What it does not show

- **Model quality.** The model is a script, so turns, tokens and wall-clock describe the
  harness's overhead and nothing about how well a real model edits code. The *tokens* come from
  the stub's estimate of request size (bytes ÷ 4), not from a real tokenizer. They show how
  much the harness sends per turn and nothing more precise.
- **A real facade.** DH.2 builds that. The stub only shows that the harness reaches whatever
  `ANTHROPIC_BASE_URL` names, what it sends there, and that it needs nothing else on the
  network for these runs (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`).
