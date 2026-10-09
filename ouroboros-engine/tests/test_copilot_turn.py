"""One turn through a fake gateway: the payload sent, the events streamed, the failures named."""

import json
from collections.abc import Iterator

import pytest

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneRequest,
)
from ouroboros_engine.control_plane.contract import (
    INTERNAL_KEY_HEADER,
    INVOKE_MEDIA_TYPE,
)
from ouroboros_engine.copilot.contract import (
    GATEWAY_REFUSED,
    GATEWAY_UNAVAILABLE,
    CopilotDelta,
    CopilotDone,
    CopilotError,
    CopilotToolCall,
    CopilotTurnRequest,
    CopilotUsage,
)
from ouroboros_engine.copilot.gateway import GatewayError
from ouroboros_engine.copilot.turn import COPILOT_TASK_KIND, CopilotTurnRunner

SESSION = "5eed008a-0000-4000-8000-000000000001"


def _request(**overrides) -> CopilotTurnRequest:
    body = {
        "alias": "coder-max",
        "session": SESSION,
        "resolution_version": "z1-v1",
        "cost_cap_cents": 500,
        "context": {
            "draft": None,
            "draft_label": "v0.0",
            "catalog": [
                {"type": "llm", "label": "Model stage", "summary": "A prompt."}
            ],
            "skills": ["pr-etiquette"],
            "tasks": ["review"],
            "guards": [{"name": "spend_guard", "description": "A spend cap."}],
        },
        "transcript": [{"role": "user", "text": "security patches: second review"}],
        **overrides,
    }
    return CopilotTurnRequest.model_validate(body)


class RecordingGateway:
    """Answers with scripted lines, and remembers what it was sent."""

    def __init__(
        self, lines: list[dict] | None = None, failure: GatewayError | None = None
    ) -> None:
        """Script the answer."""
        self.lines = lines or []
        self.failure = failure
        self.sent: list[ControlPlaneRequest] = []

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Record the request and answer the script."""
        self.sent.append(outgoing)
        if self.failure is not None:
            raise self.failure
        for line in self.lines:
            yield json.dumps(line) + "\n"


def _runner(gateway: RecordingGateway) -> CopilotTurnRunner:
    return CopilotTurnRunner(ControlPlaneClient("http://rest:4000", "secret"), gateway)


def test_the_invocation_names_the_alias_and_is_attributed_to_the_session() -> None:
    gateway = RecordingGateway([{"kind": "done", "hop": 0, "finish_reason": "stop"}])
    list(_runner(gateway).run(_request()))

    [sent] = gateway.sent
    assert sent.method == "POST"
    assert sent.url == "http://rest:4000/internal/llm/invoke"
    assert sent.headers[INTERNAL_KEY_HEADER] == "secret"
    assert sent.accept == INVOKE_MEDIA_TYPE
    assert sent.json["alias"] == "coder-max"
    assert "connection" not in sent.json
    assert sent.json["runCtx"] == {
        "run": SESSION,
        "stage": COPILOT_TASK_KIND,
        "costCapCents": 500,
        "resolutionVersion": "z1-v1",
    }


def test_the_payload_carries_the_rules_the_manifest_and_the_grounding() -> None:
    gateway = RecordingGateway([{"kind": "done", "hop": 0, "finish_reason": "stop"}])
    list(_runner(gateway).run(_request()))

    payload = gateway.sent[0].json["payload"]
    system = payload["system"]
    assert "ONLY way to change the draft is a tool call" in system
    assert "- add_stage:" in system and "- ask_user:" in system
    assert "pr-etiquette" in system and "review" in system and "spend_guard" in system
    assert "no draft yet" in system
    assert payload["messages"] == [
        {"role": "user", "content": "security patches: second review"}
    ]


def test_the_transcript_renders_calls_and_results_in_order() -> None:
    gateway = RecordingGateway([{"kind": "done", "hop": 0, "finish_reason": "stop"}])
    request = _request(
        transcript=[
            {"role": "user", "text": "do it"},
            {
                "role": "copilot",
                "text": "Adding.",
                "tool_calls": [
                    {"id": "call-1", "tool": "remove_stage", "arguments": {"id": "x"}}
                ],
            },
            {"role": "tool", "call_id": "call-1", "ok": False, "content": "no stage x"},
        ]
    )
    list(_runner(gateway).run(request))

    messages = gateway.sent[0].json["payload"]["messages"]
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"].startswith("Adding.\n```tool\n")
    assert '"tool": "remove_stage"' in messages[1]["content"]
    assert messages[2] == {
        "role": "user",
        "content": "[tool result call-1] error: no stage x",
    }


def test_a_streamed_reply_becomes_deltas_calls_usage_and_done_in_order() -> None:
    gateway = RecordingGateway(
        [
            {
                "kind": "hop",
                "hop": 0,
                "connection": "c1",
                "outcome": "ok",
                "latency_ms": 5,
            },
            {"kind": "delta", "hop": 0, "text": "Drafted it.\n```tool\n"},
            {
                "kind": "delta",
                "hop": 0,
                "text": '{"tool": "read_draft", "arguments": {}}\n```\nDone.',
            },
            {
                "kind": "usage",
                "hop": 0,
                "connection": "c1",
                "model": "claude-fable-5",
                "input_tokens": 10,
                "output_tokens": 4,
                "cost_cents": None,
            },
            {"kind": "done", "hop": 0, "finish_reason": "end_turn"},
        ]
    )
    events = list(_runner(gateway).run(_request()))

    assert events[0] == CopilotDelta(kind="delta", text="Drafted it.\n")
    assert isinstance(events[1], CopilotToolCall) and events[1].tool == "read_draft"
    assert events[2] == CopilotUsage(
        kind="usage",
        input_tokens=10,
        output_tokens=4,
        cost_cents=None,
        model="claude-fable-5",
        connection="c1",
    )
    assert events[3] == CopilotDelta(kind="delta", text="Done.")
    assert events[4] == CopilotDone(kind="done", finish_reason="end_turn")


def test_an_unavailable_gateway_is_an_honest_error_event() -> None:
    gateway = RecordingGateway(failure=GatewayError(GATEWAY_UNAVAILABLE, "not yet"))
    events = list(_runner(gateway).run(_request()))

    assert events == [
        CopilotError(kind="error", code=GATEWAY_UNAVAILABLE, message="not yet")
    ]


def test_an_error_in_the_stream_ends_the_turn_with_its_code() -> None:
    gateway = RecordingGateway(
        [
            {"kind": "delta", "hop": 0, "text": "Partial"},
            {"kind": "error", "hop": 0, "code": "cost_cap_exceeded", "message": "cap"},
            {"kind": "done", "hop": 0, "finish_reason": "stop"},
        ]
    )
    events = list(_runner(gateway).run(_request()))

    assert events == [
        CopilotDelta(kind="delta", text="Partial"),
        CopilotError(kind="error", code="cost_cap_exceeded", message="cap"),
    ]


def test_a_line_outside_the_contract_is_a_refusal() -> None:
    gateway = RecordingGateway([{"kind": "surprise"}])
    events = list(_runner(gateway).run(_request()))

    assert len(events) == 1
    assert isinstance(events[0], CopilotError)
    assert events[0].code == GATEWAY_REFUSED
    assert "unknown_event_kind" in events[0].message


@pytest.mark.parametrize("field", ["alias", "session", "context", "transcript"])
def test_the_request_is_closed_and_requires_its_fields(field: str) -> None:
    body = _request().model_dump()
    del body[field]
    with pytest.raises(ValueError):
        CopilotTurnRequest.model_validate(body)
    with pytest.raises(ValueError):
        CopilotTurnRequest.model_validate({**_request().model_dump(), "extra": 1})
