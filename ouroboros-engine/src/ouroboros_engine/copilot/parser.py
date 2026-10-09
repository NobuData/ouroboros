"""Recover reply text and structured tool calls from a streamed reply.

The model writes prose and fenced ``tool`` blocks (:mod:`.prompt`); the gateway hands the text
over in fragments of arbitrary size. This parser is fed those fragments and yields events as
soon as it can be sure of them: a prose line the moment its newline arrives, a tool call the
moment its closing fence does. Line-based on purpose — a fence is always a line of its own —
so a fragment that ends halfway through an opening fence is held, not misread.

**A call that does not validate is still a call.** It is yielded with ``error`` set and
``arguments`` unset, so ``ouroboros-rest`` bounces it like any invalid operation and the model
gets to correct it. Dropping it would drop the intent; raising would end the turn.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from ouroboros_engine.copilot.contract import (
    CopilotDelta,
    CopilotEvent,
    CopilotToolCall,
)
from ouroboros_engine.copilot.prompt import TOOL_FENCE_CLOSE, TOOL_FENCE_OPEN
from ouroboros_engine.copilot.tools import tool_named


class TurnParser:
    """A streaming parser over one reply.

    Feed it fragments with :meth:`feed`; call :meth:`finish` once the stream has ended.
    """

    def __init__(self) -> None:
        """Start empty, outside any fence."""
        self._pending = ""
        self._in_fence = False
        self._fence_lines: list[str] = []
        self._calls = 0

    def feed(self, text: str) -> list[CopilotEvent]:
        """Take one fragment.

        Args:
            text: The fragment, exactly as the provider sent it.

        Returns:
            Every event that became certain: prose lines, and calls whose fence closed.
        """
        self._pending += text
        events: list[CopilotEvent] = []
        while "\n" in self._pending:
            line, self._pending = self._pending.split("\n", 1)
            events.extend(self._line(line))
        return events

    def finish(self) -> list[CopilotEvent]:
        """Flush what the end of the stream makes certain.

        Returns:
            The last prose line without its newline, if any — or, for a fence the model never
            closed, one invalid call saying so.
        """
        events: list[CopilotEvent] = []
        if self._in_fence:
            self._fence_lines.append(self._pending)
            self._pending = ""
            events.append(
                self._call(
                    tool="unknown",
                    arguments=None,
                    error="the tool block was never closed with ``` — write one call per "
                    "fenced block and close the fence",
                )
            )
            self._in_fence = False
            self._fence_lines = []
        elif self._pending:
            events.append(CopilotDelta(kind="delta", text=self._pending))
            self._pending = ""
        return events

    def _line(self, line: str) -> list[CopilotEvent]:
        """Handle one complete line.

        Args:
            line: The line, without its newline.

        Returns:
            Zero or one event.
        """
        stripped = line.strip()
        if self._in_fence:
            if stripped == TOOL_FENCE_CLOSE:
                self._in_fence = False
                body = "\n".join(self._fence_lines)
                self._fence_lines = []
                return [self._parse_call(body)]
            self._fence_lines.append(line)
            return []
        if stripped == TOOL_FENCE_OPEN:
            self._in_fence = True
            return []
        return [CopilotDelta(kind="delta", text=line + "\n")]

    def _parse_call(self, body: str) -> CopilotToolCall:
        """Turn a closed fence's body into a call.

        Args:
            body: Everything between the fences.

        Returns:
            The call — validated, or carrying the reason it was not.
        """
        try:
            parsed = json.loads(body)
        except ValueError:
            return self._call(
                tool="unknown",
                arguments=None,
                error="the tool block is not valid JSON — write exactly "
                '{"tool": "<name>", "arguments": {...}}',
            )
        if not isinstance(parsed, dict) or not isinstance(parsed.get("tool"), str):
            return self._call(
                tool="unknown",
                arguments=None,
                error='the tool block must be an object with a string "tool" and an '
                '"arguments" object',
            )
        name = parsed["tool"]
        tool = tool_named(name)
        if tool is None:
            return self._call(
                tool=name,
                arguments=None,
                error=f"there is no tool named {name!r}; use one from the manifest",
            )
        raw = parsed.get("arguments", {})
        if not isinstance(raw, dict):
            return self._call(
                tool=name, arguments=None, error='"arguments" must be an object'
            )
        try:
            arguments = tool.arguments.model_validate(raw)
        except ValidationError as refused:
            problems = "; ".join(
                f"{'.'.join(str(part) for part in problem['loc']) or 'arguments'}: "
                f"{problem['msg']}"
                for problem in refused.errors()
            )
            return self._call(
                tool=name,
                arguments=None,
                error=f"{name} arguments are invalid — {problems}",
            )
        return self._call(
            tool=name, arguments=arguments.model_dump(by_alias=True), error=None
        )

    def _call(
        self, *, tool: str, arguments: dict | None, error: str | None
    ) -> CopilotToolCall:
        """Number and build one call event.

        Args:
            tool: The tool named.
            arguments: The validated arguments, or ``None``.
            error: Why it did not validate, or ``None``.

        Returns:
            The event, with the next id in this reply.
        """
        self._calls += 1
        return CopilotToolCall(
            kind="tool_call",
            id=f"call-{self._calls}",
            tool=tool,
            arguments=arguments,
            error=error,
        )
