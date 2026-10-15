"""The vocabulary's mapping onto AP.1's ingestion shapes."""

from ouroboros_engine.control_plane.ingest import IngestEvent, IngestEventsRequest
from ouroboros_engine.execution.events import (
    EVENT_KINDS,
    EVENT_TYPES,
    FileChange,
    ModelTurn,
    ToolRequestEvent,
    ToolResultEvent,
    Usage,
)
from ouroboros_engine.execution.ingest import (
    MAX_BODY,
    to_change_set,
    to_spend,
    to_transcript,
)
from ouroboros_engine.execution.policy import ToolRequest, ToolVerdict

BASE = {"stage_key": "implement", "attempt": 2, "ts": "2026-10-14T09:00:00Z"}


def _file(seq: int, path: str, status: str, additions: int = 1) -> FileChange:
    return FileChange(
        seq=seq, path=path, status=status, additions=additions, deletions=0, **BASE
    )


def test_the_vocabulary_is_five_kinds() -> None:
    assert tuple(t.model_fields["kind"].default for t in EVENT_TYPES) == EVENT_KINDS


def test_a_model_turn_keeps_its_provenance() -> None:
    entry = to_transcript(
        ModelTurn(seq=4, model_id="claude-sonnet-5-5", text="Reading.", **BASE)
    )
    assert entry == IngestEvent(
        hint=4,
        actor="model",
        model_id="claude-sonnet-5-5",
        body="Reading.",
        **BASE,
    )


def test_tool_request_and_result_share_a_call_id() -> None:
    request = to_transcript(
        ToolRequestEvent(
            seq=5,
            request=ToolRequest(call_id="t1", tool="write_file", paths=("src/a.py",)),
            **BASE,
        )
    )
    verdict = ToolVerdict(
        decision="deny",
        rule="protected_path",
        reason="The path is protected in this workspace.",
        path="boot/a",
        glob="boot/**",
    )
    result = to_transcript(
        ToolResultEvent(
            seq=6, call_id="t1", tool="write_file", verdict=verdict, ok=False, **BASE
        )
    )
    assert request is not None
    assert result is not None
    assert (request.actor, request.tool_tag, request.body) == (
        "tool",
        "write_file",
        "write_file src/a.py",
    )
    assert request.payload == {
        "phase": "request",
        "call_id": "t1",
        "paths": ["src/a.py"],
    }
    assert result.body == "The path is protected in this workspace."
    assert result.payload is not None
    assert result.payload["verdict"] == {
        "decision": "deny",
        "rule": "protected_path",
        "reason": "The path is protected in this workspace.",
        "path": "boot/a",
        "glob": "boot/**",
    }
    # Both are valid members of one AP.1 batch, in order.
    IngestEventsRequest(idempotency_key="k", events=[request, result])


def test_a_long_body_is_clipped_to_ap1s_bound() -> None:
    entry = to_transcript(
        ModelTurn(seq=1, model_id="m", text="x" * (MAX_BODY + 50), **BASE)
    )
    assert entry is not None
    assert entry.body is not None
    assert len(entry.body) == MAX_BODY
    assert entry.body.endswith("…")


def test_file_changes_and_usage_are_not_transcript_entries() -> None:
    assert to_transcript(_file(1, "a", "added")) is None
    usage = Usage(
        seq=2, provider="anthropic", model="m", tokens_in=1, tokens_out=2, **BASE
    )
    assert to_transcript(usage) is None


def test_the_change_set_folds_like_git() -> None:
    events = [
        _file(1, "new.py", "added", 3),
        _file(2, "new.py", "modified", 5),
        _file(3, "old.py", "modified"),
        _file(4, "tmp.py", "added"),
        _file(5, "tmp.py", "deleted"),
        _file(6, "gone.py", "deleted"),
    ]
    files = to_change_set(events)
    assert [(f.path, f.status, f.additions) for f in files] == [
        ("gone.py", "deleted", 1),
        ("new.py", "added", 5),
        ("old.py", "modified", 1),
    ]


def test_usage_is_an_unpriced_spend() -> None:
    spend = to_spend(
        Usage(
            seq=9,
            provider="anthropic",
            model="claude-sonnet-5-5",
            tokens_in=1200,
            tokens_out=80,
            latency_ms=900,
            **BASE,
        )
    )
    assert (spend.tokens_in, spend.tokens_out, spend.latency_ms) == (1200, 80, 900)
    assert spend.cost_cents is None
    assert spend.occurred_at == BASE["ts"]


def test_usage_is_attributed_to_its_stage_and_attempt() -> None:
    # #91: a run's spend reads by stage — the event knows which, and the report now says so.
    spend = to_spend(
        Usage(
            seq=9,
            provider="anthropic",
            model="claude-sonnet-5-5",
            tokens_in=1,
            tokens_out=1,
            **BASE,
        )
    )
    assert (spend.stage, spend.attempt) == (BASE["stage_key"], BASE["attempt"])
    assert (
        spend.model_dump(by_alias=True, exclude_none=True)["stage"] == BASE["stage_key"]
    )
