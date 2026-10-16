"""One Claude Agent attempt as the engine sees it: the policy hook and the event mapping.

DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_). :class:`AttemptRecorder`
sits at the harness's two seams — its one ``PreToolUse`` hook and its message stream — and
turns what it observes into DH.1's events, in one ``seq`` order, on one queue:

=================================== ===========================================================
the harness shows                   the engine records
=================================== ===========================================================
a ``TextBlock``                     ``model_turn``, the text verbatim
a ``ThinkingBlock``                 ``model_turn``, the thinking as received
a ``PreToolUse`` hook call          the policy's verdict. A ``deny`` is reported at once
                                    (``tool_request`` + ``tool_result``) and halts the session;
                                    an ``allow`` is held until the tool's result
a ``ToolResultBlock``               ``tool_request`` + ``tool_result`` for the allowed call,
                                    then ``file_change`` after a successful write or edit
a ``ToolUseBlock`` for a tool that  ``tool_request`` + its ``deny`` — it never reaches the
was never offered (``Bash``)        hook, because the harness refuses it itself — and a halt
=================================== ===========================================================

There is no ``usage`` event: the DH.2 facade meters every call into ``token_usage`` itself,
and the attempt reconciles the SDK's totals against it at session end instead.

A request and its result are reported **together**, so the pair is adjacent in the stream
even when the model asks for several tools at once and the harness runs them in parallel.

**The hook fails closed.** Any exception — in translating the call, in the policy, anywhere
— answers ``deny`` with ``continue: false``; the policy is given a deadline shorter than the
SDK's own hook timeout, and missing it is a ``deny`` the recorder writes down itself (the
harness, on its own timeout, skips the tool but reports no denial). Pause and abort answer
at the same seat: the pending call is refused, not run, and the session stops.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from ouroboros_engine.execution.events import (
    FileChange,
    ModelTurn,
    StageEvent,
    ToolRequestEvent,
    ToolResultEvent,
)
from ouroboros_engine.execution.executors.claude_agent_tools import (
    OFFERED_TOOLS,
    file_status,
    to_request,
)
from ouroboros_engine.execution.policy import (
    WRITE_TOOLS,
    ToolPolicy,
    ToolRequest,
    ToolVerdict,
)
from ouroboros_engine.execution.spi import StageContext

_log = logging.getLogger(__name__)

#: The model name the harness puts on a message it wrote itself, such as an API error.
SYNTHETIC_MODEL = "<synthetic>"

#: Why a session was stopped by the engine rather than by finishing.
StopKind = Literal["halted", "paused", "aborted"]

#: The policy, as the recorder calls it — :func:`~ouroboros_engine.execution.policy.evaluate`.
Evaluate = Callable[[ToolPolicy, ToolRequest], ToolVerdict]

#: Writes one user turn into the running session (``ClaudeSDKClient.query``).
Deliver = Callable[[str], Awaitable[None]]


def _now() -> str:
    """The current time, ISO 8601 in UTC.

    Returns:
        The timestamp.
    """
    return datetime.now(UTC).isoformat()


def _text(content: Any) -> str | None:
    """A tool result's content as text.

    Args:
        content: A ``ToolResultBlock``'s content — a string, a list of blocks, or ``None``.

    Returns:
        The text, the list's text blocks joined, or ``None`` when there is none.
    """
    if content is None:
        return None
    if isinstance(content, str):
        return content
    parts = [
        str(block.get("text", ""))
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    return "\n".join(parts) if parts else None


@dataclass(frozen=True)
class _Allowed:
    """A call the policy allowed, waiting for its result.

    Attributes:
        request: The request.
        verdict: The policy's ``allow``.
        change: The tree-relative path and ``added``/``modified``, for a write.
    """

    request: ToolRequest
    verdict: ToolVerdict
    change: tuple[str, Literal["added", "modified"]] | None


def _refusal(reason: str) -> dict[str, Any]:
    """The hook's answer that refuses the pending call and stops the session.

    Args:
        reason: One sentence, for the model and the session's stop reason.

    Returns:
        ``deny`` with ``continue: false`` (``continue_`` is the SDK's Python spelling).
    """
    return {
        "continue_": False,
        "stopReason": reason,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


#: The hook's answer that lets the pending call run.
_ALLOW: dict[str, Any] = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
    }
}


class AttemptRecorder:
    """The engine's seat in one harness session. See the module.

    Attributes:
        ctx: The attempt's context.
        queue: The events, in ``seq`` order; ``None`` marks the end.
        stop: Why the engine stopped the session, once it has.
        verdict: The verdict that halted it.
        session_id: The harness's session id, once reported.
        result: The session's ``ResultMessage``, once it arrived.
        error: What went wrong, when the session failed outside the policy.
        pause_requested: The executor asked to pause.
        abort_requested: The executor asked to abort.
        steers: Guidance waiting to be delivered as the next user turn.
        deliver: Writes a user turn into the session while it runs.
    """

    def __init__(
        self,
        ctx: StageContext,
        *,
        first_seq: int,
        evaluate: Evaluate,
        policy_deadline: float,
    ) -> None:
        """Start an empty stream.

        Args:
            ctx: The attempt's context.
            first_seq: The first ``seq`` to use — 1, or a checkpoint's ``next_seq``.
            evaluate: The policy.
            policy_deadline: Seconds the policy may take before the call is refused.
        """
        self.ctx = ctx
        self.queue: asyncio.Queue[StageEvent | None] = asyncio.Queue()
        self.stop: StopKind | None = None
        self.verdict: ToolVerdict | None = None
        self.session_id: str | None = None
        self.result: ResultMessage | None = None
        self.error: str | None = None
        self.pause_requested = False
        self.abort_requested = False
        self.steers: list[str] = []
        self.deliver: Deliver | None = None
        self._seq = first_seq - 1
        self._evaluate = evaluate
        self._deadline = policy_deadline
        self._pending: dict[str, _Allowed] = {}

    @property
    def next_seq(self) -> int:
        """The ``seq`` the next event would get.

        Returns:
            One above the last one used.
        """
        return self._seq + 1

    # --- emitting -----------------------------------------------------------------------

    def _emit(self, cls: type[Any], **fields: Any) -> None:
        """Number one event and queue it.

        Args:
            cls: The event class.
            **fields: Its own fields.
        """
        self._seq += 1
        self.queue.put_nowait(
            cls(
                seq=self._seq,
                stage_key=self.ctx.stage_key,
                attempt=self.ctx.attempt,
                ts=_now(),
                **fields,
            )
        )

    def _report_denied(self, request: ToolRequest | None, verdict: ToolVerdict) -> None:
        """Report a refused call and halt.

        Args:
            request: The call, when it could be translated.
            verdict: The ``deny``.
        """
        self.stop = "halted"
        self.verdict = verdict
        if request is None:
            return
        self._emit(ToolRequestEvent, request=request)
        self._emit(
            ToolResultEvent,
            call_id=request.call_id,
            tool=request.tool,
            verdict=verdict,
            ok=False,
        )

    # --- the hook -----------------------------------------------------------------------

    async def pre_tool_use(
        self, input_data: dict[str, Any], tool_use_id: str | None, context: Any
    ) -> dict[str, Any]:
        """The harness's one ``PreToolUse`` hook, for every tool. Never raises.

        Args:
            input_data: The hook input — ``tool_name`` and ``tool_input``.
            tool_use_id: The call's id.
            context: The SDK's hook context (unused).

        Returns:
            ``allow``, or ``deny`` with ``continue: false``.
        """
        del context
        try:
            return await self._decide(input_data, tool_use_id)
        except Exception as error:  # the last line of the fail-closed rule
            _log.exception("the policy hook failed")
            self.stop = self.stop or "halted"
            if self.verdict is None and self.stop == "halted":
                self.verdict = ToolVerdict(
                    decision="deny",
                    reason=f"The tool policy failed ({type(error).__name__}); the tool "
                    "was not run.",
                )
            return _refusal("The tool policy failed; the tool was not run.")

    async def _decide(
        self, input_data: dict[str, Any], tool_use_id: str | None
    ) -> dict[str, Any]:
        """Decide one call: stop requests first, then the policy under its deadline.

        Args:
            input_data: The hook input.
            tool_use_id: The call's id.

        Returns:
            The hook's answer.
        """
        if self.stop is not None:
            return _refusal("The stage has stopped.")
        if self.abort_requested:
            self.stop = "aborted"
            return _refusal("The stage was aborted.")
        if self.pause_requested:
            self.stop = "paused"
            return _refusal("The stage is paused.")
        request: ToolRequest | None = None
        try:
            name = str(input_data.get("tool_name") or "")
            tool_input = input_data.get("tool_input") or {}
            call_id = str(
                tool_use_id or input_data.get("tool_use_id") or f"hook-{self.next_seq}"
            )
            request = to_request(name, tool_input, call_id)
            verdict, change = await asyncio.wait_for(
                asyncio.to_thread(self._judge, request), self._deadline
            )
        except TimeoutError:
            verdict = ToolVerdict(
                decision="deny",
                reason=f"The tool policy did not answer within {self._deadline:g} s; "
                "the tool was not run.",
            )
            self._report_denied(request, verdict)
            return _refusal(verdict.reason)
        except Exception as error:
            _log.warning("the policy hook refused a call it could not judge: %r", error)
            verdict = ToolVerdict(
                decision="deny",
                reason=f"The tool policy failed ({type(error).__name__}); the tool was "
                "not run.",
            )
            self._report_denied(request, verdict)
            return _refusal(verdict.reason)
        if verdict.halts:
            self._report_denied(request, verdict)
            return _refusal(verdict.reason)
        self._pending[request.call_id] = _Allowed(request, verdict, change)
        await self._deliver_steers()
        return _ALLOW

    def _judge(
        self, request: ToolRequest
    ) -> tuple[ToolVerdict, tuple[str, Literal["added", "modified"]] | None]:
        """Ask the policy, and for an allowed write whether it adds or modifies.

        Runs in a worker thread, so the deadline holds even over a policy that blocks.

        Args:
            request: The call.

        Returns:
            The verdict, and the write's path and status (``None`` for anything else).
        """
        verdict = self._evaluate(self.ctx.policy, request)
        change = None
        if not verdict.halts and request.tool in WRITE_TOOLS and request.paths:
            change = file_status(self.ctx.policy.working_tree, request.paths[0])
        return verdict, change

    async def _deliver_steers(self) -> None:
        """Write any queued guidance into the session, at the tool boundary.

        Delivered mid-turn, the harness folds it into the model's next request.
        """
        while self.steers and self.deliver is not None and self.stop is None:
            await self.deliver(self.steers.pop(0))

    # --- the message stream -------------------------------------------------------------

    def on_message(self, message: Any) -> bool:
        """Record one message the harness streamed.

        Args:
            message: An SDK message.

        Returns:
            ``True`` when the engine must stop the session now (a call to a tool that was
            never offered).
        """
        if isinstance(message, SystemMessage):
            if message.subtype == "init":
                reported = message.data.get("session_id")
                if isinstance(reported, str) and reported:
                    self.session_id = reported
            return False
        if isinstance(message, ResultMessage):
            self.result = message
            self.session_id = self.session_id or message.session_id
            return False
        if self.stop is not None:
            return False
        if isinstance(message, AssistantMessage):
            return self._assistant(message)
        if isinstance(message, UserMessage) and isinstance(message.content, list):
            for block in message.content:
                if isinstance(block, ToolResultBlock):
                    self._tool_result(block)
        return False

    def _assistant(self, message: AssistantMessage) -> bool:
        """Record an assistant message's text, thinking and unoffered calls.

        Args:
            message: The message.

        Returns:
            ``True`` when it asked for a tool that was never offered.
        """
        if message.session_id:
            self.session_id = self.session_id or message.session_id
        if message.model == SYNTHETIC_MODEL or message.error is not None:
            # The harness's own words (an API error it narrates), not a model's: kept out
            # of the transcript, as the provenance rule says. The result carries the error.
            return False
        # Provenance (#315): the model the facade reports answered, never the stage's alias.
        # A message that names no model yields no model turn — nothing is synthesized.
        model = message.model
        for block in message.content:
            if not model and isinstance(block, (TextBlock, ThinkingBlock)):
                continue
            if isinstance(block, TextBlock) and block.text.strip():
                self._emit(ModelTurn, model_id=model, text=block.text)
            elif isinstance(block, ThinkingBlock) and block.thinking.strip():
                self._emit(ModelTurn, model_id=model, text=block.thinking)
            elif (
                isinstance(block, ToolUseBlock)
                and block.name not in OFFERED_TOOLS
                and self._unoffered(block)
            ):
                return True
        return False

    def _unoffered(self, block: ToolUseBlock) -> bool:
        """Record a call to a tool the harness was never offered.

        The harness refuses it itself, so it never reaches the hook; the policy is asked
        here so the transcript carries its verdict. A ``deny`` — every unoffered tool under
        L5's allow-list — halts the attempt.

        Args:
            block: The call.

        Returns:
            ``True`` when the attempt halts.
        """
        request = to_request(block.name, block.input or {}, block.id)
        try:
            verdict = self._evaluate(self.ctx.policy, request)
        except Exception as error:
            verdict = ToolVerdict(
                decision="deny",
                reason=f"The tool policy failed ({type(error).__name__}); the tool was "
                "not run.",
            )
        if verdict.halts:
            self._report_denied(request, verdict)
            return True
        # An allow-list wider than the harness's tools: allowed, but it did not run.
        self._emit(ToolRequestEvent, request=request)
        self._emit(
            ToolResultEvent,
            call_id=request.call_id,
            tool=request.tool,
            verdict=verdict,
            ok=False,
            output=f"{block.name} is not offered by the harness.",
        )
        return False

    def _tool_result(self, block: ToolResultBlock) -> None:
        """Report an allowed call with its result, and the file it changed.

        Args:
            block: The tool's result.
        """
        allowed = self._pending.pop(block.tool_use_id, None)
        if allowed is None:
            return
        ok = not block.is_error
        request = allowed.request
        self._emit(ToolRequestEvent, request=request)
        self._emit(
            ToolResultEvent,
            call_id=request.call_id,
            tool=request.tool,
            verdict=allowed.verdict,
            ok=ok,
            output=_text(block.content),
        )
        if ok and allowed.change is not None:
            path, status = allowed.change
            self._emit(FileChange, path=path, status=status)
