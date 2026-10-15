"""The event vocabulary, mapped onto AP.1's run-ingestion shapes.

DH.1 (`#1302 <https://github.com/NobuData/ouroboros/issues/1302>`_) onto AP.1
(`#303 <https://github.com/NobuData/ouroboros/issues/303>`_). Pure functions: they build the
request bodies :mod:`~ouroboros_engine.control_plane.ingest` defines and send nothing. The
caller that sends them is #315's.

* ``model_turn``, ``tool_request`` and ``tool_result`` become transcript entries
  (:func:`to_transcript`), ``seq`` becoming the ordering ``hint``.
* ``file_change`` events fold into the **whole** change-set AP.1's ``PUT /files`` wants
  (:func:`to_change_set`).
* ``usage`` becomes one attributed spend each (:func:`to_spend`).
"""

from collections.abc import Iterable
from typing import Final

from ouroboros_engine.control_plane.ingest import IngestEvent, IngestFile, TokenSpend
from ouroboros_engine.execution.events import (
    FileChange,
    ModelTurn,
    StageEvent,
    ToolRequestEvent,
    ToolResultEvent,
    Usage,
)

#: AP.1's transcript body bound (``MAX_EVENT_BODY_LENGTH``).
MAX_BODY: Final = 20_000

#: The marker a truncated body ends with.
ELLIPSIS: Final = "…"


def _clip(text: str) -> str:
    """Fit a body inside AP.1's bound, marking the cut."""
    if len(text) <= MAX_BODY:
        return text
    return text[: MAX_BODY - len(ELLIPSIS)] + ELLIPSIS


def to_transcript(event: StageEvent) -> IngestEvent | None:
    """The transcript entry for one event.

    Args:
        event: Any event of the vocabulary.

    Returns:
        The entry, or ``None`` for a ``file_change`` or ``usage``, which AP.1 carries on
        its own operations rather than in the transcript.
    """
    common = {
        "hint": event.seq,
        "ts": event.ts,
        "stage_key": event.stage_key,
        "attempt": event.attempt,
    }
    if isinstance(event, ModelTurn):
        return IngestEvent(
            actor="model", model_id=event.model_id, body=_clip(event.text), **common
        )
    if isinstance(event, ToolRequestEvent):
        request = event.request
        return IngestEvent(
            actor="tool",
            tool_tag=request.tool,
            body=_clip(" ".join((request.tool, *request.paths))),
            payload={
                "phase": "request",
                "call_id": request.call_id,
                "paths": list(request.paths),
            },
            **common,
        )
    if isinstance(event, ToolResultEvent):
        verdict = event.verdict
        return IngestEvent(
            actor="tool",
            tool_tag=event.tool,
            body=_clip(event.output or verdict.reason),
            payload={
                "phase": "result",
                "call_id": event.call_id,
                "ok": event.ok,
                "verdict": verdict.model_dump(exclude_none=True),
            },
            **common,
        )
    return None


def to_change_set(events: Iterable[StageEvent]) -> list[IngestFile]:
    """Fold ``file_change`` events into the change-set as it now stands.

    A path's latest event decides its status, with two git-shaped exceptions: a file
    *added* and then modified is still ``added``, and a file added and then deleted is not
    in the change-set at all. Line counts are the latest event's.

    Args:
        events: An attempt's events, in ``seq`` order. Other kinds are ignored.

    Returns:
        One file per path, sorted by path.
    """
    files: dict[str, IngestFile] = {}
    for event in events:
        if not isinstance(event, FileChange):
            continue
        before = files.get(event.path)
        status = event.status
        if before is not None and before.status == "added":
            if status == "deleted":
                del files[event.path]
                continue
            status = "added"
        files[event.path] = IngestFile(
            path=event.path,
            status=status,
            additions=event.additions,
            deletions=event.deletions,
        )
    return [files[path] for path in sorted(files)]


def to_spend(event: Usage) -> TokenSpend:
    """The attributed spend for one ``usage`` event.

    Args:
        event: The usage.

    Returns:
        AP.1's spend, unpriced — pricing is the control plane's.
    """
    return TokenSpend(
        provider=event.provider,
        model=event.model,
        tokens_in=event.tokens_in,
        tokens_out=event.tokens_out,
        latency_ms=event.latency_ms,
        occurred_at=event.ts,
        # By stage and attempt (#91): the run's spend reads per stage in `token_usage`.
        stage=event.stage_key,
        attempt=event.attempt,
    )
