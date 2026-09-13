"""``POST /v0/workflows/validate`` and ``POST /v0/workflows/dry-run``, over HTTP.

What the routes add to the functions behind them is the contract, so that is what this suite
holds them to: the golden verdicts both validators share arrive as findings with the node anchor
spelled ``node_id``; an absent anchor is left out; a definition that is not a workflow is a
``200`` with a finding while a request that is not one is a ``422``; both operations are behind
the internal key; and a dry run reaches no model, no provider and no estimator — asserted with
spies that fail the request if anything touches them.
"""

import socket
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.estimation.contract import Estimate, EstimateRequest
from ouroboros_engine.workflows.contract import DryRunTicket
from workflows_golden import CASES, ExpectedCase, read_fixture

VALIDATE = "/v0/workflows/validate"
DRY_RUN = "/v0/workflows/dry-run"

#: Mockup 04's four accent edges, as the wire spells an edge.
MOCKUP_ACTIVE_PATH = [
    {"from": "issue-queued", "to": "analyze"},
    {"from": "analyze", "to": "effort-recheck"},
    {"from": "effort-recheck", "to": "plan"},
    {"from": "plan", "to": "implement"},
]


def _wire(expected: dict[str, Any]) -> dict[str, Any]:
    """A diagnostic ``expected.json`` records, as a finding spells it — ``node`` is ``node_id``."""
    finding = {"code": expected["code"], "path": expected["path"]}
    if "node" in expected:
        finding["node_id"] = expected["node"]
    if "edge" in expected:
        finding["edge"] = expected["edge"]
    return finding


def _anchors(finding: dict[str, Any]) -> dict[str, Any]:
    """A finding without its message, which is presentation rather than contract."""
    return {key: value for key, value in finding.items() if key != "message"}


def _dry_run_body(definition: object, ticket: DryRunTicket) -> dict[str, Any]:
    """A dry-run request body."""
    return {"definition": definition, "ticket": ticket.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------


def test_the_seeded_canvas_validates_green(
    client: TestClient, standard_fix: dict
) -> None:
    response = client.post(VALIDATE, json={"definition": standard_fix})

    assert response.status_code == 200
    assert response.json() == {"findings": []}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_findings_are_the_golden_verdicts_both_validators_share(
    client: TestClient, case: ExpectedCase
) -> None:
    # The route supplies no catalogue, so decision P7's warnings never become findings: the
    # verdict it answers with is exactly the recorded errors, which is what zod's is too.
    response = client.post(VALIDATE, json={"definition": read_fixture(case.document)})

    findings = response.json()["findings"]
    assert response.status_code == 200
    assert [_anchors(finding) for finding in findings] == [
        _wire(error) for error in case.errors
    ]
    assert all(finding["message"].strip() for finding in findings)


def test_an_absent_anchor_is_left_out_rather_than_sent_as_null(
    client: TestClient,
) -> None:
    response = client.post(
        VALIDATE, json={"definition": read_fixture("invalid/no-trigger.json")}
    )

    (finding,) = response.json()["findings"]
    assert set(finding) == {"code", "message", "path"}


def test_a_definition_that_is_not_a_workflow_is_a_finding_rather_than_a_refusal(
    client: TestClient,
) -> None:
    response = client.post(VALIDATE, json={"definition": "standard-fix"})

    assert response.status_code == 200
    assert [_anchors(f) for f in response.json()["findings"]] == [
        {"code": "document.malformed", "path": ""}
    ]


@pytest.mark.parametrize(
    ("route", "body", "field"),
    [
        (VALIDATE, {}, "definition"),
        (VALIDATE, {"definition": {}, "catalogue": {}}, "catalogue"),
        (DRY_RUN, {"definition": {}}, "ticket"),
    ],
)
def test_a_request_that_is_not_one_is_refused_in_the_envelope(
    client: TestClient, route: str, body: dict, field: str
) -> None:
    response = client.post(route, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"
    assert field in response.json()["details"]


@pytest.mark.parametrize("route", [VALIDATE, DRY_RUN])
def test_both_operations_are_behind_the_internal_key(
    anonymous_client: TestClient, route: str
) -> None:
    assert anonymous_client.post(route, json={}).status_code == 401


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


def test_the_seeded_canvas_and_the_seeded_485_walk_the_mockups_active_path(
    client: TestClient, standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    response = client.post(DRY_RUN, json=_dry_run_body(standard_fix, ticket_485))

    body = response.json()
    assert response.status_code == 200
    assert body["findings"] == []
    assert body["highlight_path"][: len(MOCKUP_ACTIVE_PATH)] == MOCKUP_ACTIVE_PATH
    assert [step["node_id"] for step in body["steps"]][:5] == [
        "issue-queued",
        "analyze",
        "effort-recheck",
        "plan",
        "implement",
    ]
    assert len(body["verdicts"]) == len(standard_fix["nodes"])


def test_an_edge_is_spelled_from_and_to_on_the_wire(
    client: TestClient, standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    body = client.post(DRY_RUN, json=_dry_run_body(standard_fix, ticket_485)).json()

    assert set(body["highlight_path"][0]) == {"from", "to"}
    assert set(body["steps"][0]["edges"][0]) == {
        "from",
        "to",
        "kind",
        "label",
        "outcome",
        "explanation",
        "evaluation",
        "max_retries",
    }


def test_a_dry_run_of_an_invalid_definition_answers_its_findings_and_walks_nothing(
    client: TestClient, ticket_485: DryRunTicket
) -> None:
    case = next(
        case for case in CASES if case.document == "invalid/unreachable-node.json"
    )

    response = client.post(
        DRY_RUN, json=_dry_run_body(read_fixture(case.document), ticket_485)
    )

    body = response.json()
    assert response.status_code == 200
    assert [_anchors(f) for f in body["findings"]] == [_wire(e) for e in case.errors]
    assert (body["steps"], body["verdicts"], body["highlight_path"]) == ([], [], [])


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"estimate": {"effort": "xxl"}}, "ticket.estimate.effort"),
        ({"source": "bitbucket"}, "ticket.source"),
        ({"labels": [""]}, "ticket.labels.0"),
        ({"labels": ["bug"] * 101}, "ticket.labels"),
        ({"external_key": ""}, "ticket.external_key"),
        ({"priority": "high"}, "ticket.priority"),
    ],
)
def test_a_ticket_outside_the_contract_is_refused(
    client: TestClient,
    standard_fix: dict,
    ticket_485: DryRunTicket,
    change: dict,
    field: str,
) -> None:
    ticket = {**ticket_485.model_dump(mode="json"), **change}

    response = client.post(DRY_RUN, json={"definition": standard_fix, "ticket": ticket})

    assert response.status_code == 422
    assert field in response.json()["details"]


def test_an_unsized_ticket_says_so_rather_than_leaving_the_estimate_out(
    client: TestClient, standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    ticket = ticket_485.model_dump(mode="json")
    del ticket["estimate"]

    missing = client.post(DRY_RUN, json={"definition": standard_fix, "ticket": ticket})
    unsized = client.post(
        DRY_RUN,
        json={"definition": standard_fix, "ticket": {**ticket, "estimate": None}},
    )

    assert missing.status_code == 422
    assert "ticket.estimate" in missing.json()["details"]
    assert unsized.status_code == 200
    assert unsized.json()["steps"][0]["verdict"] == "not_matched"


# ---------------------------------------------------------------------------
# Zero model calls, zero provider calls — the runtime half
# ---------------------------------------------------------------------------


class _RefusingEstimator:
    """An estimator that records being asked, and refuses."""

    def __init__(self, attempts: list[str]) -> None:
        """Keep the list every attempt is recorded in."""
        self.attempts = attempts

    def estimate(self, request: EstimateRequest) -> Estimate:
        """Record the attempt and fail the request that made it."""
        self.attempts.append(f"the estimator, for #{request.issue.number}")
        message = "a dry run asked the estimator"
        raise AssertionError(message)


def _refusing(attempts: list[str], what: str) -> Callable[..., None]:
    """A stand-in that records being called as ``what``, and fails the request that called it."""

    def refuse(*_args: object, **_kwargs: object) -> None:
        attempts.append(what)
        message = f"a dry run reached {what}"
        raise AssertionError(message)

    return refuse


def test_neither_operation_makes_a_model_call_or_a_provider_call(
    client: TestClient,
    standard_fix: dict,
    ticket_485: DryRunTicket,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts: list[str] = []
    monkeypatch.setattr(
        ControlPlaneClient,
        "invoke_request",
        _refusing(attempts, "a model invocation through the control plane"),
    )
    monkeypatch.setattr(
        ControlPlaneClient,
        "lease_request",
        _refusing(attempts, "a provider credential lease"),
    )
    monkeypatch.setattr(socket.socket, "connect", _refusing(attempts, "a socket"))
    monkeypatch.setattr(socket, "create_connection", _refusing(attempts, "a socket"))
    monkeypatch.setattr(client.app.state, "estimator", _RefusingEstimator(attempts))

    # standard-fix holds every node type the DSL has, so every branch of the walk runs.
    walked = client.post(DRY_RUN, json=_dry_run_body(standard_fix, ticket_485))
    validated = client.post(VALIDATE, json={"definition": standard_fix})

    assert walked.status_code == 200
    assert len(walked.json()["steps"]) == 10
    assert validated.status_code == 200
    assert attempts == []


def test_the_spies_would_have_noticed_a_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The assertion above passes vacuously if the stand-ins never fire, so each is shown firing.
    attempts: list[str] = []
    monkeypatch.setattr(
        ControlPlaneClient,
        "invoke_request",
        _refusing(attempts, "a model invocation through the control plane"),
    )
    estimator = _RefusingEstimator(attempts)

    with pytest.raises(AssertionError):
        ControlPlaneClient("http://control-plane.invalid", "secret").invoke_request()
    with pytest.raises(AssertionError):
        estimator.estimate(
            EstimateRequest.model_validate(
                {
                    "issue": {
                        "number": 485,
                        "title": "t",
                        "body": None,
                        "labels": [],
                        "repo": "acme/helios",
                    },
                    "context": {
                        "workflow_tags": ["standard-fix"],
                        "model_defaults": {"default": "m"},
                    },
                }
            )
        )

    assert attempts == [
        "a model invocation through the control plane",
        "the estimator, for #485",
    ]
    assert client.app is not None
