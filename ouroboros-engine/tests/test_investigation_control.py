"""The control-plane transport of the investigation loop, against a real local socket."""

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.investigation.control import (
    BriefBody,
    Claim,
    ControlRefusalError,
    ControlUnavailableError,
    Delivery,
    Finish,
    HttpInvestigationControl,
    Paragraph,
    Span,
    UsageEntry,
)

INVESTIGATION = "5eed0091-0000-4000-8000-000000000127"


class _ControlPlane(ThreadingHTTPServer):
    """A scripted control plane: records every request, answers the next scripted reply."""

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.requests: list[dict] = []
        self.replies: list[tuple[int, bytes]] = []


class _Handler(BaseHTTPRequestHandler):
    def _answer(self) -> None:
        server: _ControlPlane = self.server  # type: ignore[assignment]
        length = int(self.headers.get("Content-Length", "0"))
        server.requests.append(
            {
                "method": self.command,
                "path": self.path,
                "key": self.headers.get(INTERNAL_KEY_HEADER),
                "body": json.loads(self.rfile.read(length) or b"{}"),
            }
        )
        status, body = server.replies.pop(0)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = _answer  # noqa: N815 - the handler protocol's name
    do_PUT = _answer  # noqa: N815

    def log_message(self, *_args) -> None:
        """Keep the suite's output quiet."""


@pytest.fixture
def plane() -> Iterator[_ControlPlane]:
    server = _ControlPlane()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def _control(plane: _ControlPlane) -> HttpInvestigationControl:
    return HttpInvestigationControl(
        f"http://127.0.0.1:{plane.server_port}", "the-key", timeout=5
    )


def _reply(plane: _ControlPlane, status: int, body: object) -> None:
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    plane.replies.append((status, raw))


def _usage() -> UsageEntry:
    return UsageEntry(
        seq=1,
        stage="plan",
        alias="sizer",
        hop=0,
        connection="c",
        model="m",
        input_tokens=10,
        output_tokens=2,
        cost_cents=None,
    )


def test_start_claims_the_run_and_reads_back_the_checkpoint_and_ledger(
    plane: _ControlPlane,
) -> None:
    _reply(
        plane,
        200,
        {
            "investigation": "RS-127",
            "attempt": 2,
            "checkpoint": {"phase": "iterate"},
            "checkpointSeq": 5,
            "durationMs": 4200,
            "cancelRequested": False,
            "sources": [
                {
                    "id": "s1",
                    "citeNo": 7,
                    "citeKey": None,
                    "tool": "web",
                    "kind": "web",
                    "title": "T",
                    "locator": "https://example.com",
                    "excerpt": "E",
                    "somethingNew": True,
                }
            ],
        },
    )

    started = _control(plane).start(
        INVESTIGATION,
        loop_version="loop-v1",
        alias="researcher-long-ctx",
        resolution_ref="r1",
        task="investigate:x",
    )

    assert (started.attempt, started.checkpoint_seq, started.duration_ms) == (
        2,
        5,
        4200,
    )
    assert started.checkpoint == {"phase": "iterate"}
    assert started.sources[0].cite_no == 7
    assert plane.requests == [
        {
            "method": "POST",
            "path": f"/internal/research/investigations/{INVESTIGATION}/start",
            "key": "the-key",
            "body": {
                "loopVersion": "loop-v1",
                "alias": "researcher-long-ctx",
                "resolutionRef": "r1",
                "task": "investigate:x",
            },
        }
    ]


def test_a_tool_operation_sends_the_budget_and_reads_the_archived_sources(
    plane: _ControlPlane,
) -> None:
    _reply(
        plane,
        200,
        {
            "payload": {"hits": 1},
            "sources": [
                {
                    "id": "s1",
                    "citeNo": 1,
                    "kind": "web",
                    "title": "T",
                    "locator": "https://example.com",
                    "excerpt": "E",
                    "deduplicated": False,
                }
            ],
            "skipped": None,
        },
    )

    answer = _control(plane).tool(
        INVESTIGATION, "web", "search", {"query": "q", "limit": 3}, operations_left=4
    )

    assert answer.payload == {"hits": 1} and answer.sources[0].id == "s1"
    assert plane.requests[0]["path"] == "/internal/research/tools/web/search"
    assert plane.requests[0]["body"] == {
        "investigation": INVESTIGATION,
        "input": {"query": "q", "limit": 3},
        "budget": {"operations": 4},
    }


def test_a_checkpoint_is_a_put_that_answers_the_cancel_flag(
    plane: _ControlPlane,
) -> None:
    _reply(plane, 200, {"cancelRequested": True})

    acknowledged = _control(plane).checkpoint(
        INVESTIGATION,
        attempt=1,
        seq=3,
        state={"phase": "iterate"},
        duration_ms=900,
        usage=[_usage()],
    )

    assert acknowledged.cancel_requested is True
    sent = plane.requests[0]
    assert sent["method"] == "PUT"
    assert sent["path"].endswith(f"/investigations/{INVESTIGATION}/checkpoint")
    assert sent["body"] == {
        "attempt": 1,
        "seq": 3,
        "checkpoint": {"phase": "iterate"},
        "durationMs": 900,
        "usage": [
            {
                "seq": 1,
                "stage": "plan",
                "alias": "sizer",
                "hop": 0,
                "connection": "c",
                "model": "m",
                "inputTokens": 10,
                "outputTokens": 2,
                "costCents": None,
            }
        ],
    }


def test_a_brief_and_a_finish_are_sent_in_the_control_planes_camel_case(
    plane: _ControlPlane,
) -> None:
    _reply(plane, 200, {})
    _reply(plane, 200, b"")
    control = _control(plane)

    control.deliver(
        INVESTIGATION,
        Delivery(
            attempt=1,
            duration_ms=10,
            usage=[],
            body=BriefBody(
                paragraphs=[
                    Paragraph(spans=[Span(text="A.", claim="c1"), Span(text=" B.")])
                ]
            ),
            claims=[Claim(ref="c1", type="finding", text="A.", sources=["s1"])],
            deliverables={"matrix": {"rows": []}},
        ),
    )
    control.finish(
        INVESTIGATION,
        Finish(
            attempt=1,
            outcome="cancelled",
            duration_ms=10,
            usage=[],
            seq=4,
            checkpoint={"phase": "iterate"},
        ),
    )

    brief, finish = (request["body"] for request in plane.requests)
    assert brief["body"] == {
        "paragraphs": [{"spans": [{"text": "A.", "claim": "c1"}, {"text": " B."}]}]
    }
    assert brief["claims"] == [
        {
            "ref": "c1",
            "type": "finding",
            "text": "A.",
            "sources": ["s1"],
            "demoted": False,
        }
    ]
    assert brief["durationMs"] == 10 and brief["deliverables"] == {
        "matrix": {"rows": []}
    }
    assert finish == {
        "attempt": 1,
        "outcome": "cancelled",
        "durationMs": 10,
        "usage": [],
        "seq": 4,
        "checkpoint": {"phase": "iterate"},
    }
    assert plane.requests[1]["path"].endswith("/finish")


def test_an_error_envelope_is_a_refusal_carrying_its_code(plane: _ControlPlane) -> None:
    _reply(
        plane,
        409,
        {
            "code": "investigation_checkpoint_stale",
            "message": "Replaced.",
            "details": {},
        },
    )

    with pytest.raises(ControlRefusalError) as refusal:
        _control(plane).checkpoint(
            INVESTIGATION, attempt=1, seq=1, state={}, duration_ms=0, usage=[]
        )

    assert refusal.value.code == "investigation_checkpoint_stale"
    assert refusal.value.status == 409


@pytest.mark.parametrize(
    ("status", "body"),
    [(502, b"<html>bad gateway</html>"), (500, b""), (200, b"not json"), (200, b"[1]")],
)
def test_no_usable_answer_is_unavailable_not_a_refusal(
    plane: _ControlPlane, status: int, body: bytes
) -> None:
    _reply(plane, status, body)

    with pytest.raises(ControlUnavailableError):
        _control(plane).start(
            INVESTIGATION,
            loop_version="loop-v1",
            alias="a",
            resolution_ref=None,
            task="t",
        )


def test_a_client_error_without_an_envelope_is_still_a_named_refusal(
    plane: _ControlPlane,
) -> None:
    _reply(plane, 404, b"nope")

    with pytest.raises(ControlRefusalError) as refusal:
        _control(plane).finish(
            INVESTIGATION,
            Finish(
                attempt=1,
                outcome="cancelled",
                duration_ms=0,
                usage=[],
                seq=1,
                checkpoint={},
            ),
        )
    assert refusal.value.code == "http_404"


def test_a_control_plane_that_is_not_there_is_unavailable() -> None:
    control = HttpInvestigationControl("http://127.0.0.1:1", "k", timeout=2)

    with pytest.raises(ControlUnavailableError):
        control.start(
            INVESTIGATION,
            loop_version="loop-v1",
            alias="a",
            resolution_ref=None,
            task="t",
        )


def test_a_tool_slug_cannot_escape_its_path_segment(plane: _ControlPlane) -> None:
    _reply(plane, 200, {"payload": None, "sources": []})
    _control(plane).tool(
        INVESTIGATION, "../llm", "invoke?x=1", {"q": 1}, operations_left=1
    )
    assert (
        plane.requests[0]["path"] == "/internal/research/tools/..%2Fllm/invoke%3Fx%3D1"
    )
