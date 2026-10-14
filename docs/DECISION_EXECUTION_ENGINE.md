# Decision — the execution engine

> **Issue:** [#155](https://github.com/NobuData/ouroboros/issues/155) — T.1, *Execution engine
> ADR*, with its second axis from DH.1
> ([#1302](https://github.com/NobuData/ouroboros/issues/1302)).
>
> **Axis 1, orchestration:** **open**. #155 decides it in this document.
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
| 1 — Orchestration | How a workflow's stages are sequenced, persisted and resumed after a restart | #155 | Open |
| 2 — Stage execution | What runs the agent loop inside one stage, and where the tool boundary sits | DH.1 | **Adopted** |

The two axes are independent with one exception: a harness keeps its own session state, so
axis 1's restart-resume prototype must include a harness stage (see § *Axis 1*).

---

## Axis 1 — orchestration

**Open. #155 records its decision here.** The candidates, as #155 files them:

- **A**, a custom asyncio interpreter over the #54 task skeleton (recommended);
- **B**, Temporal;
- **C**, the Hatchet / Inngest / Restate class.

#155 prototypes resume after an engine restart mid-stage, then decides, and states its
graduation triggers as numbers.

Axis 2 adds one input to that prototype, and it is now measured, not assumed. **A harness's
session lives on the local disk of the process that ran it.** The SDK resumes a session by id
from its `CLAUDE_CONFIG_DIR`. A resume from an empty config directory fails with *"No
conversation found with session ID …"* (scenario `resume-elsewhere`, below). Whatever axis 1
chooses, a paused or interrupted harness stage can be continued only in one of two ways:

1. the run's config directory survives the restart (a per-run directory on a volume the
   restarted engine mounts); or
2. the checkpoint carries the session transcript and writes it back before resuming.

The restart-resume prototype must exercise one of the two.

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
| **Resume** | Nothing to resume: re-run the call | Engine-owned message history in the checkpoint, stored wherever axis 1 stores state | **Measured:** works by session id against the same config directory, and fails against an empty one. Session state is local disk (§ *Axis 1*) | Per CLI, `[unverified]` |
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
2. **Resume across machines.** It failed as described in § *Axis 1*. It is not a defect of the
   harness, but it is a constraint the roadmap had not stated.
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
- **A session store on local disk**, which axis 1 has to plan for.

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

### What #160 builds against the SPI

This scopes [#160](https://github.com/NobuData/ouroboros/issues/160) before it starts:

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
  - `file_change` folded into `PUT /files` (which triggers AP.3);
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
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and
  [hooks](https://code.claude.com/docs/en/agent-sdk/hooks), as quoted and marked in the
  roadmap's *Infrastructure Options*, read 2026-10-10. The SDK's own option documentation
  (`claude_agent_sdk/types.py`, 0.2.167) for `permission_mode`, `setting_sources`, `tools`
  and `HookMatcher.timeout`.
