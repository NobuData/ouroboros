"""The model estimator (O.2's core, #123): the workspace's model sizes, the heuristic is the floor.

Driven through a recorded :class:`~ouroboros_engine.estimation.model.SizingCaller`, so every
path is exact: a model answer becomes the estimate, and every way that answer can be missing or
wrong becomes the heuristic's estimate with a trace that says why. The gateway half —
what is sent for an alias and for a connection — is driven through a recorded gateway.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneRequest,
)
from ouroboros_engine.estimation.contract import (
    EstimateModel,
    EstimateRequest,
    EstimateSubject,
)
from ouroboros_engine.estimation.estimator import Estimator
from ouroboros_engine.estimation.heuristic import HeuristicEstimator
from ouroboros_engine.estimation.model import (
    ESTIMATE_STAGE,
    MAX_OUTPUT_TOKENS,
    GatewaySizingCaller,
    ModelEstimator,
)
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelAnswer,
    ModelFailureError,
)

SUBJECT = EstimateSubject(kind="issue", id="e1000000-0000-0000-0000-000000000485")

OLLAMA = EstimateModel(
    connection="5eed000c-0000-4000-8000-000000000005",
    model_id="llama3.1:8b",
    label="llama3.1:8b",
    subject=SUBJECT,
)

ROUTED = EstimateModel(
    alias="sizer",
    label="claude-haiku-4-5",
    resolution_version="r1",
    cost_cap_cents=25,
    subject=SUBJECT,
)

#: A good answer, inside the fixture context's vocabularies.
ANSWER = {
    "effort": "m",
    "confidence": 81,
    "suggested_workflow": "standard-fix",
    "routed_model": "claude-fable-5",
    "cycle_min": 12,
    "cycle_max": 18,
    "est_minutes": 40,
    "risk": "medium",
    "risk_note": "Bus recovery paths are timing-sensitive; HIL coverage is partial.",
}

USAGE = [
    CallUsage(
        hop=1,
        connection="c",
        model="llama3.1:8b",
        input_tokens=900,
        output_tokens=120,
        cost_cents=None,
    )
]


class Recorded:
    """A sizing caller that answers with what it was given, and records what it was asked."""

    def __init__(self, answer: ModelAnswer | ModelFailureError) -> None:
        """Hold the answer.

        Args:
            answer: What to answer with, or the failure to raise.
        """
        self.answer = answer
        self.calls: list[tuple[EstimateModel, str, str]] = []

    def call(self, model: EstimateModel, system: str, user: str) -> ModelAnswer:
        """Record the call; answer or fail."""
        self.calls.append((model, system, user))
        if isinstance(self.answer, ModelFailureError):
            raise self.answer
        return self.answer


def answering(text: str) -> Recorded:
    """A caller whose model writes ``text``."""
    return Recorded(ModelAnswer(text=text, usage=USAGE))


def with_model(request: EstimateRequest, model: EstimateModel) -> EstimateRequest:
    """The request, naming a model."""
    return request.model_copy(update={"model": model})


def test_it_is_an_estimator() -> None:
    assert isinstance(ModelEstimator(answering("{}")), Estimator)


def test_the_model_s_answer_is_the_estimate_and_the_trace_names_the_model(
    estimate_request: EstimateRequest,
) -> None:
    caller = answering(f"Here you go:\n```json\n{json.dumps(ANSWER)}\n```")

    estimate = ModelEstimator(caller).estimate(with_model(estimate_request, OLLAMA))

    assert estimate.effort == "m"
    assert estimate.confidence == 81
    assert estimate.suggested_workflow == "standard-fix"
    assert estimate.routed_model == "claude-fable-5"
    assert (estimate.breakdown.cycle_min, estimate.breakdown.cycle_max) == (12, 18)
    assert estimate.breakdown.est_minutes == 40
    assert estimate.risk == "medium"
    assert estimate.trace.estimator == "llama3.1:8b"
    assert estimate.trace.tokens_used == 1020
    assert estimate.trace.signals == ["model: llama3.1:8b"]


def test_files_and_the_work_s_tokens_come_from_the_heuristic(
    estimate_request: EstimateRequest,
) -> None:
    floor = HeuristicEstimator().estimate(estimate_request)

    estimate = ModelEstimator(answering(json.dumps(ANSWER))).estimate(
        with_model(estimate_request, OLLAMA)
    )

    assert estimate.breakdown.files == floor.breakdown.files
    assert estimate.breakdown.est_tokens == floor.breakdown.est_tokens


def test_the_prompt_carries_the_issue_and_only_the_offered_vocabularies(
    estimate_request: EstimateRequest,
) -> None:
    caller = answering(json.dumps(ANSWER))

    ModelEstimator(caller).estimate(with_model(estimate_request, ROUTED))

    [(model, system, user)] = caller.calls
    assert model == ROUTED
    assert "ONE JSON object" in system
    assert "Issue #485: I2C bus lockup after IMU sleep/wake cycle" in user
    assert "Labels: bug, i2c, watchdog" in user
    assert "standard-fix, docs-loop, feature-loop, deps-refresh" in user
    assert "Models you may choose from: claude-fable-5, claude-haiku-4-5" in user


def test_with_no_model_the_heuristic_answers_and_says_why(
    estimate_request: EstimateRequest,
) -> None:
    caller = answering(json.dumps(ANSWER))
    request = estimate_request.model_copy(
        update={"model_unavailable": "no estimate route and no Ollama connection"}
    )

    estimate = ModelEstimator(caller).estimate(request)

    assert caller.calls == []
    assert estimate.trace.estimator == "heuristic-v0"
    assert estimate.trace.tokens_used == 0
    assert estimate.trace.signals[0] == (
        "model: none — no estimate route and no Ollama connection"
    )
    assert estimate.trace.signals[1:] == (
        HeuristicEstimator().estimate(estimate_request).trace.signals
    )


def test_with_no_model_and_no_reason_the_trace_says_none_was_configured(
    estimate_request: EstimateRequest,
) -> None:
    estimate = ModelEstimator(answering("{}")).estimate(estimate_request)

    assert estimate.trace.signals[0] == "model: none — no model configured"


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (
            ModelFailureError("provider_unavailable", "connection refused"),
            "provider_unavailable: connection refused",
        ),
        (
            ModelAnswer(text="I think it is medium.", usage=USAGE),
            "the answer was not a JSON object",
        ),
        (
            ModelAnswer(text=json.dumps({**ANSWER, "effort": "huge"}), usage=USAGE),
            "outside the contract (effort)",
        ),
        (
            ModelAnswer(
                text=json.dumps({**ANSWER, "cycle_min": 30, "cycle_max": 5}),
                usage=USAGE,
            ),
            "outside the contract",
        ),
        (
            ModelAnswer(
                text=json.dumps({k: v for k, v in ANSWER.items() if k != "risk"}),
                usage=USAGE,
            ),
            "outside the contract (risk)",
        ),
        (
            ModelAnswer(
                text=json.dumps({**ANSWER, "suggested_workflow": "yolo-loop"}),
                usage=USAGE,
            ),
            "did not offer",
        ),
        (
            ModelAnswer(
                text=json.dumps({**ANSWER, "routed_model": "gpt-9"}), usage=USAGE
            ),
            "did not offer",
        ),
    ],
    ids=[
        "the provider is down",
        "the answer is prose",
        "an effort outside the scale",
        "a cycle range backwards",
        "a key missing",
        "a workflow nobody offered",
        "a model nobody offered",
    ],
)
def test_every_failure_falls_back_to_the_heuristic_with_the_reason(
    estimate_request: EstimateRequest,
    answer: ModelAnswer | ModelFailureError,
    reason: str,
) -> None:
    floor = HeuristicEstimator().estimate(estimate_request)

    estimate = ModelEstimator(Recorded(answer)).estimate(
        with_model(estimate_request, OLLAMA)
    )

    assert estimate.trace.estimator == "heuristic-v0"
    assert estimate.effort == floor.effort
    assert estimate.trace.signals[0].startswith(
        "fallback: heuristic-v0 — llama3.1:8b: "
    )
    assert reason in estimate.trace.signals[0]
    # What asking cost is still counted, when the model got that far.
    spent = 0 if isinstance(answer, ModelFailureError) else 1020
    assert estimate.trace.tokens_used == floor.trace.tokens_used + spent


def test_a_failure_that_spent_tokens_counts_them(
    estimate_request: EstimateRequest,
) -> None:
    failed = ModelFailureError("cost_cap_exceeded", "the cap was reached", USAGE)

    estimate = ModelEstimator(Recorded(failed)).estimate(
        with_model(estimate_request, ROUTED)
    )

    assert estimate.trace.tokens_used == 1020
    assert "cost_cap_exceeded" in estimate.trace.signals[0]


def test_a_long_label_is_cut_to_the_trace_s_bound(
    estimate_request: EstimateRequest,
) -> None:
    long_label = OLLAMA.model_copy(update={"label": "x" * 100})

    estimate = ModelEstimator(answering(json.dumps(ANSWER))).estimate(
        with_model(estimate_request, long_label)
    )

    assert estimate.trace.estimator == "x" * 64


# -- the gateway half --------------------------------------------------------------------


class RecordingGateway:
    """A gateway that answers one NDJSON stream and records what it was sent."""

    def __init__(self, lines: list[dict]) -> None:
        """Hold the stream."""
        self.lines = lines
        self.sent: list[ControlPlaneRequest] = []

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Record the request; answer the stream."""
        self.sent.append(outgoing)
        return iter([json.dumps(line) + "\n" for line in self.lines])


STREAM = [
    {"kind": "delta", "hop": 1, "text": json.dumps(ANSWER)},
    {
        "kind": "usage",
        "hop": 1,
        "connection": "5eed000c-0000-4000-8000-000000000005",
        "model": "llama3.1:8b",
        "input_tokens": 900,
        "output_tokens": 120,
        "cost_cents": None,
    },
    {"kind": "done", "hop": 1, "finish_reason": "stop"},
]


def test_a_connection_is_asked_for_its_model_and_the_call_is_metered_against_the_issue() -> (
    None
):
    gateway = RecordingGateway(STREAM)
    caller = GatewaySizingCaller(
        ControlPlaneClient("http://rest.invalid", "secret"), gateway
    )

    answer = caller.call(OLLAMA, "system", "question")

    [sent] = gateway.sent
    body = sent.json
    assert sent.url == "http://rest.invalid/internal/llm/invoke"
    assert body["connection"] == "5eed000c-0000-4000-8000-000000000005"
    assert "alias" not in body or body["alias"] is None
    assert body["payload"]["model"] == "llama3.1:8b"
    assert body["payload"]["max_output_tokens"] == MAX_OUTPUT_TOKENS
    assert body["payload"]["messages"] == [{"role": "user", "content": "question"}]
    assert body["runCtx"]["run"] == SUBJECT.id
    assert body["runCtx"]["stage"] == ESTIMATE_STAGE
    assert json.loads(answer.text) == ANSWER
    assert answer.usage[0].input_tokens == 900


def test_an_alias_is_sent_as_one_with_the_route_s_version_and_cap() -> None:
    gateway = RecordingGateway(STREAM)
    caller = GatewaySizingCaller(
        ControlPlaneClient("http://rest.invalid", "secret"), gateway
    )

    caller.call(ROUTED, "system", "question")

    body = gateway.sent[0].json
    assert body["alias"] == "sizer"
    assert "model" not in body["payload"]
    assert body["runCtx"]["resolutionVersion"] == "r1"
    assert body["runCtx"]["costCapCents"] == 25


def test_a_gateway_error_event_is_a_model_failure() -> None:
    gateway = RecordingGateway(
        [{"kind": "error", "code": "chain_exhausted", "message": "every hop failed"}]
    )
    caller = GatewaySizingCaller(
        ControlPlaneClient("http://rest.invalid", "secret"), gateway
    )

    with pytest.raises(ModelFailureError) as failed:
        caller.call(ROUTED, "system", "question")

    assert failed.value.code == "chain_exhausted"
