"""How a stage's model asks for a tool and hands in its result (CD.2, #560).

The gateway's payload is opaque to the control plane, so tool use is spelled in the reply's
text, the way the Workflow Copilot spells it: a fenced ``tool`` block per call, and one fenced
``result`` block when the stage is finished. :func:`parse_reply` reads both.

**A stage's result is data, not prose.** The harness composes the card's note lines itself
(:mod:`.notes`), so it asks for the few facts those lines are made of — the plan's steps, a
review's verdict and nits — and nothing it can measure on its own: which files were read,
what was written and how many lines changed are counted from the tools, never taken from
what a model says it did.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Final

from ouroboros_engine.copilot.prompt import TOOL_FENCE_CLOSE, TOOL_FENCE_OPEN

from .tools import render_manifest

#: The fence a finished stage's result is written in.
RESULT_FENCE_OPEN: Final = "```result"

#: The most tool calls one reply may carry; the rest are dropped and the model is told.
MAX_CALLS_PER_REPLY: Final = 8

#: The most items of a list in a result, and the most characters of one item.
MAX_ITEMS: Final = 20
MAX_ITEM_CHARS: Final = 300

ReviewVerdict = str  # ``approve`` or ``request_changes``


@dataclass(frozen=True, slots=True)
class ToolCall:
    """One call a reply asked for.

    Attributes:
        tool: The name, or ``""`` when the block did not parse.
        arguments: The arguments.
        error: Why the block could not be read, when it could not.
    """

    tool: str
    arguments: object = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Nit:
    """One remark of a review.

    Attributes:
        kind: What sort — ``style``, ``naming``, ``correctness`` … lower-case, one word.
        text: The remark.
    """

    kind: str
    text: str


@dataclass(frozen=True, slots=True)
class StageReport:
    """What a stage handed in.

    Attributes:
        summary: A sentence or two of what it concluded.
        steps: A plan's steps, in order. Empty for a stage that planned nothing.
        would_touch: The files a plan expects to change.
        verdict: A review's verdict, or ``None`` for a stage that reviewed nothing.
        nits: A review's remarks.
    """

    summary: str = ""
    steps: tuple[str, ...] = ()
    would_touch: tuple[str, ...] = ()
    verdict: ReviewVerdict | None = None
    nits: tuple[Nit, ...] = ()


@dataclass(frozen=True, slots=True)
class Reply:
    """One reply, read.

    Attributes:
        calls: The tool calls, in order.
        report: The result block, when the reply has one.
        dropped: How many calls past :data:`MAX_CALLS_PER_REPLY` were ignored.
    """

    calls: tuple[ToolCall, ...]
    report: StageReport | None
    dropped: int = 0


def system_prompt() -> str:
    """The rules every dry-run stage works under.

    Returns:
        The system prompt: what a dry run is, the tools that exist, how to call one and how
        to finish.
    """
    return f"""You are one stage of a software workflow, running as a DRY RUN.

Your reasoning is real; your side effects are not. You work in a virtual copy of the
repository at a pinned commit. Edits you make are held in memory as a simulated diff that
later stages can read. Nothing is written to the repository, no build or test is run, no
pull request is opened, and there is no network.

These are the only tools that exist:
{render_manifest()}

To call a tool, write a fenced block, one per call:
{TOOL_FENCE_OPEN}
{{"tool": "read_file", "arguments": {{"path": "src/main.c"}}}}
{TOOL_FENCE_CLOSE}

You will be given each call's result. Do not ask how long a build or a test takes and do
not state such a number yourself: `build` and `run_tests` answer from recorded history.

When the stage's work is done, finish with exactly one block:
{RESULT_FENCE_OPEN}
{{"summary": "what you concluded, in a sentence or two",
 "steps": ["for a plan: each step, in order"],
 "would_touch": ["for a plan: each file you expect to change"],
 "verdict": "for a review: approve or request_changes",
 "nits": [{{"kind": "style", "text": "for a review: each remark"}}]}}
{TOOL_FENCE_CLOSE}
Leave out the keys that do not apply to your stage."""


def parse_reply(text: str) -> Reply:
    """Read the tool calls and the result out of a reply.

    Args:
        text: Everything the model wrote.

    Returns:
        The calls in order and the result, if any. A ``tool`` block that is not a JSON
        object naming a tool is kept as a call with ``error`` set, so the model is told
        rather than ignored. A reply with no block at all has no calls and no report.
    """
    calls: list[ToolCall] = []
    report: StageReport | None = None
    fence: str | None = None
    lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if fence is None:
            if stripped in (TOOL_FENCE_OPEN, RESULT_FENCE_OPEN):
                fence, lines = stripped, []
            continue
        if stripped != TOOL_FENCE_CLOSE:
            lines.append(line)
            continue
        body = "\n".join(lines)
        if fence == TOOL_FENCE_OPEN:
            calls.append(_read_call(body))
        else:
            report = _read_report(body) or report
        fence = None

    kept = tuple(calls[:MAX_CALLS_PER_REPLY])
    return Reply(calls=kept, report=report, dropped=len(calls) - len(kept))


def _read_call(body: str) -> ToolCall:
    """Read one ``tool`` block.

    Args:
        body: The text between the fences.

    Returns:
        The call, or one carrying ``error``.
    """
    try:
        parsed = json.loads(body)
    except (ValueError, RecursionError):
        return ToolCall(tool="", error="The tool block was not valid JSON.")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("tool"), str):
        return ToolCall(
            tool="", error='A tool block is {"tool": name, "arguments": {…}}.'
        )
    return ToolCall(tool=parsed["tool"], arguments=parsed.get("arguments", {}))


def _read_report(body: str) -> StageReport | None:
    """Read the ``result`` block.

    Args:
        body: The text between the fences.

    Returns:
        The report, with anything malformed dropped field by field; ``None`` when the block
        is not a JSON object at all.
    """
    try:
        parsed = json.loads(body)
    except (ValueError, RecursionError):
        return None
    if not isinstance(parsed, dict):
        return None

    verdict = parsed.get("verdict")
    return StageReport(
        summary=_clip(parsed.get("summary"), 1000),
        steps=_strings(parsed.get("steps")),
        would_touch=_strings(parsed.get("would_touch")),
        verdict=verdict if verdict in ("approve", "request_changes") else None,
        nits=_nits(parsed.get("nits")),
    )


def _clip(value: Any, limit: int) -> str:
    """A string field, trimmed and bounded; ``""`` for anything else."""
    return value.strip()[:limit] if isinstance(value, str) else ""


def _strings(value: Any) -> tuple[str, ...]:
    """A list-of-strings field, with blanks and non-strings dropped and both bounds held."""
    if not isinstance(value, list):
        return ()
    kept = (_clip(item, MAX_ITEM_CHARS) for item in value)
    return tuple(item for item in kept if item)[:MAX_ITEMS]


def _nits(value: Any) -> tuple[Nit, ...]:
    """A review's remarks: ``{"kind", "text"}`` objects, or bare strings of no stated kind."""
    if not isinstance(value, list):
        return ()
    nits: list[Nit] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            nits.append(Nit(kind="", text=_clip(item, MAX_ITEM_CHARS)))
        elif isinstance(item, dict) and _clip(item.get("text"), MAX_ITEM_CHARS):
            kind = _clip(item.get("kind"), 24).lower()
            nits.append(
                Nit(
                    kind=kind if kind.isalpha() else "",
                    text=_clip(item.get("text"), MAX_ITEM_CHARS),
                )
            )
    return tuple(nits[:MAX_ITEMS])
