# Execution engine — the restart-resume prototype

This prototype holds the measured half of the orchestration axis of the execution-engine ADR,
[`DECISION_EXECUTION_ENGINE.md`](../../DECISION_EXECUTION_ENGINE.md) § *Axis 1* (T.1,
[#155](https://github.com/NobuData/ouroboros/issues/155)). It asks one question: *can a custom
asyncio interpreter that keeps no durable state survive being killed mid-stage?* That is
option A's riskiest assumption. The kill points include a stage that is a real Claude Agent
SDK harness session, as the DG.1 amendment requires.

| File | What it is |
|---|---|
| `engine.py` | Option A: the interpreter, a native single-shot executor and an Agent SDK harness executor, both `StageExecutor`s (DH.1). The workflow has four nodes: `plan` (native), `implement` (harness), `review` (human gate) and `done`. It serves `POST /submit` and holds nothing durable |
| `journal.py` | Stands in for `ouroboros-rest`'s run plane: claim with an epoch, heartbeat, checkpoint, position, AP.1-ordered events, `409 fenced` writes, and the supervisor that resubmits a stale run. It uses SQLite so the prototype needs no server; the store's durability is not what is tested |
| `driver.py` | Hosts the journal and DH.1's stub facade, which outlive the engine. It starts the engine in its own process group, kills it at each scenario's moment, starts another, approves the gate, and measures |
| `run.sh` | Runs `driver.py` in the engine's environment, with `claude-agent-sdk==0.2.167` overlaid for this run only |
| `results/` | One JSON per scenario, as quoted in the ADR. `k3-after-tool.json` is the run that fell back to a fresh attempt; `k3-after-tool-resumed.json` is one of the 7 that resumed |

## Scenarios

| Scenario | The engine is killed… |
|---|---|
| `baseline` | never |
| `k1-plan-call` | while the native `plan` stage waits on its model call (held 3 s) |
| `k2-between-tools[@ms]` | inside the harness session, as the second model call starts (held 3 s), or `ms` milliseconds later |
| `k3-after-tool` | after a `Write` ran, inside its `PostToolUse` hook, before the result reached the journal |
| `k4-gate-wait` | while the run waits on the human gate |
| `k5-lost-session` | as `k2`, and the run's `CLAUDE_CONFIG_DIR` is deleted before the restart |
| `k6-zombie` | not killed: frozen with `SIGSTOP` past the stale threshold. A second engine takes the run, then the first is thawed |

The supervisor runs with a 0.5 s heartbeat and a 2 s stale threshold, so a run's recovery
takes about 2 s.

## Running it

```bash
# from the repository root; needs uv, and network access once to fetch the wheel
docs/prototypes/execution-engine/run.sh                        # every scenario (~30 s)
docs/prototypes/execution-engine/run.sh k2-between-tools@50    # one scenario, kill 50 ms late
OURO_PROTO_KEEP=1 docs/prototypes/execution-engine/run.sh k3-after-tool   # keep the run's directory
```

`OURO_PROTO_KEEP=1` keeps each run's directory and records its path as `kept` in the result.
The directory holds the journal, the engine logs, the sandbox and the harness's session
files.

## What it does not show

- **Multiple engine replicas sharing load.** `k6` runs two engines, but only to test fencing.
- **The production timings.** The ADR sets a 5 s heartbeat and a 30 s stale threshold. The
  prototype's are shorter so a run takes seconds.
- **A real model.** The model is DH.1's scripted stub. Model calls are held for 3 s only so
  that a kill lands inside one.
