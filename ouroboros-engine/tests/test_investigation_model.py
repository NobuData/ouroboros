"""One model call through the invocation gateway, and the JSON read from its answer."""

import json
from collections.abc import Iterator

import pytest

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneRequest,
)
from ouroboros_engine.copilot.contract import GATEWAY_UNAVAILABLE
from ouroboros_engine.copilot.gateway import GatewayError
from ouroboros_engine.investigation.model import (
    MAX_OUTPUT_TOKENS,
    GatewayModelCaller,
    ModelCall,
    ModelFailureError,
    json_object,
    remaining_cap,
)

INVESTIGATION = "5eed0091-0000-4000-8000-000000000127"


class ScriptedGateway:
    """Answers every invocation with the same lines, or the same failure."""

    def __init__(
        self, lines: list | None = None, failure: GatewayError | None = None
    ) -> None:
        """Script the answer."""
        self.lines = lines or []
        self.failure = failure
        self.sent: list[ControlPlaneRequest] = []

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Answer the script."""
        self.sent.append(outgoing)
        if self.failure is not None:
            raise self.failure
        for line in self.lines:
            yield line if isinstance(line, str) else json.dumps(line) + "\n"


def _usage(cost: float | None = 8.25, hop: int = 0) -> dict:
    return {
        "kind": "usage",
        "hop": hop,
        "connection": "conn-1",
        "model": "claude-sonnet-4-6",
        "inputTokens": 20_000,
        "outputTokens": 1_500,
        "costCents": cost,
    }


def _call(stage: str = "synthesize", **overrides) -> ModelCall:
    values = {
        "investigation": INVESTIGATION,
        "stage": stage,
        "alias": "researcher-long-ctx",
        "system": "SYSTEM",
        "user": "USER",
        "cost_cap_cents": 590,
        "resolution_version": "r1",
    }
    return ModelCall(**{**values, **overrides})


def _caller(gateway: ScriptedGateway) -> GatewayModelCaller:
    return GatewayModelCaller(ControlPlaneClient("http://rest:4000", "k"), gateway)


def test_a_call_names_the_alias_and_is_attributed_to_the_investigation() -> None:
    gateway = ScriptedGateway(
        [
            {"kind": "delta", "hop": 0, "text": '{"claims"'},
            {"kind": "delta", "hop": 0, "text": ": []}"},
            _usage(),
            {"kind": "done", "hop": 0, "finishReason": "stop"},
        ]
    )

    answer = _caller(gateway).call(_call())

    assert answer.text == '{"claims": []}'
    assert [(u.model, u.input_tokens, u.cost_cents) for u in answer.usage] == [
        ("claude-sonnet-4-6", 20_000, 8.25)
    ]
    sent = gateway.sent[0]
    assert sent.url == "http://rest:4000/internal/llm/invoke"
    assert sent.json == {
        "alias": "researcher-long-ctx",
        "payload": {
            "system": "SYSTEM",
            "messages": [{"role": "user", "content": "USER"}],
            "max_output_tokens": MAX_OUTPUT_TOKENS["synthesize"],
        },
        "runCtx": {
            "run": INVESTIGATION,
            "stage": "research",
            "costCapCents": 590,
            "resolutionVersion": "r1",
        },
    }


@pytest.mark.parametrize(
    ("stage", "task_kind"),
    [
        ("plan", "research-plan"),
        ("select", "research-plan"),
        ("digest", "research"),
        ("synthesize", "research"),
    ],
)
def test_each_stage_is_attributed_to_its_routed_task_kind(
    stage: str, task_kind: str
) -> None:
    gateway = ScriptedGateway([{"kind": "done", "hop": 0, "finishReason": "stop"}])
    _caller(gateway).call(_call(stage))
    assert gateway.sent[0].json["runCtx"]["stage"] == task_kind


def test_a_failover_reports_the_usage_of_every_hop() -> None:
    gateway = ScriptedGateway(
        [
            _usage(1.0, hop=0),
            {"kind": "delta", "hop": 1, "text": "{}"},
            _usage(None, hop=1),
            {"kind": "done", "hop": 1, "finishReason": "stop"},
        ]
    )
    answer = _caller(gateway).call(_call())
    assert [(u.hop, u.cost_cents) for u in answer.usage] == [(0, 1.0), (1, None)]


def test_an_absent_gateway_is_a_named_failure() -> None:
    gateway = ScriptedGateway(failure=GatewayError(GATEWAY_UNAVAILABLE, "not yet"))

    with pytest.raises(ModelFailureError) as failure:
        _caller(gateway).call(_call())

    assert failure.value.code == GATEWAY_UNAVAILABLE
    assert failure.value.over_budget is False


def test_an_error_event_keeps_the_usage_that_was_paid_for() -> None:
    gateway = ScriptedGateway(
        [
            _usage(3.0),
            {"kind": "error", "hop": 0, "code": "cost_cap_exceeded", "message": "cap"},
        ]
    )

    with pytest.raises(ModelFailureError) as failure:
        _caller(gateway).call(_call())

    assert failure.value.over_budget is True
    assert [u.cost_cents for u in failure.value.usage] == [3.0]


@pytest.mark.parametrize(
    "line", ['{"kind": "sixth"}\n', "not json at all\n", '{"kind": "usage"}\n']
)
def test_an_answer_outside_the_contract_is_a_refusal_not_a_crash(line: str) -> None:
    with pytest.raises(ModelFailureError) as failure:
        _caller(ScriptedGateway([line])).call(_call())
    assert failure.value.code == "gateway_refused"


@pytest.mark.parametrize(
    ("ceiling", "spent", "expected"),
    [
        (None, 40.0, None),
        (600, 0.0, 600),
        (600, 8.25, 591),
        (600, 600.0, 0),
        (5, 9.0, 0),
    ],
)
def test_the_cap_sent_with_a_call_is_what_is_left(
    ceiling: int | None, spent: float, expected: int | None
) -> None:
    assert remaining_cap(ceiling, spent) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"a": 1}', {"a": 1}),
        ('```json\n{"a": 1}\n```', {"a": 1}),
        ('Here you go: {"a": {"b": 2}} — done.', {"a": {"b": 2}}),
        ("no object here", None),
        ("{not json}", None),
        ("[1, 2]", None),
        ("", None),
        ("}{", None),
    ],
)
def test_the_json_object_is_read_out_of_whatever_wraps_it(
    text: str, expected: dict | None
) -> None:
    assert json_object(text) == expected


def test_an_answer_nested_past_the_parser_is_no_object() -> None:
    assert json_object('{"a":' * 100_000 + "1" + "}" * 100_000) is None
