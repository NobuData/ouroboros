"""Option A, prototyped: a custom asyncio interpreter that survives being killed mid-stage.

#155 (T.1). One process, killed with ``SIGKILL`` by ``driver.py`` at the moments that matter
and started again. It holds **nothing durable**: every fact it needs to continue — where the
run stands, each stage's attempt and checkpoint, the transcript's last hint — is read back
from the journal (``journal.py``, the stand-in for ``ouroboros-rest``) when the supervisor
submits the run again. That is the investigation runner's model, applied to a workflow.

The workflow is the Live Loop slice's shape, four nodes:

``plan``       native single-shot — one model call, nothing to resume (re-run on recovery)
``implement``  a **Claude Agent SDK harness session** (the #155 amendment) — resumed from
               its checkpoint, the session id, against a per-run ``CLAUDE_CONFIG_DIR``
``review``     a human gate — the run parks in the journal and the engine holds nothing
``done``       terminal

Both executors are ``StageExecutor`` implementations (DH.1, ``docs/STAGE_EXECUTORS.md``);
the interpreter calls the SPI and nothing else. The harness executor follows the SPI's
harness checklist: ``permission_mode="dontAsk"``, ``setting_sources=[]``, file tools only,
and a ``PreToolUse`` hook into the engine's policy that never lets an exception escape.

Configuration comes from the environment ``driver.py`` sets (``OURO_PROTO_*``).
"""

import asyncio
import contextlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import AsyncIterator, Awaitable, Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    UserMessage,
)

from ouroboros_engine.execution.events import (
    FileChange,
    ModelTurn,
    StageEvent,
    ToolRequestEvent,
    ToolResultEvent,
    Usage,
)
from ouroboros_engine.execution.policy import (
    WRITE_TOOLS,
    ToolPolicy,
    ToolRequest,
    evaluate,
    resolve_in_tree,
)
from ouroboros_engine.execution.spi import (
    Checkpoint,
    ExecutorCapabilities,
    ExecutorCapabilityError,
    ExecutorKind,
    StageContext,
    StageExecutor,
    StageOutcome,
)
from ouroboros_engine.workflows.dsl import LlmPermissions

JOURNAL = os.environ["OURO_PROTO_JOURNAL"]
FACADE = os.environ["OURO_PROTO_FACADE"]
ROOT = Path(os.environ["OURO_PROTO_ROOT"])
HOLDER = os.environ["OURO_PROTO_HOLDER"]
PORT = int(os.environ["OURO_PROTO_PORT"])
#: A path whose write makes the PostToolUse hook stall once — so a kill lands after the tool
#: ran and before its result reached the journal.
SLOW_POST_TOOL = os.environ.get("OURO_PROTO_SLOW_POST_TOOL", "")

SANDBOX = ROOT / "sandbox"
TOOL_LOG = (
    ROOT / "tool-runs.log"
)  # every tool that actually ran, appended outside the engine
MODEL = "claude-sonnet-5-5"
HARNESS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"]
NEUTRAL = {
    "Read": "read_file",
    "Write": "write_file",
    "Edit": "edit_file",
    "Glob": "search",
    "Grep": "search",
}

#: The workflow: (node, kind).
GRAPH: list[tuple[str, str]] = [
    ("plan", "native"),
    ("implement", "harness"),
    ("review", "gate"),
    ("done", "terminal"),
]

HEARTBEAT_S = 0.5


def now() -> str:
    """ISO 8601, UTC."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def call(
    method: str, path: str, body: dict[str, Any] | None = None
) -> tuple[int, dict]:
    """One journal request. Returns (status, body); never raises on an HTTP status."""
    request = urllib.request.Request(
        f"{JOURNAL}{path}",
        json.dumps(body or {}).encode(),
        {"content-type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


async def journal(method: str, path: str, body: dict[str, Any] | None = None):
    """``call`` off the event loop."""
    return await asyncio.to_thread(call, method, path, body)


# --- executors ------------------------------------------------------------------------------


class NativeSingleShot(StageExecutor):
    """One model call through the facade. Nothing to resume: recovery re-runs it."""

    kind: ClassVar[ExecutorKind] = "native"

    def __init__(self) -> None:
        """No state beyond the outcome."""
        self._outcome: StageOutcome | None = None

    def capabilities(self) -> ExecutorCapabilities:
        """Single-shot, any provider."""
        return ExecutorCapabilities(
            tools=False, resume=False, steer=False, provider_neutral=True
        )

    def pause(self) -> None:
        """A single call has no boundary inside it; the pause lands when it returns."""

    def abort(self) -> None:
        """As pause."""

    @property
    def outcome(self) -> StageOutcome | None:
        """How it ended."""
        return self._outcome

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Never: see capabilities."""
        raise ExecutorCapabilityError("single-shot executors do not resume")

    async def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:  # type: ignore[override]
        """Call the model once."""
        started = time.monotonic()
        body = {
            "model": MODEL,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": ctx.prompt}],
        }
        request = urllib.request.Request(
            f"{FACADE}/v1/messages",
            json.dumps(body).encode(),
            {
                "content-type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": "ouro-run-scoped-stub-credential",
            },
        )

        def post() -> dict[str, Any]:
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
                return json.loads(response.read())

        answer = await asyncio.to_thread(post)
        common = {"stage_key": ctx.stage_key, "attempt": ctx.attempt, "ts": now()}
        text = "".join(
            b.get("text", "") for b in answer["content"] if b["type"] == "text"
        )
        yield ModelTurn(seq=1, model_id=answer["model"], text=text, **common)
        yield Usage(
            seq=2,
            provider="anthropic",
            model=answer["model"],
            tokens_in=answer["usage"]["input_tokens"],
            tokens_out=answer["usage"]["output_tokens"],
            latency_ms=round((time.monotonic() - started) * 1000),
            **common,
        )
        self._outcome = StageOutcome(status="completed")


class HarnessExecutor(StageExecutor):
    """A Claude Agent SDK session; checkpoints its session id as soon as it has one."""

    kind: ClassVar[ExecutorKind] = "harness"

    def __init__(
        self, config_dir: Path, on_checkpoint: Callable[[Checkpoint], Awaitable[None]]
    ) -> None:
        """Bind the session's config directory and where checkpoints go."""
        self._config_dir = config_dir
        self._on_checkpoint = on_checkpoint
        self._outcome: StageOutcome | None = None
        self._abort = False
        self._seq = 0
        self._session: str | None = None

    def capabilities(self) -> ExecutorCapabilities:
        """Claude-only, resumable."""
        return ExecutorCapabilities(
            tools=True, resume=True, steer=False, provider_neutral=False
        )

    def pause(self) -> None:
        """Not exercised by this prototype; abort is."""
        self._abort = True

    def abort(self) -> None:
        """Refuse the next tool call at the hook and stop the session."""
        self._abort = True

    @property
    def outcome(self) -> StageOutcome | None:
        """How it ended."""
        return self._outcome

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """A new session."""
        return self._stream(ctx, ctx.prompt, None, 1)

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """The same session, by id, from the same config directory."""
        if (
            checkpoint.executor_kind != self.kind
            or "session_id" not in checkpoint.state
        ):
            raise ExecutorCapabilityError("not a harness checkpoint")
        return self._stream(
            checkpoint.context,
            "Continue the task from where you stopped.",
            str(checkpoint.state["session_id"]),
            checkpoint.next_seq,
        )

    async def _stream(
        self, ctx: StageContext, prompt: str, resume_id: str | None, next_seq: int
    ) -> AsyncIterator[StageEvent]:
        queue: asyncio.Queue[StageEvent | None] = asyncio.Queue()
        self._seq = next_seq - 1
        self._session = resume_id
        pending: dict[str, ToolRequest] = {}
        halted: list[Any] = []

        def emit(cls: type[Any], **fields: Any) -> None:
            self._seq += 1
            queue.put_nowait(
                cls(
                    seq=self._seq,
                    stage_key=ctx.stage_key,
                    attempt=ctx.attempt,
                    ts=now(),
                    **fields,
                )
            )

        async def checkpoint() -> None:
            if self._session is not None:
                await self._on_checkpoint(
                    Checkpoint(
                        executor_kind="harness",
                        context=ctx,
                        next_seq=self._seq + 1,
                        state={"session_id": self._session},
                    )
                )

        def deny(reason: str) -> dict[str, Any]:
            return {
                "continue_": False,
                "stopReason": reason,
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                },
            }

        async def pre_tool(
            data: dict[str, Any], tool_use_id: str | None, _ctx: Any
        ) -> dict:
            try:
                if self._abort:
                    return deny("The stage was aborted.")
                tool_input = data.get("tool_input") or {}
                path = tool_input.get("file_path") or tool_input.get("path")
                name = str(data.get("tool_name", ""))
                request = ToolRequest(
                    call_id=tool_use_id or f"hook-{self._seq}",
                    tool=NEUTRAL.get(name, name.lower()),
                    paths=() if path is None else (str(path),),
                )
                verdict = evaluate(ctx.policy, request)
                emit(ToolRequestEvent, request=request)
                if verdict.halts:
                    emit(
                        ToolResultEvent,
                        call_id=request.call_id,
                        tool=request.tool,
                        verdict=verdict,
                        ok=False,
                    )
                    halted.append(verdict)
                    return deny(verdict.reason)
                pending[request.call_id] = request
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "allow",
                    }
                }
            except Exception as error:  # noqa: BLE001 — a broken hook must fail closed
                return deny(f"policy unavailable: {type(error).__name__}")

        async def post_tool(data: dict[str, Any], _id: str | None, _ctx: Any) -> dict:
            tool_input = data.get("tool_input") or {}
            path = str(tool_input.get("file_path") or tool_input.get("path") or "")
            with TOOL_LOG.open("a") as log:
                log.write(
                    json.dumps(
                        {"holder": HOLDER, "tool": data.get("tool_name"), "path": path}
                    )
                    + "\n"
                )
            marker = ROOT / "slow-post-tool.done"
            if SLOW_POST_TOOL and path.endswith(SLOW_POST_TOOL) and not marker.exists():
                marker.write_text("1")
                await asyncio.sleep(30)  # the driver kills the engine during this
            return {}

        options = ClaudeAgentOptions(
            cwd=ctx.policy.working_tree,
            tools=HARNESS_TOOLS,
            setting_sources=[],
            permission_mode="dontAsk",
            resume=resume_id,
            max_turns=20,
            model=MODEL,
            env={
                "ANTHROPIC_BASE_URL": FACADE,
                "ANTHROPIC_API_KEY": "ouro-run-scoped-stub-credential",
                "CLAUDE_CONFIG_DIR": str(self._config_dir),
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            },
            hooks={
                "PreToolUse": [HookMatcher(matcher=None, hooks=[pre_tool])],
                "PostToolUse": [
                    HookMatcher(matcher=None, hooks=[post_tool], timeout=60)
                ],
            },
        )

        async def body() -> None:
            try:
                async with ClaudeSDKClient(options=options) as client:
                    await client.query(prompt)
                    async for message in client.receive_response():
                        session = getattr(message, "session_id", None) or getattr(
                            message, "data", {}
                        ).get("session_id")
                        if session and self._session != session:
                            self._session = session
                            await checkpoint()
                        if isinstance(message, AssistantMessage):
                            for block in message.content:
                                if isinstance(block, TextBlock) and block.text.strip():
                                    emit(
                                        ModelTurn,
                                        model_id=message.model,
                                        text=block.text,
                                    )
                            if message.usage:
                                emit(
                                    Usage,
                                    provider="anthropic",
                                    model=message.model,
                                    tokens_in=int(message.usage.get("input_tokens", 0)),
                                    tokens_out=int(
                                        message.usage.get("output_tokens", 0)
                                    ),
                                )
                        elif isinstance(message, UserMessage) and isinstance(
                            message.content, list
                        ):
                            for block in message.content:
                                if not isinstance(block, ToolResultBlock):
                                    continue
                                request = pending.pop(block.tool_use_id, None)
                                if request is None:
                                    continue
                                ok = not block.is_error
                                emit(
                                    ToolResultEvent,
                                    call_id=request.call_id,
                                    tool=request.tool,
                                    verdict=evaluate(ctx.policy, request),
                                    ok=ok,
                                )
                                if ok and request.tool in WRITE_TOOLS:
                                    emit(
                                        FileChange,
                                        path=resolve_in_tree(
                                            ctx.policy.working_tree, request.paths[0]
                                        ),
                                        status="modified",
                                    )
                            await checkpoint()
                        elif isinstance(message, ResultMessage):
                            if halted:
                                self._outcome = StageOutcome(
                                    status="halted", verdict=halted[0]
                                )
                            elif self._abort:
                                self._outcome = StageOutcome(status="aborted")
                            elif message.is_error:
                                self._outcome = StageOutcome(
                                    status="failed", error=str(message.result)
                                )
                            else:
                                self._outcome = StageOutcome(status="completed")
            except Exception as error:  # noqa: BLE001 — reported as the outcome
                self._outcome = StageOutcome(
                    status="failed", error=f"{type(error).__name__}: {error}"[:500]
                )
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(body())
        while (event := await queue.get()) is not None:
            yield event
        await task


# --- the interpreter --------------------------------------------------------------------------


async def interpret(run_id: str) -> None:
    """Claim the run, continue it from wherever the journal says it stands."""
    status, state = await journal("POST", f"/runs/{run_id}/start", {"holder": HOLDER})
    if status != 200:
        return
    epoch = state["epoch"]
    hint = state["last_hint"]
    fenced = asyncio.Event()
    executor: list[StageExecutor] = []

    async def heartbeat() -> None:
        while not fenced.is_set():
            code, _ = await journal(
                "POST", f"/runs/{run_id}/heartbeat", {"epoch": epoch}
            )
            if code == 409:
                fenced.set()
                for ex in executor:
                    ex.abort()
            await asyncio.sleep(HEARTBEAT_S)

    async def write(op: str, body: dict[str, Any], method: str = "POST") -> int:
        code, _ = await journal(
            method, f"/runs/{run_id}/{op}", {"epoch": epoch, **body}
        )
        if code == 409:
            fenced.set()
        return code

    beat = asyncio.create_task(heartbeat())
    try:
        keys = [key for key, _ in GRAPH]
        for key, kind in GRAPH[keys.index(state["position"]) :]:
            if fenced.is_set():
                return
            await write("position", {"position": key, "status": "running"})
            if kind == "gate":
                if state["gates"].get(key) == "approve":
                    continue
                await write("position", {"position": key, "status": "waiting_gate"})
                return  # nothing is held while a person decides
            if kind == "terminal":
                await write("position", {"position": key, "status": "completed"})
                return
            stage = state["stages"].get(key) or {}
            if stage.get("status") == "succeeded":
                continue
            attempt = stage.get("attempt") or 1
            checkpoint = stage.get("checkpoint")
            for _try in range(
                2
            ):  # a resume that fails falls back to a fresh attempt once
                ctx = StageContext(
                    run_id=run_id,
                    stage_key=key,
                    attempt=attempt,
                    prompt=f"[{key}] Add greet() to src/greet.py.",
                    model=MODEL,
                    policy=ToolPolicy(
                        working_tree=str(SANDBOX),
                        permissions=LlmPermissions(push_fixup=False, touch_ci=False),
                        protected_paths=("boot/**",),
                    ),
                )

                async def save(cp: Checkpoint, key: str = key) -> None:
                    await write(
                        "checkpoint",
                        {"key": key, "checkpoint": cp.model_dump(mode="json")},
                        "PUT",
                    )

                ex: StageExecutor = (
                    NativeSingleShot()
                    if kind == "native"
                    else HarnessExecutor(ROOT / "claude" / run_id, save)
                )
                executor[:] = [ex]
                await write(
                    "stage", {"key": key, "attempt": attempt, "status": "active"}
                )
                stream = (
                    ex.resume(Checkpoint.model_validate(checkpoint))
                    if checkpoint and ex.capabilities().resume
                    else ex.run(ctx)
                )
                async for event in stream:
                    hint += 1
                    payload = {"kind": event.kind, **event.model_dump(mode="json")}
                    await write(
                        "events",
                        {
                            "events": [
                                {"hint": hint, "kind": event.kind, "body": payload}
                            ]
                        },
                    )
                outcome = ex.outcome
                if outcome is not None and outcome.status == "failed" and checkpoint:
                    attempt += (
                        1  # the session could not be resumed: start the stage again
                    )
                    checkpoint = None
                    continue
                break
            if fenced.is_set():
                return
            if outcome is None or outcome.status != "completed":
                final = "halted" if outcome and outcome.status == "halted" else "failed"
                await write(
                    "stage", {"key": key, "attempt": attempt, "status": "failed"}
                )
                await write("position", {"position": key, "status": final})
                return
            await write(
                "stage", {"key": key, "attempt": attempt, "status": "succeeded"}
            )
    finally:
        fenced.set()
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat


# --- the process ------------------------------------------------------------------------------

HELD: dict[str, threading.Thread] = {}
HELD_LOCK = threading.Lock()


def submit(run_id: str) -> str:
    """Start interpreting a run unless this process already holds it."""
    with HELD_LOCK:
        thread = HELD.get(run_id)
        if thread is not None and thread.is_alive():
            return "already_running"
        thread = threading.Thread(
            target=asyncio.run, args=(interpret(run_id),), daemon=True
        )
        HELD[run_id] = thread
        thread.start()
        return "accepted"


def main() -> None:
    """Serve ``POST /submit`` and print ``ready``."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("content-length", "0"))
            run_id = json.loads(self.rfile.read(length))["run_id"]
            data = json.dumps({"code": submit(run_id)}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("ready", flush=True)
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
