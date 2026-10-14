# Decision — the execution engine

> **Issue:** [#155](https://github.com/NobuData/ouroboros/issues/155) — T.1, *Execution engine
> ADR*, with its second axis from DH.1
> ([#1302](https://github.com/NobuData/ouroboros/issues/1302)).
>
> **Axis 1, orchestration:** decided 2026-10-14 and **adopted**: **option A, a custom asyncio
> interpreter** in `ouroboros-engine`, holding no durable state of its own. Every durable fact
> lives in `ouroboros-rest`, and a supervisor there resubmits a run whose heartbeat stops.
> Temporal (B) and the Hatchet class (C) are not adopted. The graduation triggers below say
> when that is reopened.
>
> **Axis 2, stage execution:** decided 2026-10-14 and **adopted**. Every model stage runs
> through the `StageExecutor` SPI. In the MVP, single-shot stages are `native` and the
> tool-using `implement` stage runs a **Claude Agent SDK harness** (DH.3). The native tool
> loop (DH.5) is v2 and the named fallback.

#155 was filed as a choice between a custom interpreter, Temporal and Hatchet-class platforms.
All three answer *how does a workflow survive a restart*. None of them answers *what runs
inside the `implement` stage*. Decision **L2**
([`ROADMAP_OOE_LIVE_LOOP.md`](ROADMAP_OOE_LIVE_LOOP.md)) splits the engine decision into two
axes, decided separately, in this one document:

| Axis | Question | Decided by | Status |
|---|---|---|---|
| 1 — Orchestration | How a workflow's stages are sequenced, persisted and resumed after a restart | #155 | **Adopted** |
| 2 — Stage execution | What runs the agent loop inside one stage, and where the tool boundary sits | DH.1 | **Adopted** |

The two axes are independent with one exception: a harness keeps its own session state, so
axis 1's restart-resume prototype includes a harness stage (§ *Axis 1*, scenarios `k2`–`k6`).

---

## Axis 1 — orchestration

**Inputs:**

- #155 as filed. The decision is evaluated against our real constraints:
  - a Python engine;
  - Postgres-only infrastructure;
  - long-running LLM stages;
  - crash recovery;
  - human-gate pauses that may last days.
- The DG.1 amendment: the restart-resume prototype must include a stage that is a harness
  session.
- [`ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md`](ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md),
  infrastructure option 3.
- [`ARCHITECTURE.md` § 2](ARCHITECTURE.md): **the engine never talks to the database.**
- The precedent already in production: research investigations. `ouroboros-rest` holds the
  lifecycle row and the checkpoint. A dead engine's investigation is submitted again, and the
  next engine resumes it from the checkpoint (`investigation/runner.py`).

### The candidates

| | What it is | Where durable state lives |
|---|---|---|
| **A — Custom asyncio interpreter** | The engine interprets the pinned workflow document over #54's task skeleton. Every transition, event and checkpoint is written to `ouroboros-rest`. `ouroboros-rest` resubmits a run whose heartbeat stops | `ouroboros-rest`'s Postgres, the database every other row lives in |
| **B — Temporal** | Durable execution with deterministic replay. Workflow code runs in the Python SDK's sandbox, and stages are activities | A Temporal Server cluster with its own persistence and visibility stores |
| **C — The Hatchet / Inngest / Restate class** | Lighter durable-execution and queueing platforms, each with its own server | Hatchet: Postgres. Inngest: SQLite by default, Postgres optional. Restate: its own replicated log and RocksDB |

### Every constraint, against all three

| Constraint | A — custom interpreter | B — Temporal | C — Hatchet class |
|---|---|---|---|
| **Python engine** | Native | The Python SDK runs workflow code in a sandbox. Code must avoid what it restricts, and a non-deterministic call fails the worker task until the code is fixed `[verified]`. Every interpreter step would be held to replay determinism | Hatchet has a Python SDK `[search-level]`. Inngest's self-hosting page shows Node.js and Go examples only `[verified]`, so its Python SDK is `[unverified]`. Restate's Python SDK is `[unverified]` |
| **Postgres-only infrastructure** | No new store. **Measured:** the prototype's journal is everything A needs (§ *What was measured*) | A Temporal Server (two Go binaries: the server and the UI `[verified]`). PostgreSQL 12+ is supported for visibility `[verified]`, but Elasticsearch or OpenSearch is "recommended for any setup that spawns more than a few Workflow Executions" `[verified]` | Hatchet: PostgreSQL for state, RabbitMQ optional, and a single-image *Lite* for "low-throughput production" `[verified]`. Inngest: a single binary, with SQLite that "does not support scaling beyond a single node" and Postgres optional `[verified]`. Restate: an embedded replicated log, not Postgres `[search-level]` |
| **The module contract** (§ 2) | Unchanged. The engine talks to `ouroboros-rest` only | A new service the engine must reach, holding a second copy of run state beside AP.1's read-model. Two sources of truth for *where is this run* | Same as B |
| **Long-running LLM stages** | One worker task per stage, with a heartbeat. **Measured:** model calls held for 3 s each, killed mid-call, recovered | Activities with heartbeats, built for this | Built for this |
| **Crash recovery** | Ours to build. **Measured** below, failure modes included | Durable and replayed. Replay does not cover a harness's own session: a harness stage is one activity, and its session state is the activity's problem, exactly as under A | As B, in each platform's model |
| **Human gates that last days** | The run parks as a row and the engine holds nothing. **Measured:** a kill during the wait cost nothing | Signals and durable timers. A parked workflow costs history, not a thread | Durable waits or events |
| **Operational footprint** | None new | A cluster to run, upgrade and back up, with a database and preferably a search store | One server and its store, smaller than B |

### What was measured

The prototype is [`prototypes/execution-engine/`](prototypes/execution-engine/README.md). It
ran on 2026-10-14. It builds option A with three parts:

- **The interpreter** (`engine.py`) runs the slice's four nodes:
  1. `plan`: native single-shot;
  2. `implement`: a real Claude Agent SDK session, against DH.1's stub facade;
  3. `review`: a human gate;
  4. `done`.

  Both executors go through the `StageExecutor` SPI.
- **A journal** (`journal.py`) stands in for `ouroboros-rest`. It provides claim-with-epoch,
  heartbeat, checkpoint, position and AP.1-ordered events, plus a supervisor that resubmits a
  stale run. The heartbeat is 0.5 s and the stale threshold 2 s.
- **A driver** (`driver.py`) `SIGKILL`s the engine's whole process group at each point below,
  harness CLI included, and starts a new engine.

| Scenario | Kill point | Completed | Recovery: kill → resubmitted / first new event | Repeated work | Raw result |
|---|---|:-:|---:|---|---|
| `baseline` | — | ✅ | — | — (1 plan call, 4 implement calls, 3 tools) | 570 ms end to end |
| `k1-plan-call` | During the native stage's model call | ✅ | 2.20 s / 2.23 s | **1 model call** (the plan is re-run) | Nothing journaled by the dead engine. The new one wrote all 17 events |
| `k2-between-tools` | In the harness session, as the second model call starts | ✅ | 1.86 s / 2.11 s | 1 model call | Resumed by session id. The transcript continued at the next hint |
| `k2-between-tools@50` / `@250` | As k2, 50 / 250 ms later | ✅ | 1.83 / 2.13 s → 2.09 / 2.44 s | 1 model call | Resumed |
| `k3-after-tool` | After a `Write` ran, before its result reached the journal | ✅ | 1.85–1.87 s / 2.11–2.32 s | **7 of 8 runs:** none. **1 of 8:** a fresh attempt that ran the `Write` **again** | See *What did not work* |
| `k4-gate-wait` | While the run waits on the human gate | ✅ | — | None. The engine held nothing to lose | Approved after the restart; 539 ms from approval to resubmission |
| `k5-lost-session` | As k2, with the run's `CLAUDE_CONFIG_DIR` deleted | ✅ | 1.84 s / 2.31 s | The whole stage: attempt 2, with Read re-run and 2 model calls repeated | The resume failed, and the interpreter fell back to a new attempt |
| `k6-zombie` | The engine frozen (`SIGSTOP`) past the threshold, a second engine takes over, then the first is thawed | ✅ | 1.89 s / 2.33 s | As k5 (the session was not yet persisted) | The thawed engine's 3 writes were refused `fenced`. It ran **no** tool after it woke |

**Recovery is the stale threshold plus about 0.3 s.** It took 1.8–2.2 s against a 2 s
threshold with a 0.5 s heartbeat. Engine start-up is about 0.5 s and overlaps the wait. With a
production threshold the bound moves with it (see *The decision*).

#### What did not work

1. **The harness persists its session lazily.** `k2` killed as the next model call started
   resumed in only **2 of 5 runs**. The other 3 found no session on disk (*"No conversation
   found"*) and fell back to a fresh attempt. Killed 50 ms or more later, it resumed in **16 of
   16 runs**, at delays of 50, 100, 150, 250, 500, 1 000, 2 000 and 2 800 ms. `k6` froze the
   engine at the same moment and fell back both times it ran. So there is a window of tens of
   milliseconds after a step in which a crash loses the whole session.
2. **A fresh attempt repeats side effects.** In 1 of 8 `k3` runs the fallback ran the
   `Write` a second time. Under L5 that is harmless, because every file tool overwrites to the
   same content (or an `Edit` finds nothing to replace). A tool with an outside effect would
   not be harmless. It must be idempotency-keyed at the control plane before it may join a
   stage's allow-list. `push_fixup` is the first such tool.
3. **The transcript can lose a result the working tree kept.** In the 7 `k3` runs that resumed,
   the `Write` was not re-run, which is correct. But its `tool_result` and `file_change` died
   with the engine, so the journal holds a request that was never answered and a change-set
   one file short. **The change-set must come from the working tree's diff at stage end**, not
   from events.
4. **Fencing protected the journal, and only the journal.** In `k6` the zombie's writes were
   refused, and its next tool call was refused at the hook because the refused heartbeat made
   it abort. That ordering held in both runs, but it is a race between the heartbeat and the
   harness's next tool call, not a guarantee. A thawed harness can still touch the working
   tree until its hook refuses. The guarantee needs the working tree itself fenced (DI.1: one
   tree per run *attempt*, or a lock file the hook checks).
5. **A native single-shot stage is not resumable.** `k1` paid for the plan call twice. That is
   the design (`resume: false`), and it is cheap for one call.
6. Prototype defects that were found and fixed: a non-reentrant journal lock deadlocked the
   driver. The DH.1 stub needed a configurable delay so a kill could land inside a model call.

None of these argues for B or C. Items 1 to 4 are about the harness's own session and the
working tree, and Temporal would inherit them: a harness stage would be one activity whose
session is just as local and just as lazily written.

### The decision

**A.** The engine interprets the workflow itself and keeps nothing it cannot lose:

1. **Durable state lives in `ouroboros-rest`**, alongside AP.1's run plane. That covers the
   run's position and status, each stage's attempt and checkpoint, the transcript and the
   gate decisions. The engine still never talks to the database.
2. **Claim with an epoch and fence every write.** A claim increments the run's epoch, and
   every engine write carries it. A stale epoch is refused `409 fenced`, and the engine
   aborts its executor when its heartbeat is refused.
3. **`ouroboros-rest` supervises.** A run that is `queued`, or `running` with a heartbeat older
   than the stale threshold, is submitted to the engine again. The defaults are a **5 s
   heartbeat and a 30 s stale threshold**, so recovery is about 30 s: long against the
   measured 0.3 s of overhead, and short against any model call.
4. **Gates park.** A run waiting on a person is a row. The engine holds no task, thread or
   connection for it, and resumes when the decision resubmits the run.
5. **Recovery per executor kind:**
   - A native single-shot stage is re-run.
   - A harness stage is resumed from its checkpoint, which is the session id, saved as soon as
     the session reports it and after every tool result. Its `CLAUDE_CONFIG_DIR` is per run
     and on a volume the restarted engine mounts.
   - A resume that fails starts a fresh attempt, once.
6. **The change-set is the working tree's diff**, reported at stage end.
7. **Only overwrite-idempotent tools until there is a control-plane idempotency key.** Any
   tool with an outside effect waits for one.

Three reasons, in order of weight:

1. **The measurement.** Every scenario completed. The failure modes found are the harness's
   and the working tree's, which no orchestrator removes.
2. **The constraints.** A adds no store, no service and no second copy of run state. B adds a
   cluster and, past a few executions, a search store. C adds a server. Under B or C, AP.1's
   read-model and the orchestrator's history would both claim to know where a run is.
3. **The precedent.** Research investigations already run this way in production. The
   interpreter is the same pattern with more nodes.

What A gives up, stated plainly:

- deterministic replay;
- durable timers;
- an orchestrator's history UI;
- years of hardening.

Recovery, fencing and supervision are ours to get right and keep right. The graduation
triggers below watch that cost.

### Graduation triggers

The conditions that reopen axis 1. Each is a count somebody can take:

1. **Recovery incidents.** **3 or more in a calendar quarter** in which an engine restart lost
   or duplicated something a person saw:
   - a duplicated commit, push or comment;
   - a stage restarted after more than 10 minutes of model work;
   - a run that stalled until a person intervened.
2. **Resume fallbacks.** More than **5 %** of interrupted harness stages in a month fall back
   to a fresh attempt, counted over at least 40 interruptions. The prototype's window says
   this should be rare. If it is not, the session store needs more than a volume.
3. **Volume.** More than **50 concurrently active runs per engine replica**, or supervisor
   resubmission later than **2× the stale threshold at p95**. Either means work distribution
   across replicas has to be built, and that is what a durable-execution platform sells.
4. **Workflow features.** The workflow DSL gains a node that waits on **time** (a schedule, a
   timeout longer than a stage, a backoff across days) or on a **child workflow**. Durable
   timers and sub-workflows are where hand-built interpreters grow slowly into Temporal.

A reopening compares A with **C first** (Hatchet, whose state lives in Postgres), then B. The
SPI (axis 2) is unchanged by either: a stage stays one `StageExecutor` call, whichever
orchestrator calls it.

---

## Axis 2 — stage execution

**Inputs:**

- [`ROADMAP_OOE_LIVE_LOOP.md`](ROADMAP_OOE_LIVE_LOOP.md):
  - *Infrastructure Options* 1 (stage execution), 2 (key custody), 3 (provider terms) and 5
    (where a tool-using stage runs);
  - decisions L2–L6;
  - issue DH.1.
- The SPI precedents: [`TICKET_SOURCES.md`](TICKET_SOURCES.md),
  [`MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md) and [`RESEARCH_TOOLS.md`](RESEARCH_TOOLS.md).
- The invocation gateway decision, [`DECISION_INVOCATION_GATEWAY.md`](DECISION_INVOCATION_GATEWAY.md)
  (#234, 4-A). Every model call the engine makes goes through `ouroboros-rest`'s executor,
  and so does a harness's, through the DH.2 facade.
- [`SECURITY_MODEL.md` § 4](SECURITY_MODEL.md): a worker never holds a cloud provider
  credential.

### The interface this axis decides around

[`STAGE_EXECUTORS.md`](STAGE_EXECUTORS.md) specifies it. In outline:

- `kind`, `capabilities()` (`tools`, `resume`, `steer`, `provider_neutral`),
  `run(stage_ctx) → events`, `pause()`, `abort()` and `resume(checkpoint)`;
- **one event vocabulary** (model turn, tool request, tool result, file change, usage),
  mapped onto AP.1;
- **one tool policy**, evaluated before every tool runs, the same for every executor kind.

The SPI is what makes the choice below reversible. #160 calls the interface and never a
model or a harness directly.

### The candidates

| | What it is |
|---|---|
| **Native single-shot** | One model call through the chain executor (#235): a prompt in, text out, no tools. Plan, summarise, classify |
| **Native tool loop** (DH.5) | The engine owns the loop. It uses native tool use over #235 and the tool boundary of #560, promoted from a virtual workspace to a real working tree |
| **Agent SDK harness** (DH.3) | The `implement` stage runs a Claude Agent SDK session: the Python `claude-agent-sdk` and the CLI it bundles. The engine sits at its `PreToolUse` hook and reaches models through the DH.2 facade |
| **CLI harness** (DH.6) | A generic subprocess adapter for vendor command-line agents (`codex exec`, `cursor-agent -p`, `claude -p`), each with its own JSON event stream |

Two more were considered and not pursued:

- **OpenHands Software Agent SDK** (roadmap option D). It is a second agent framework with its
  own model layer, which would duplicate routing.
- **Deciding nothing and hard-wiring a model call into #160** (option E). Rejected: it makes
  this decision by accident.

### Every criterion, against all four

The cells marked **measured** come from the prototype below. The roadmap's `[verified]`,
`[search-level]` and `[unverified]` markings are kept for everything the prototype did not
re-test.

| Criterion | Native single-shot | Native tool loop | Agent SDK harness | CLI harness |
|---|---|---|---|---|
| **Provider neutrality** | Any provider #235 routes to | Any provider whose format has native tool use | **Claude models only**: Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway" `[verified]` | One vendor per CLI. Several vendors means several adapters |
| **Key custody** (§ 4) | The key stays in `ouroboros-rest` (P3, #234) | Same | Through the DH.2 facade with a run-scoped credential. **Measured:** the harness sent every request to `ANTHROPIC_BASE_URL`, presented the credential it was given, and made no other request with non-essential traffic disabled | Each CLI reads its own key variable (`CODEX_API_KEY`, `CURSOR_API_KEY`) `[search-level]`. Whether each accepts a base-URL override is `[unverified]`. Without one, the key sits in the worker and § 4 breaks |
| **Enforcement seat** | None needed: no tools | The engine's own loop, between tool calls. The seat is ours by construction | The `PreToolUse` hook. **Measured:** a denied write did not land, and a timed-out hook did not run its tool. A hook that **raised** let the tool run under the default permission mode, and **did not** under `dontAsk` | No common deny hook. Every CLI has its own permission model, and no seat is demonstrated |
| **Resume** | Nothing to resume: re-run the call | Engine-owned message history in the checkpoint, stored wherever axis 1 stores state | **Measured:** works by session id against the same config directory, and fails against an empty one. Session state is local disk (§ *Axis 1*, `k5-lost-session`) | Per CLI, `[unverified]` |
| **Operational footprint** | None new | None new: Python only | **Measured:** the wheel bundles a 255 MB CLI binary (2.1.300) and needs Python ≥ 3.10 (the engine runs 3.12). Each attempt is a subprocess, with about 0.25 s of start-up per session | One binary and runtime per vendor |
| **Terms** | DH.4's per-adapter record | Same | Commercial Terms. API-key or cloud credentials only. Two open questions for Anthropic (decision **L4**). "Claude Code" may not be a product name `[verified]` | A primary-source terms record per vendor before invocation (DH.4's rule). Kiro is excluded outright `[verified]` |

### What was measured

The prototype is [`prototypes/stage-executor/`](prototypes/stage-executor/README.md). It ran
on 2026-10-14 with `claude-agent-sdk` 0.2.167 and bundled CLI 2.1.300, on Python 3.12. Each
run is one `implement` stage on a throwaway sandbox repository, set up as follows:

- The harness ran with L5's file tools only (`Read`, `Write`, `Edit`, `Glob`, `Grep`),
  `setting_sources=[]` and an isolated `CLAUDE_CONFIG_DIR`.
- The harness pointed at a stub Messages-format facade that replays a scripted model.
- A `PreToolUse` hook asked the engine's own `evaluate()`.
- The policy was `touch_ci: false`, `push_fixup: false` and `boot/**` protected.

Every scenario ran twice: under the SDK's default permission mode, and under `dontAsk`. The
raw results are in `results/`.

| Scenario | Turns | Wall clock | Requests to the facade | Input / output tokens¹ | What landed on disk | Result |
|---|---:|---:|---:|---:|---|---|
| `halt` — read, write, **CI write**, write | 4 | 429 ms | 3 | 8 577 / 141 | `src/greet.py` only | The CI write was denied (`stage_permission`). The hook's `continue: false` ended the session before the next write. The conformance kit found no violation |
| `halt` × 5 repeats | 4 | 379–432 ms (median 396) | 3 | 8 577 / 141 | Same every time | Deterministic |
| `deny-continue` — `../escape.txt`, `Bash`, `.git/hooks/pre-commit`, `src/ok.py` | 5 | 395 ms | 5 | 13 978 / 153 | `src/ok.py` only | Both escapes were denied (`working_tree`). `Bash` was never offered, so it **never reached the hook**. The session carried on after each deny, and the **kit flagged 10 violations**: denying without halting is not conformant |
| `pause-resume` — pause at a write, resume by session id | 3 + 2 | 373 + 319 ms | 2 + 2 | 6 015 + 6 562 / 83 + 51 | `src/greet.py` | The resumed client's first request replayed **11 messages** of history from the saved session. The re-issued write ran |
| `resume-elsewhere` — the same, from an empty config directory | 3 + — | 373 ms + error | 2 + 0 | — | Nothing | **Failed:** *"No conversation found with session ID"* |
| `hook-timeout` — hook outlives its 1 s timeout on an allowed write | 2 | 1 355 ms | 2 | 6 050 / 51 | Nothing | Failed closed: the tool did not run. The harness recorded **0** permission denials |
| `hook-raises` — hook raises on an allowed write | 2 | 376 ms | 2 | 6 040 / 51 | `src/greet.py` (default mode); nothing (`dontAsk`) | **Failed open under the default mode** |
| `hook-raises-ci` — hook raises on a CI write the policy denies | 2 | 339 ms | 2 | 6 041 / 49 | **`.github/workflows/ci.yml`** (default mode); nothing (`dontAsk`) | **The policy was bypassed under the default mode.** Under `dontAsk` the write was refused |

¹ The model is a script, so the token figures are the stub's estimate of request size (bytes
÷ 4), not a real tokenizer's count. They say that the harness sends about 2.4–2.9 k tokens of
system prompt and tool schemas per request. They say nothing about a real model's spend.
Under `dontAsk` the same scenarios sent about 15 % fewer (`halt`: 7 308).

The wall clock is almost entirely the harness's own. The CLI reported 125–156 ms of session
time inside a 358–432 ms wall clock, because the stub answers at once. The difference is
process start-up.

#### Other facts the prototype established

- **The CLI is in the wheel.** `claude_agent_sdk/_bundled/claude`, 255 MB, version 2.1.300.
  The roadmap's `[unverified]` "whether the Python wheel bundles the CLI" is answered: it
  does. The engine image grows by at least that much under DH.3.
- **What the harness sends the facade.** It sends `POST /v1/messages`, streamed, with
  `anthropic-version: 2023-06-01` and an `anthropic-beta` list of 11 entries that DH.2 must
  forward unchanged. It made no `count_tokens` call and no other request.
- **`tools` restricts what the model is offered.** Every request listed exactly the five file
  tools. A call to an unoffered tool never reaches the hook. The allow-list is therefore
  enforced twice (by `tools`, and by the policy), but the policy does not see that attempt.
  DH.3 records it from the assistant message instead.
- **A hook halt reports as success.** The result is `subtype: "success"` with
  `terminal_reason: "hook_stopped"`. An adapter that reads `subtype` would report a halted
  stage as completed.
- **`total_cost_usd` is the SDK's own estimate.** It reported $0.019 for a run whose provider
  was a stub. This confirms the roadmap's reason for metering at the facade, not from the
  harness.
- **A resumed history is not shaped like the live one.** The saved session replays one
  message per content block, so a turn of text plus a tool call becomes two `assistant`
  messages. The stub first counted turns by `assistant` messages and replayed the wrong step
  after a resume. A recorded provider fixture (roadmap infrastructure option 6) must key on
  content, not on message counts.

#### What did not work

1. **A raising hook fails open under the default permission mode.** This is the finding that
   matters most. The hook *is* the enforcement seat, so a bug or outage inside it, such as a
   policy store that cannot be read, would let every tool through. That includes a CI write
   the policy forbids. `permission_mode="dontAsk"` closes it, as measured. DH.3 must use
   `dontAsk` **and** catch every exception inside the hook, answering `deny` with
   `continue: false`.
2. **Resume across machines.** It failed here, and again in axis 1's `k5-lost-session`. It
   is not a defect of the harness, but it is a constraint the roadmap had not stated.
3. **A deny alone does not halt.** The harness tells the model "denied", and the scripted
   model went on to try other paths. Halting is the executor's job (`continue: false`). The
   conformance kit is what catches an adapter that forgets.
4. **A timeout is invisible to the harness's accounting.** The tool was not run, as the hooks
   documentation promises, but `permission_denials` was 0. The adapter has to record the
   timeout itself.
5. **Turn counting in the stub**, described above. It is a prototype defect, fixed in place
   and recorded because DH.2's fixture would repeat it.

None of these is a reason to reject the harness. Items 1, 3 and 4 are requirements on DH.3,
and [`STAGE_EXECUTORS.md`](STAGE_EXECUTORS.md) § *Writing an executor* lists them. Item 2 is
an input to axis 1.

### The decision

1. **Every model stage runs through the `StageExecutor` SPI**
   ([`STAGE_EXECUTORS.md`](STAGE_EXECUTORS.md)). #160 dispatches to an executor. It never
   calls a model or a harness itself.
2. **MVP: native single-shot for stages without tools, and the Claude Agent SDK harness for
   `implement`** (DH.3). The harness runs under L5, with `permission_mode="dontAsk"` and the
   hook-failure handling above. It reaches models only through the DH.2 facade.
3. **The native tool loop is v2** (DH.5). It is the named fallback: if a trigger below fires,
   DH.5 moves into the MVP and DH.2/DH.3 move out (decision L3's fallback).
4. **CLI harnesses are v2** (DH.6). None is admitted before it has a primary-source terms
   record and a deny seat the conformance kit can observe.
5. **OpenHands is not pursued.**

Three reasons, in order of weight:

1. **The enforcement seat is real once configured.** The policy denied every forbidden write,
   and a halt stopped the session before anything else ran. The single failure mode found, a
   raising hook, has a measured fix.
2. **Cost to a competent editing agent.** Owning agent quality (context management, edit
   reliability, recovery) is the work vendors staff whole teams for. The harness brings it,
   and the SPI keeps it swappable.
3. **Key custody holds.** The harness needs nothing but a base URL and a credential the
   engine mints, so § 4 stays true behind DH.2.

What the harness gives up, stated plainly:

- **Provider neutrality for `implement`.** Until DH.5 exists, `implement` is Claude-only
  (L3's validation point), and an executor with `provider_neutral: false` says so.
- **About 255 MB of image.**
- **A session store on local disk**, which axis 1 plans for (its decision 5: a per-run volume).

### Triggers that reopen this axis

1. **Terms.** Anthropic's written reading of L4's two open questions is negative, or has not
   arrived when DH.3 is about to be offered beyond the owner's own deployment. Then DH.5
   moves into the MVP.
2. **Seat regressions.** A harness release fails the conformance kit, or lands a file in the
   prototype's `hook-raises-ci.dontAsk` or `halt` scenarios (rerun `run.sh` at that version).
   That release is not adopted. **Two such releases in a quarter** reopen the choice between
   the harness and DH.5.
3. **Neutrality demand.** Count `implement` attempts refused because the stage's routing
   alias resolves to a non-Anthropic first hop. **More than 10 % of `implement` attempts in a
   calendar month** promotes DH.5.
4. **Footprint.** The engine image grows by more than **400 MB** under DH.3, or harness
   start-up exceeds **2 s at p95** per attempt on production hardware.

### What #160 builds

This scopes [#160](https://github.com/NobuData/ouroboros/issues/160) (T.6) against both axes
before it starts.

**Orchestration (axis 1):**

- **The interpreter** runs in `ouroboros-engine` on #54's worker pool. It walks the pinned
  document from the position `ouroboros-rest` reports and holds nothing durable. The
  prototype's `engine.py` `interpret()` is the shape.
- **`ouroboros-rest` gains what the prototype's journal added to AP.1:**
  - claim-or-resume with an **epoch**, refusing a live holder `already_running`;
  - a **heartbeat**;
  - a **stage checkpoint** store;
  - the run's **position**;
  - **`409 fenced`** on any engine write carrying a stale epoch.

  The research investigation routes are the precedent for the claim and the checkpoint.
- **The supervisor lives in `ouroboros-rest`.** It resubmits `queued` runs and `running`
  runs whose heartbeat is older than the stale threshold. The defaults are a 5 s heartbeat
  and a 30 s threshold.
- **Recovery:** native stages re-run; harness stages resume from the checkpointed session
  id and fall back to one fresh attempt. The run's `CLAUDE_CONFIG_DIR` sits on a volume the
  engine container mounts.
- **Gates park as rows.** A decision resubmits the run.

**Stage execution (axis 2):**

- **Dispatch.** For each model node of the pinned document, #160 builds a `StageContext`:
  - the prompt template, rendered;
  - the routing alias;
  - a `ToolPolicy` from the node's P9 `permissions`, the workspace's protected paths, the
    run's working tree (DI.1) and the L5 allow-list.

  A node that needs tools gets the harness executor (MVP). Any other node gets native
  single-shot. The interpreter reads `capabilities()` and never the kind.
- **Registration.** Executors are constructed in **one** composition root. That module is
  added to `TID251`'s per-file ignores in the same commit, the way `research-tools.module.ts`
  is the one place a research tool is registered. Nothing else imports an adapter.
- **Events.** #160 sends events through `execution.ingest` into AP.1:
  - `model_turn`, `tool_request` and `tool_result` as transcript batches;
  - the change-set for `PUT /files` (which triggers AP.3) computed from the working tree's
    diff at stage end. `file_change` events are the transcript's, not the change-set's
    source, because a crash can lose one (axis 1, `k3`);
  - `usage` as `POST /resources`.

  #160 posts nothing the executor did not emit.
- **Outcomes onto stage transitions:**

  | Outcome | Stage transition |
  |---|---|
  | `completed` | `succeeded` |
  | `halted` | `failed`, with the verdict in the transcript, and the run flagged for a person (#315) |
  | `paused` | Stays `active`. Its checkpoint is persisted where axis 1 persists state |
  | `aborted` | AP.4's acknowledgement |
  | `failed` | `failed`, return reason `errored` |
- **What #160 does not build:** the harness adapter (DH.3), the facade (DH.2), the native tool
  loop (DH.5) or the steer call (#315).

### What #315 inherits

- **Halt on fail is the SPI's deny.** It is one implementation (`policy.evaluate`), and the
  conformance kit checks that every reported verdict is the policy's own.
- **Enforcement against the harness.** #315's added criterion, that enforcement is proven
  *against the harness executor*, has its first evidence in the `halt` and `hook-raises-ci`
  scenarios. DH.3 turns those into CI tests over a recorded fixture.
- **Pause and abort take effect at the kind's safe boundary**: between tool calls for a native
  executor, at the pre-tool hook for a harness.
- **`steer` is a capability flag with no call yet.** #315 defines the call.

## Sources

- Issues:
  - #155, #160 and #315, as filed;
  - DH.1 [#1302](https://github.com/NobuData/ouroboros/issues/1302) and the Epic DH issues
    in [`ROADMAP_OOE_LIVE_LOOP.md`](ROADMAP_OOE_LIVE_LOOP.md);
  - #234 → [`DECISION_INVOCATION_GATEWAY.md`](DECISION_INVOCATION_GATEWAY.md);
  - DH.4 [#1304](https://github.com/NobuData/ouroboros/issues/1304) →
    [`MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
- The specification: [`STAGE_EXECUTORS.md`](STAGE_EXECUTORS.md).
- The prototype and its raw results:
  [`prototypes/stage-executor/`](prototypes/stage-executor/README.md). Run 2026-10-14 with
  `claude-agent-sdk` 0.2.167 from PyPI and bundled CLI 2.1.300.
- Axis 1's prototype and its raw results:
  [`prototypes/execution-engine/`](prototypes/execution-engine/README.md), run 2026-10-14 on
  the same SDK, CLI and stub facade.
- Orchestrator facts, read 2026-10-14:
  - Temporal: [self-hosted deployment](https://docs.temporal.io/self-hosted-guide/deployment),
    [visibility stores](https://docs.temporal.io/self-hosted-guide/visibility) and the
    [Python SDK sandbox](https://docs.temporal.io/develop/python/python-sdk-sandbox);
  - Hatchet: [self-hosting](https://docs.hatchet.run/self-hosting);
  - Inngest: [self-hosting](https://www.inngest.com/docs/self-hosting);
  - Restate: [the anatomy of a durable execution stack](https://restate.dev/blog/the-anatomy-of-a-durable-execution-stack-from-first-principles/),
    a vendor blog post, hence `[search-level]`.
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and
  [hooks](https://code.claude.com/docs/en/agent-sdk/hooks), as quoted and marked in the
  roadmap's *Infrastructure Options*, read 2026-10-10. The SDK's own option documentation
  (`claude_agent_sdk/types.py`, 0.2.167) for `permission_mode`, `setting_sources`, `tools`
  and `HookMatcher.timeout`.
