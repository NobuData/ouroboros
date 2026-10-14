"""DH.1 (#1302) prototype: one ``implement`` stage through the Claude Agent SDK.

The harness (the SDK and the CLI it bundles) runs against ``stub_facade.py`` on loopback, on
a throwaway sandbox repository, with:

* ``setting_sources=[]`` — no user, project or local settings, so no repository hooks (L5);
* ``tools`` limited to the L5 file tools;
* one ``PreToolUse`` hook that translates the harness's tool call into a
  :class:`~ouroboros_engine.execution.policy.ToolRequest` and asks the engine's own
  :func:`~ouroboros_engine.execution.policy.evaluate` — the policy the conformance kit tests;
* an isolated ``CLAUDE_CONFIG_DIR``, so the operator's own login is never read.

Three scenarios, each measured (wall clock, turns, tokens, requests, what landed on disk):

``halt``          read, write, a CI write the policy denies → the hook halts the session.
``deny-continue`` denies without halting: an escape, an unoffered ``Bash``, a ``.git`` hook.
``pause-resume``  the hook pauses at a write; a new client resumes the session by id.
``resume-elsewhere`` the same, but the resuming client has a fresh ``CLAUDE_CONFIG_DIR`` —
                  an engine restarted on another container, with no shared volume.
``hook-timeout``  the hook outlives its 1 s timeout on a write the policy would *allow*.
``hook-raises``   the hook raises on that write. Does the tool run anyway?
``hook-raises-ci`` the hook raises on a CI write the policy would *deny*.

``--permission-mode`` sets the harness's own mode for every scenario (default: the SDK's);
results are written to ``results/<scenario>.json``, or ``<scenario>.<mode>.json``.

The events it observed are mapped into the DH.1 vocabulary and checked with the
conformance kit's :func:`check_stream`. Results go to ``results/<scenario>.json``.

Run with ``./run.sh`` (see README.md).
"""

import argparse
import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

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

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "ouroboros-engine" / "tests"))

from ouroboros_engine.execution.events import (  # noqa: E402
    FileChange,
    ModelTurn,
    ToolRequestEvent,
    ToolResultEvent,
    Usage,
)
from ouroboros_engine.execution.policy import (  # noqa: E402
    WRITE_TOOLS,
    ToolPolicy,
    ToolRequest,
    evaluate,
    resolve_in_tree,
)
from ouroboros_engine.execution.spi import StageContext  # noqa: E402
from ouroboros_engine.workflows.dsl import LlmPermissions  # noqa: E402
from stage_executor_conformance import check_stream  # noqa: E402
from stub_facade import Facade, Turn, serve  # noqa: E402

#: The L5 file tools, as the harness names them.
HARNESS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"]

#: The hook timeout the fault scenarios run with, in seconds.
HOOK_TIMEOUT_S = 1.0

#: Harness name → the policy's neutral name.
NEUTRAL = {
    "Read": "read_file",
    "Write": "write_file",
    "Edit": "edit_file",
    "Glob": "search",
    "Grep": "search",
}


def scripts(tree: Path) -> dict[str, list[Turn]]:
    """Each scenario's scripted model, with paths inside ``tree``."""
    t = str(tree)
    greet = {
        "file_path": f"{t}/src/greet.py",
        "content": "def greet():\n    return 'hi'\n",
    }
    return {
        "halt": [
            Turn(
                "I'll read the README first.",
                [("Read", {"file_path": f"{t}/README.md"})],
            ),
            Turn(None, [("Write", greet)]),
            Turn(
                "CI should run the new test.",
                [
                    (
                        "Write",
                        {
                            "file_path": f"{t}/.github/workflows/ci.yml",
                            "content": "on: push\n",
                        },
                    )
                ],
            ),
            Turn(
                None,
                [("Write", {"file_path": f"{t}/src/after.py", "content": "x = 1\n"})],
            ),
            Turn("Done."),
        ],
        "deny-continue": [
            Turn(
                None,
                [("Write", {"file_path": f"{t}/../escape.txt", "content": "out\n"})],
            ),
            Turn(None, [("Bash", {"command": f"touch {t}/pwned"})]),
            Turn(
                None,
                [
                    (
                        "Write",
                        {
                            "file_path": f"{t}/.git/hooks/pre-commit",
                            "content": "#!/bin/sh\n",
                        },
                    )
                ],
            ),
            Turn(
                None,
                [("Write", {"file_path": f"{t}/src/ok.py", "content": "ok = 1\n"})],
            ),
            Turn("Done."),
        ],
        "pause-resume": [
            Turn("Reading.", [("Read", {"file_path": f"{t}/README.md"})]),
            Turn(None, [("Write", greet)]),
            Turn(None, [("Write", greet)]),
            Turn("Done."),
        ],
    } | {
        "hook-timeout": [Turn(None, [("Write", greet)]), Turn("Done.")],
        "hook-raises": [Turn(None, [("Write", greet)]), Turn("Done.")],
        "hook-raises-ci": [
            Turn(
                None,
                [
                    (
                        "Write",
                        {
                            "file_path": f"{t}/.github/workflows/ci.yml",
                            "content": "on: push\n",
                        },
                    )
                ],
            ),
            Turn("Done."),
        ],
        "resume-elsewhere": [
            Turn("Reading.", [("Read", {"file_path": f"{t}/README.md"})]),
            Turn(None, [("Write", greet)]),
            Turn(None, [("Write", greet)]),
            Turn("Done."),
        ],
    }


class Recorder:
    """Maps what the harness shows into DH.1 events, in arrival order."""

    def __init__(self, ctx: StageContext) -> None:
        """Start an empty stream for ``ctx``."""
        self.ctx = ctx
        self.events: list[Any] = []
        self.pending: dict[str, ToolRequest] = {}
        self.hook_calls: list[dict[str, Any]] = []
        self.stop_at: str | None = (
            None  # "pause" makes the hook stop at the first write
        )
        self.fault: str | None = None  # "timeout" or "raises" on the first write

    def _add(self, cls: type[Any], **fields: Any) -> None:
        self.events.append(
            cls(
                seq=len(self.events) + 1,
                stage_key=self.ctx.stage_key,
                attempt=self.ctx.attempt,
                ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                **fields,
            )
        )

    async def pre_tool_use(
        self, input_data: dict[str, Any], tool_use_id: str | None, _context: Any
    ) -> dict[str, Any]:
        """The PreToolUse hook: the engine's policy decides; a deny halts."""
        name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {}) or {}
        path = tool_input.get("file_path") or tool_input.get("path")
        request = ToolRequest(
            call_id=tool_use_id or f"hook-{len(self.hook_calls)}",
            tool=NEUTRAL.get(name, name.lower()),
            paths=() if path is None else (str(path),),
        )
        if self.fault and request.tool in WRITE_TOOLS:
            fault, self.fault = self.fault, None
            self.hook_calls.append({"tool": name, "fault": fault})
            if fault == "timeout":
                await asyncio.sleep(HOOK_TIMEOUT_S * 5)
            else:
                raise RuntimeError("policy store unavailable")
        verdict = evaluate(self.ctx.policy, request)
        self.hook_calls.append(
            {"tool": name, "decision": verdict.decision, "rule": verdict.rule}
        )
        self._add(ToolRequestEvent, request=request)
        if self.stop_at == "pause" and request.tool in WRITE_TOOLS:
            self.stop_at = None
            self.events.pop()  # the paused call is re-issued after resume
            return {
                "continue_": False,
                "stopReason": "paused",
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "The stage is paused.",
                },
            }
        if verdict.halts:
            self._add(
                ToolResultEvent,
                call_id=request.call_id,
                tool=request.tool,
                verdict=verdict,
                ok=False,
            )
            out: dict[str, Any] = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": verdict.reason,
                }
            }
            if self.halt_on_deny:
                out |= {"continue_": False, "stopReason": verdict.reason}
            return out
        self.pending[request.call_id] = request
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }

    halt_on_deny = True

    def message(self, message: Any) -> None:
        """Record a message the harness streamed."""
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    self._add(ModelTurn, model_id=message.model, text=block.text)
            usage = message.usage or {}
            if usage:
                self._add(
                    Usage,
                    provider="anthropic",
                    model=message.model,
                    tokens_in=int(usage.get("input_tokens", 0)),
                    tokens_out=int(usage.get("output_tokens", 0)),
                )
        elif isinstance(message, UserMessage) and isinstance(message.content, list):
            for block in message.content:
                if not isinstance(block, ToolResultBlock):
                    continue
                request = self.pending.pop(block.tool_use_id, None)
                if request is None:
                    continue
                ok = not block.is_error
                self._add(
                    ToolResultEvent,
                    call_id=request.call_id,
                    tool=request.tool,
                    verdict=evaluate(self.ctx.policy, request),
                    ok=ok,
                )
                if ok and request.tool in WRITE_TOOLS:
                    relative = resolve_in_tree(
                        self.ctx.policy.working_tree, request.paths[0]
                    )
                    self._add(FileChange, path=relative, status="added")


#: The harness permission mode, from ``--permission-mode``; ``None`` is the SDK's default.
PERMISSION_MODE: str | None = None


def options(
    tree: Path, config: Path, port: int, recorder: Recorder, resume: str | None
):
    """The harness options: L5, isolated, pointed at the stub."""
    return ClaudeAgentOptions(
        cwd=str(tree),
        permission_mode=PERMISSION_MODE,
        tools=HARNESS_TOOLS,
        setting_sources=[],
        resume=resume,
        max_turns=12,
        model="claude-sonnet-5-5",
        env={
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}",
            "ANTHROPIC_API_KEY": "ouro-run-scoped-stub-credential",
            "CLAUDE_CONFIG_DIR": str(config),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        },
        hooks={
            "PreToolUse": [
                HookMatcher(
                    matcher=None,
                    hooks=[recorder.pre_tool_use],
                    timeout=HOOK_TIMEOUT_S if recorder.fault else None,
                )
            ]
        },
    )


async def session(
    opts: ClaudeAgentOptions, prompt: str, recorder: Recorder
) -> dict[str, Any]:
    """One client session to its result."""
    started = time.monotonic()
    result: ResultMessage | None = None
    async with ClaudeSDKClient(options=opts) as client:
        await client.query(prompt)
        async for message in client.receive_response():
            recorder.message(message)
            if isinstance(message, ResultMessage):
                result = message
    return {
        "wall_clock_ms": round((time.monotonic() - started) * 1000),
        "result": None
        if result is None
        else {
            "subtype": result.subtype,
            "is_error": result.is_error,
            "num_turns": result.num_turns,
            "duration_ms": result.duration_ms,
            "duration_api_ms": result.duration_api_ms,
            "session_id": result.session_id,
            "stop_reason": result.stop_reason,
            "terminal_reason": getattr(result, "terminal_reason", None),
            "usage": result.usage,
            "total_cost_usd": result.total_cost_usd,
            "permission_denials": len(result.permission_denials or []),
        },
    }


async def run(scenario: str) -> dict[str, Any]:
    """Run one scenario in a fresh sandbox and return its measurements."""
    with tempfile.TemporaryDirectory(prefix="ouro-dh1-") as scratch:
        root = Path(scratch)
        tree = root / "sandbox"
        (tree / "src").mkdir(parents=True)
        (tree / ".git" / "hooks").mkdir(parents=True)
        (tree / "README.md").write_text("# sandbox\n\nAdd greet() to src/greet.py.\n")
        config = root / "claude-config"
        config.mkdir()
        facade = Facade(scripts(tree)[scenario])
        server = serve(facade)
        port = server.server_address[1]
        ctx = StageContext(
            run_id="dh1-prototype",
            stage_key="implement",
            attempt=1,
            prompt="Add greet() to src/greet.py.",
            model="claude-sonnet-5-5",
            policy=ToolPolicy(
                working_tree=str(tree),
                permissions=LlmPermissions(push_fixup=False, touch_ci=False),
                protected_paths=("boot/**",),
            ),
        )
        recorder = Recorder(ctx)
        recorder.halt_on_deny = scenario == "halt"
        if scenario.startswith("hook-"):
            recorder.fault = "timeout" if scenario == "hook-timeout" else "raises"
        resuming = scenario in ("pause-resume", "resume-elsewhere")
        if resuming:
            recorder.stop_at = "pause"
        sessions = [
            await session(
                options(tree, config, port, recorder, None), ctx.prompt, recorder
            )
        ]
        if resuming:
            if scenario == "resume-elsewhere":
                config = root / "claude-config-elsewhere"
                config.mkdir()
            first = sessions[0]["result"]
            resume_id = first["session_id"] if first else None
            mark = len(facade.requests)
            try:
                sessions.append(
                    await session(
                        options(tree, config, port, recorder, resume_id),
                        "Resume.",
                        recorder,
                    )
                )
            except Exception as error:  # the failure is the measurement
                sessions.append({"error": f"{type(error).__name__}: {error}"[:2000]})
            resumed = [r for r in facade.requests[mark:] if r.get("main")]
            sessions[-1]["first_resumed_request_messages"] = (
                resumed[0]["messages"] if resumed else None
            )
        server.shutdown()
        landed = {
            str(p.relative_to(root)): True
            for p in sorted(root.rglob("*"))
            if p.is_file()
            and not p.relative_to(root).parts[0].startswith("claude-config")
        }
        return {
            "scenario": scenario,
            "sessions": sessions,
            "hook_calls": recorder.hook_calls,
            "facade_requests": [
                {k: v for k, v in r.items() if k != "at"} for r in facade.requests
            ],
            "files_on_disk": sorted(landed),
            "events": [e.model_dump(mode="json") for e in recorder.events],
            "conformance": check_stream(ctx, recorder.events),
        }


def main() -> None:
    """Run the named scenarios and write their results."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "scenarios",
        nargs="*",
        default=[
            "halt",
            "deny-continue",
            "pause-resume",
            "resume-elsewhere",
            "hook-timeout",
            "hook-raises",
            "hook-raises-ci",
        ],
    )
    parser.add_argument("--permission-mode", default=None)
    args = parser.parse_args()
    global PERMISSION_MODE  # noqa: PLW0603 — one run, one mode
    PERMISSION_MODE = args.permission_mode
    suffix = f".{args.permission_mode}" if args.permission_mode else ""
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    for scenario in args.scenarios:
        result = asyncio.run(run(scenario))
        result["permission_mode"] = args.permission_mode
        (out / f"{scenario}{suffix}.json").write_text(
            json.dumps(result, indent=2) + "\n"
        )
        print(
            json.dumps(
                {
                    k: result[k]
                    for k in ("scenario", "hook_calls", "files_on_disk", "conformance")
                }
            )
        )
        for s in result["sessions"]:
            print("  ", json.dumps(s))


if __name__ == "__main__":
    main()
