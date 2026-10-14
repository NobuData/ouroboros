# Stage executors — writing an adapter

DH.1 ([#1302](https://github.com/NobuData/ouroboros/issues/1302)). Decisions **L2** (the
engine decision has two axes), **L3** (the slice's tool-using stage runs through a harness)
and **L5** (file tools only, one working tree). This is the fourth application of the SPI
pattern, after ticket sources ([`TICKET_SOURCES.md`](TICKET_SOURCES.md)), model providers
([`MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md)) and research tools
([`RESEARCH_TOOLS.md`](RESEARCH_TOOLS.md)).

A **stage executor** is what runs inside one model stage of a workflow. #155 decides how a
*workflow* is orchestrated: which stage runs next, and how a run survives a restart. This
interface decides what happens *inside* the `implement` stage, where something reads code,
edits files and iterates. The reasons for the choice, and what the prototype measured, are in
[`DECISION_EXECUTION_ENGINE.md`](DECISION_EXECUTION_ENGINE.md) § *Axis 2*.

Everything lives in `ouroboros-engine/src/ouroboros_engine/execution/`:

| File | What it is |
|---|---|
| `spi.py` | The interface: `StageExecutor`, its kinds, capabilities, context, checkpoint and outcome |
| `events.py` | The event vocabulary: five kinds and nothing else |
| `policy.py` | The tool policy, with its single implementation, `evaluate()` |
| `glob.py` | AP.3's path glob grammar and CI registry, transcribed from `ouroboros-rest` |
| `ingest.py` | The vocabulary mapped onto AP.1's run-ingestion shapes |
| `executors/` | The adapters, and the **only** place one may be imported. Empty until DH.3 |

The conformance kit and the fakes are test code, beside the engine's other fakes:

| File | What it is |
|---|---|
| `tests/stage_executor_conformance.py` | The kit every executor must pass |
| `tests/stage_executor_fakes.py` | A scripted fake in both kinds, and a rogue that breaks one rule at a time |

## The interface

```python
class StageExecutor(ABC):
    kind: ClassVar[Literal["native", "harness"]]

    def capabilities(self) -> ExecutorCapabilities     # {tools, resume, steer, provider_neutral}
    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]
    def pause(self) -> None                             # a request; takes effect at the safe boundary
    def abort(self) -> None                             # a request; takes effect at the safe boundary
    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]
    @property
    def outcome(self) -> StageOutcome | None            # set when the stream ends
```

**One instance serves one stage attempt.** `run()` streams the attempt's events and ends
when the attempt ends. `outcome` then says how it ended:

| `status` | Meaning | Carries |
|---|---|---|
| `completed` | The model finished | — |
| `halted` | The tool policy denied a call (#315's *halt on fail*) | `verdict`, the deny |
| `paused` | `pause()` took effect | `checkpoint`, when `capabilities().resume` |
| `aborted` | `abort()` took effect | — |
| `failed` | An error the executor could not recover from | `error` |

`StageContext` carries the run, stage key, attempt, rendered prompt, model (an alias the
executor resolves) and the attempt's `ToolPolicy`. A `Checkpoint` carries the kind that wrote
it, the context, the `seq` to continue from, and an opaque, JSON-serialisable `state`: a
harness's session id, or a native loop's message history. Resuming under another kind raises
`ExecutorCapabilityError`. So does resuming with an executor whose capabilities say it cannot.

### Kinds and safe boundaries

| Kind | Who owns the loop | Where pause and abort take effect |
|---|---|---|
| `native` | The engine. It calls models through the chain executor (#235) | Between tool calls: after one tool's result, before the next request runs |
| `harness` | A vendor agent runtime (the Claude Agent SDK in DH.3) | At the harness's pre-tool hook. The pending tool call is refused, not run |

Pause and abort never take effect *inside* a running tool. A request made while a tool runs
waits for that tool to finish. A model turn may still stream before the boundary is reached.
No tool runs after it.

### Capabilities

| Flag | Meaning |
|---|---|
| `tools` | It runs a tool loop. `False` for a single-shot executor (plan, summarise) |
| `resume` | A paused attempt can be continued from its checkpoint, on a fresh instance |
| `steer` | It accepts guidance mid-attempt. #315 defines the call; no executor claims it yet |
| `provider_neutral` | Any provider the chain executor routes to can serve it. `False` for a harness that serves one vendor's models |

## The event vocabulary

Every executor, of either kind, reports an attempt as a stream of these five kinds. Each
carries `seq` (the executor's own monotonic number, from 1), `stage_key`, `attempt` and `ts`.
`ouroboros_engine.execution.ingest` maps each kind onto AP.1
([#303](https://github.com/NobuData/ouroboros/issues/303)):

| Kind | Fields | AP.1 |
|---|---|---|
| `model_turn` | `model_id`, `text` | Transcript entry, actor `model`, `model_id` required |
| `tool_request` | `request` (the `ToolRequest` the policy read) | Transcript entry, actor `tool`, `tool_tag` = the tool, `payload.phase = "request"` |
| `tool_result` | `call_id`, `tool`, `verdict`, `ok`, `output` | Transcript entry, actor `tool`, `payload.phase = "result"`, `payload.verdict` |
| `file_change` | `path`, `status`, `additions`, `deletions` | Folded into the **whole** change-set for `PUT /files`, which AP.3 judges (`to_change_set`) |
| `usage` | `provider`, `model`, `tokens_in`, `tokens_out`, `latency_ms` | One unpriced spend for `POST /resources` (`to_spend`) |

`seq` becomes AP.1's ordering `hint`. A body longer than AP.1's 20 000-character bound is
clipped and ends with `…`.

**An executor that cannot observe a real event emits nothing.** This is #315's provenance
rule. A `model_turn` is text a model returned, verbatim. It is never a summary, a narration,
or reasoning the executor composed. A harness that does not expose a model's text emits
`usage` and tool events only. There is no `reasoning`, `status` or `note` kind, so such text
has nowhere to go. The conformance kit fails an executor that emits anything else.

## The tool policy

Every tool call is put to `policy.evaluate(policy, request)` **before** the tool runs. A
native executor asks between tool calls. A harness executor asks from its pre-tool hook. Both
hand it the same `ToolRequest` and get back the same `ToolVerdict`, because `evaluate()` is
the only implementation. #160's *enforcement at the tool boundary* and #315's *halt on fail*
are both implemented there, once.

An adapter translates its own tool names into the neutral vocabulary before asking: a
harness's `Write` becomes `write_file`. A name it cannot translate is passed through, and the
allow-list refuses it. Paths may be absolute or relative to the working tree.

The rules are checked in this order. The first one that refuses decides:

| # | Rule | Refuses | Input, and where it comes from |
|---|---|---|---|
| 1 | `allow_list` | A tool not on the stage's allow-list | `allowed_tools`. The default, `L5_TOOLS`, is `read_file`, `list_dir`, `search`, `write_file`, `edit_file`. There is no shell, no network tool and no MCP |
| 2 | `stage_permission` | `push_fixup` when the stage declared `push_fixup: false` | `permissions`: P9's `LlmPermissions`, from the pinned workflow document |
| 3 | `working_tree` | A path that resolves outside the run's working tree or into its `.git`, or a write that names no path | `working_tree`: DI.1's per-run tree. Symbolic links are resolved first |
| 4 | `stage_permission` | A **write** to CI configuration when the stage declared `touch_ci: false` | `CI_CONFIG_GLOBS`, AP.3's registry `ci-v1` |
| 5 | `protected_path` | A **write** to a protected path | `protected_paths`: the workspace's globs (V067 and the org policy's `protected_paths`) |

Reads are held to rules 1 and 3 only. Reading a protected file changes nothing, and AP.3
judges change-sets, not reads. `.git` is outside the working tree because a write to
`.git/hooks/` is code that runs at the next commit.

**A `deny` is a halt.** The tool does not run, the executor reports the `tool_result` with
`ok: false` and the verdict, the stream ends, and `outcome` is `halted` with that verdict.
Telling the model "denied" and carrying on is **not** conformant. The harness prototype shows
why: a model that is told "no" tries something else.

The policy refuses a write *before* it happens. AP.3's guardrails
([#305](https://github.com/NobuData/ouroboros/issues/305)) fail a change-set *after* it is
reported. Both seats use the same glob grammar and the same CI registry.
`tests/test_execution_glob.py` reads `ouroboros-rest`'s `guardrails.ci.ts` and fails when the
two copies drift. The allowed-path *scope* (a plan's declared file list) and allow-once
exceptions stay with AP.3. The policy does not read them.

## The import rule

Core engine code imports `ouroboros_engine.execution`, which is the interface. It never
imports an adapter. Ruff's `banned-api` rule (`TID251`, in `ouroboros-engine/pyproject.toml`)
refuses an import of `ouroboros_engine.execution.executors`, or of `claude_agent_sdk`,
anywhere in `src/` except under `execution/executors/`. `tests/test_execution_imports.py`
proves that the rule fires, and checks the tree again without ruff.

## The conformance kit

An adapter's tests call each of these with a factory for the executor and a context, and
assert that the returned list of violations is empty:

| Check | What it proves |
|---|---|
| `check_run` | Every event is in the vocabulary, belongs to the context's stage and attempt, and has a strictly increasing `seq`. Every `tool_request` is answered before the next, and its verdict is **the policy's own** for that request. A deny ends the stream, and the outcome is `halted` with that verdict. Every `file_change` follows an allowed write of that path. `outcome` is set |
| `check_pause_resume` | Pause after the first tool result: no tool request after it, and the outcome is `paused`. When the executor claims `resume`, a fresh instance continues from the checkpoint with `seq` above where the attempt stopped |
| `check_resume_refused` | An executor that does not claim `resume` raises `ExecutorCapabilityError` |
| `check_abort` | Abort after the first tool result: no tool request after it, and the outcome is `aborted` |

The kit does not script the executor. A real harness is driven by its model, or in CI by a
recorded provider fixture (roadmap infrastructure option 6). So every check is a property of
whatever stream the executor produced. The fake passes the whole kit in both kinds. The
rogue executor fails it for an out-of-vocabulary event, a verdict that disagrees with the
policy, events for another stage, and a missing outcome.

## Writing an executor

1. Subclass `StageExecutor` in `execution/executors/<name>.py` and set `kind`.
2. Translate every tool call into a `ToolRequest` and ask `evaluate()` before it runs. On
   `deny`, do not run the tool. Report the result, end the stream, and set `outcome` to
   `halted`.
3. Emit only events you observed. A model's text only when the runtime gives it to you.
   Usage per model call.
4. Honour `pause()` and `abort()` at your kind's boundary. Write a `Checkpoint` your own
   `resume()` can continue from, or report `resume: False`.
5. Pass the conformance kit, in `tests/test_execution_<name>.py`.

**A harness adapter must also** do the following. Each item was measured in the prototype,
[`prototypes/stage-executor/`](prototypes/stage-executor/README.md):

- Run with `permission_mode="dontAsk"`. Under the SDK's default mode, a pre-tool hook that
  **raises** lets the tool run. The prototype wrote a CI file the policy would have denied.
  Under `dontAsk`, a call the hook did not allow is refused.
- Catch every exception inside the hook and answer `deny` with `continue: false`. Never let
  one escape, whatever the permission mode.
- Halt with `continue: false` alongside the `deny`. A `deny` alone refuses one call and the
  session carries on.
- Read the result's `terminal_reason`, not its `subtype`. A session stopped by the hook
  reports `subtype: "success"` with `terminal_reason: "hook_stopped"`.
- Record a hook timeout itself. A timed-out hook means the tool is not run, but the
  harness reports no permission denial.
- Pass `setting_sources=[]`, so no repository settings or hooks are loaded (L5). Pass `tools`
  limited to the file tools, and an isolated `CLAUDE_CONFIG_DIR`, so the engine's own login
  is never read.
- Treat the session as local state. Resume reads the session from `CLAUDE_CONFIG_DIR`. A
  resume on a container without that directory fails with *"No conversation found"*. Keep
  the directory per run, on a volume the restarted engine mounts.
- Checkpoint the session id as soon as the session reports it, and again after every tool
  result. The harness writes its session lazily: a crash within tens of milliseconds of a
  step can find no session at all. When `resume()` fails, the interpreter starts one fresh
  attempt ([`DECISION_EXECUTION_ENGINE.md`](DECISION_EXECUTION_ENGINE.md) § *Axis 1*).

## Registered executors

None yet. The planned ones:

| Executor | Kind | Issue | Release |
|---|---|---|---|
| Single-shot (plan, summarise) over the chain executor | `native` | #160 with #235 | MVP |
| Claude Agent SDK | `harness` | DH.3 ([#1308](https://github.com/NobuData/ouroboros/issues/1308)) | MVP |
| Native tool loop, any provider | `native` | DH.5 ([#1309](https://github.com/NobuData/ouroboros/issues/1309)) | v2 |
| CLI harnesses (`codex exec`, `cursor-agent -p`, …) | `harness` | DH.6 ([#1306](https://github.com/NobuData/ouroboros/issues/1306)) | v2 |
