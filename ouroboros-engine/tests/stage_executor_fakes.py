"""Scripted stage executors for the SPI's tests and the conformance kit.

A :class:`FakeExecutor` plays a :class:`Script` — model turns and tool calls — against a
real working tree, asking :func:`~ouroboros_engine.execution.policy.evaluate` before every
tool call exactly as a real executor must. Two kinds are offered:

* :class:`FakeNativeExecutor` names its tools in the neutral vocabulary already.
* :class:`FakeHarnessExecutor` names them as a harness does (``Write``, ``Read``, with an
  absolute ``file_path``) and translates at a pre-tool hook, which is the seat DH.3 uses.

:class:`RogueExecutor` breaks one rule on purpose, so the kit can be shown to catch it.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Literal

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

#: Every fake event's timestamp — the fakes do not read the clock.
FAKE_TS = "2026-10-14T09:00:00Z"

#: The model a fake turn is attributed to.
FAKE_MODEL = "claude-sonnet-5-5"


@dataclass(frozen=True)
class Say:
    """A model turn: the model says ``text``."""

    text: str


@dataclass(frozen=True)
class Call:
    """A tool call in the neutral vocabulary; ``content`` is what a write writes."""

    tool: str
    path: str | None = None
    content: str = ""


Step = Say | Call


@dataclass
class Script:
    """What a fake executor will do, in order."""

    steps: list[Step] = field(default_factory=list)


#: A harness's names for the neutral tools — the translation a pre-tool hook makes.
HARNESS_NAMES: dict[str, str] = {
    "read_file": "Read",
    "write_file": "Write",
    "edit_file": "Edit",
    "list_dir": "LS",
    "search": "Grep",
}
_FROM_HARNESS = {native: neutral for neutral, native in HARNESS_NAMES.items()}


class FakeExecutor(StageExecutor):
    """Plays a script; pauses and aborts at the boundary before each tool call."""

    kind: ClassVar[ExecutorKind] = "native"

    def __init__(self, script: Script) -> None:
        """Hold the script.

        Args:
            script: The steps to play.
        """
        self._script = script
        self._pause = False
        self._abort = False
        self._outcome: StageOutcome | None = None
        self._seq = 0

    def capabilities(self) -> ExecutorCapabilities:
        """A tool loop that resumes, steers nothing, and serves any provider."""
        return ExecutorCapabilities(
            tools=True, resume=True, steer=False, provider_neutral=True
        )

    def pause(self) -> None:
        """Pause at the next boundary."""
        self._pause = True

    def abort(self) -> None:
        """Abort at the next boundary."""
        self._abort = True

    @property
    def outcome(self) -> StageOutcome | None:
        """How the stream ended."""
        return self._outcome

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Play the script from the top."""
        return self._play(ctx, start=0, next_seq=1)

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Play the script from where the checkpoint stopped."""
        if checkpoint.executor_kind != self.kind:
            raise ExecutorCapabilityError("checkpoint written by another executor kind")
        return self._play(
            checkpoint.context,
            start=int(checkpoint.state.get("step", 0)),
            next_seq=checkpoint.next_seq,
        )

    def native_request(
        self, ctx: StageContext, call: Call, call_id: str
    ) -> ToolRequest:
        """The policy request for one call — overridden by the harness fake's hook."""
        del ctx
        return ToolRequest(
            call_id=call_id,
            tool=call.tool,
            paths=() if call.path is None else (call.path,),
        )

    def _event(self, cls: type[Any], ctx: StageContext, **fields: Any) -> Any:
        """Stamp the next ``seq`` and the attempt on an event."""
        self._seq += 1
        return cls(
            seq=self._seq,
            stage_key=ctx.stage_key,
            attempt=ctx.attempt,
            ts=FAKE_TS,
            **fields,
        )

    async def _play(
        self, ctx: StageContext, start: int, next_seq: int
    ) -> AsyncIterator[StageEvent]:
        """The loop: say, or ask the policy and then run the tool."""
        self._seq = next_seq - 1
        root = Path(ctx.policy.working_tree)
        for index in range(start, len(self._script.steps)):
            step = self._script.steps[index]
            if isinstance(step, Say):
                yield self._event(ModelTurn, ctx, model_id=FAKE_MODEL, text=step.text)
                yield self._event(
                    Usage,
                    ctx,
                    provider="anthropic",
                    model=FAKE_MODEL,
                    tokens_in=100,
                    tokens_out=10,
                )
                continue
            # The safe boundary: before the next tool call runs.
            if self._abort:
                self._outcome = StageOutcome(status="aborted")
                return
            if self._pause:
                self._outcome = StageOutcome(
                    status="paused",
                    checkpoint=Checkpoint(
                        executor_kind=self.kind,
                        context=ctx,
                        next_seq=self._seq + 1,
                        state={"step": index},
                    ),
                )
                return
            call_id = f"call-{index}"
            request = self.native_request(ctx, step, call_id)
            yield self._event(ToolRequestEvent, ctx, request=request)
            verdict = evaluate(ctx.policy, request)
            if verdict.halts:
                yield self._event(
                    ToolResultEvent,
                    ctx,
                    call_id=call_id,
                    tool=request.tool,
                    verdict=verdict,
                    ok=False,
                )
                self._outcome = StageOutcome(status="halted", verdict=verdict)
                return
            output = None
            relative = None
            if step.path is not None:
                relative = resolve_in_tree(str(root), step.path)
            if request.tool in WRITE_TOOLS and relative is not None:
                target = root / relative
                existed = target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(step.content)
            elif request.tool == "read_file" and relative is not None:
                output = (root / relative).read_text()
            yield self._event(
                ToolResultEvent,
                ctx,
                call_id=call_id,
                tool=request.tool,
                verdict=verdict,
                ok=True,
                output=output,
            )
            if request.tool in WRITE_TOOLS and relative is not None:
                yield self._event(
                    FileChange,
                    ctx,
                    path=relative,
                    status="modified" if existed else "added",
                    additions=len(step.content.splitlines()),
                    deletions=0,
                )
        self._outcome = StageOutcome(status="completed")


class FakeNativeExecutor(FakeExecutor):
    """The native kind: tools are named in the neutral vocabulary."""

    kind: ClassVar[ExecutorKind] = "native"


class FakeHarnessExecutor(FakeExecutor):
    """The harness kind: tools arrive harness-named, with absolute paths, at a hook."""

    kind: ClassVar[ExecutorKind] = "harness"

    def capabilities(self) -> ExecutorCapabilities:
        """A Claude-only harness."""
        return ExecutorCapabilities(
            tools=True, resume=True, steer=False, provider_neutral=False
        )

    def native_request(
        self, ctx: StageContext, call: Call, call_id: str
    ) -> ToolRequest:
        """Translate what the harness's pre-tool hook receives into a policy request."""
        hook_input = harness_hook_input(ctx, call)
        return hook_request(hook_input, call_id)


def harness_hook_input(ctx: StageContext, call: Call) -> dict[str, Any]:
    """What a harness hands its pre-tool hook for a call: its name, an absolute path."""
    tool_input: dict[str, Any] = {}
    if call.path is not None:
        tool_input["file_path"] = str(Path(ctx.policy.working_tree) / call.path)
    return {
        "tool_name": HARNESS_NAMES.get(call.tool, call.tool.capitalize()),
        "tool_input": tool_input,
    }


def hook_request(hook_input: dict[str, Any], call_id: str) -> ToolRequest:
    """The policy request for a harness hook's input — untranslatable names pass through."""
    name = str(hook_input["tool_name"])
    file_path = hook_input["tool_input"].get("file_path")
    return ToolRequest(
        call_id=call_id,
        tool=_FROM_HARNESS.get(name, name.lower()),
        paths=() if file_path is None else (str(file_path),),
    )


class Reasoning(ModelTurn):
    """An event outside the vocabulary: synthesised narration."""

    kind: Literal["reasoning"] = "reasoning"  # type: ignore[assignment]


@dataclass(frozen=True)
class Rogue:
    """Which rule the rogue breaks."""

    rule: Literal["vocabulary", "skips_policy", "wrong_stage", "no_outcome"]


class RogueExecutor(FakeNativeExecutor):
    """A fake that breaks one SPI rule, so the conformance kit can be seen to fail it."""

    def __init__(self, script: Script, rogue: Rogue) -> None:
        """Hold the script and the rule to break."""
        super().__init__(script)
        self._rogue = rogue

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Play, then break the rule."""
        return self._misbehave(ctx)

    async def _misbehave(self, ctx: StageContext) -> AsyncIterator[Any]:
        """The broken stream."""
        rule = self._rogue.rule
        if rule == "vocabulary":
            yield Reasoning(
                seq=1,
                stage_key=ctx.stage_key,
                attempt=ctx.attempt,
                ts=FAKE_TS,
                model_id=FAKE_MODEL,
                text="Let me think about how to fix this.",
            )
            self._seq = 1
        async for event in self._play(ctx, start=0, next_seq=self._seq + 1):
            if rule == "skips_policy" and isinstance(event, ToolResultEvent):
                event = event.model_copy(
                    update={
                        "verdict": event.verdict.model_copy(
                            update={"decision": "allow", "rule": None}
                        ),
                        "ok": True,
                    }
                )
            if rule == "wrong_stage":
                event = event.model_copy(update={"stage_key": "elsewhere"})
            yield event
        if rule == "no_outcome":
            self._outcome = None
