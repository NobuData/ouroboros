"""``POST /v0/estimate`` — the route, its boundary, and the escalation it does not serve.

The estimate itself is :mod:`tests.test_estimation_estimator`'s and the shape of it is
:mod:`tests.test_estimation_contract`'s. What is left for the route is the four things only
it can get wrong: that the answer is *the installed estimator's* rather than something the
route computed, that a request which does not validate is refused in the envelope naming
the field, that the boundary still holds over a route carrying an issue body, and that an
estimator answering outside the caller's vocabularies is a ``500`` this service logs rather
than a value that crosses the gateway.

The last of those is why this file builds its own applications: the estimator is on
``app.state``, so a suite can install one that misbehaves — which is the case no estimator
anybody has written yet would produce on purpose, and the one the guard exists for.
"""

import logging
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine.api.estimate import (
    ESCALATION_POLL_ROUTE,
    ESCALATION_RETRY_AFTER_HEADER,
    ESCALATION_STATUS,
    ESTIMATE_ROUTE,
)
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import (
    INTERNAL_ERROR_MESSAGE,
    VALIDATION_FAILED,
    VALIDATION_MESSAGE,
)
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.estimation.contract import Estimate, EstimateRequest
from ouroboros_engine.main import create_app
from ouroboros_engine.settings import Settings

ESTIMATE_PATH = f"{V0_PREFIX}{ESTIMATE_ROUTE}"


class FixedEstimator:
    """An estimator that answers with whatever a test handed it.

    Attributes:
        name: What it would write into a trace. Never read from here — the answer it
            returns carries its own — but the protocol has it and an estimator without one
            would not be one.
    """

    name = "fixed-for-test"

    def __init__(self, estimate: Estimate) -> None:
        """Hold the answer to give.

        Args:
            estimate: What every call returns.
        """
        self._estimate = estimate

    def estimate(self, request: EstimateRequest) -> Estimate:  # noqa: ARG002
        """Answer with the held estimate.

        Args:
            request: Ignored — the point of this estimator is that the route's behaviour
                does not depend on what it did with the request.

        Returns:
            The estimate this was built with.
        """
        return self._estimate


@contextmanager
def _serving(
    settings: Settings,
    internal_key: str,
    estimator: object,
    *,
    raise_server_exceptions: bool = True,
) -> Iterator[TestClient]:
    """An authenticated client for an application with a given estimator installed.

    Args:
        settings: Configuration to build the application from.
        internal_key: The shared secret to send, so the guard lets the request through.
        estimator: What to install on ``app.state.estimator`` — the one line
            :func:`ouroboros_engine.main.create_app` writes, and the one L.2 changes.
        raise_server_exceptions: ``False`` to read the ``500`` the application sends
            rather than having the test client re-raise what the route threw.

    Yields:
        A client bound to the application.
    """
    app = create_app(settings)
    app.state.estimator = estimator

    with TestClient(
        app,
        headers={INTERNAL_KEY_HEADER: internal_key},
        raise_server_exceptions=raise_server_exceptions,
    ) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# The round trip
# ---------------------------------------------------------------------------


def test_an_issue_is_sized(client: TestClient, estimate_body: dict) -> None:
    response = client.post(ESTIMATE_PATH, json=estimate_body)

    assert response.status_code == 200


def test_the_answer_carries_exactly_the_documented_fields(
    client: TestClient, estimate_body: dict
) -> None:
    body = client.post(ESTIMATE_PATH, json=estimate_body).json()

    assert set(body) == set(Estimate.model_fields)
    assert set(body["breakdown"]) == {
        "files",
        "est_tokens",
        "cycle_min",
        "cycle_max",
        "est_minutes",
    }
    assert set(body["trace"]) == {"estimator", "tokens_used", "signals"}


def test_the_answer_is_the_installed_estimators(
    settings: Settings,
    internal_key: str,
    estimate_body: dict,
    mockup_estimate: Estimate,
) -> None:
    # The whole design of the seam, asserted: the route serves what the estimator said,
    # so L.2 and O.2 are a new class rather than an edit to this module.
    with _serving(settings, internal_key, FixedEstimator(mockup_estimate)) as client:
        body = client.post(ESTIMATE_PATH, json=estimate_body).json()

    assert body == mockup_estimate.model_dump()


def test_the_heuristic_is_the_estimator_installed_by_default(
    client: TestClient, estimate_body: dict
) -> None:
    # L.2's rule engine, and provenance is decision K10's: this is where a deployment that
    # thinks it has a model estimator finds out which one it actually has. The estimate's
    # own arithmetic is `tests/test_estimation_heuristic.py`'s — what the route owns is that
    # `create_app` installed it at all.
    body = client.post(ESTIMATE_PATH, json=estimate_body).json()

    assert body["trace"]["estimator"] == "heuristic-v0"
    assert body["trace"]["tokens_used"] == 0
    assert body["breakdown"]["files"] == []


def test_an_issue_opened_without_a_description_can_be_sized(
    client: TestClient, estimate_body: dict
) -> None:
    # GitHub's body is nullable and K.1 mirrors that, so `null` is a value rather than a
    # missing field — most issues in the mockup's table have one.
    response = client.post(
        ESTIMATE_PATH,
        json=estimate_body | {"issue": {**estimate_body["issue"], "body": None}},
    )

    assert response.status_code == 200


def test_an_issue_with_no_labels_can_be_sized(
    client: TestClient, estimate_body: dict
) -> None:
    issue = {**estimate_body["issue"], "labels": []}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert response.status_code == 200


def test_the_answer_is_drawn_from_the_vocabularies_the_caller_offered(
    client: TestClient, estimate_body: dict
) -> None:
    body = client.post(ESTIMATE_PATH, json=estimate_body).json()

    assert body["suggested_workflow"] in estimate_body["context"]["workflow_tags"]
    assert body["routed_model"] in estimate_body["context"]["model_defaults"].values()


# ---------------------------------------------------------------------------
# What an operator is told
# ---------------------------------------------------------------------------


def test_a_sizing_is_logged_with_what_answered_it(
    client: TestClient, estimate_body: dict, caplog: pytest.LogCaptureFixture
) -> None:
    # "Which estimator sized #485, and how sure was it" is the question a re-estimation
    # argument starts from, and the answer should not need a second request.
    with caplog.at_level(logging.INFO, logger="ouroboros_engine.api.estimate"):
        client.post(ESTIMATE_PATH, json=estimate_body)

    # By logger rather than by position: the test client's own HTTP log lands after this
    # one, and `records[-1]` would be asserting about httpx.
    sizings = [
        record
        for record in caplog.records
        if record.name == "ouroboros_engine.api.estimate"
    ]
    assert len(sizings) == 1, "one line per sizing, no more and no fewer"
    record = sizings[0]

    assert record.repo == "acme-robotics/helios-firmware"
    assert record.number == 485
    assert record.estimator == "heuristic-v0"
    assert record.confidence == 77


def test_the_log_line_carries_no_mirrored_github_content(
    client: TestClient, estimate_body: dict, caplog: pytest.LogCaptureFixture
) -> None:
    # An issue title and body are somebody else's words, mirrored from GitHub — sometimes a
    # customer's bug report with a stack trace or a token in it. A number and a repository
    # name are enough to find the issue again, and are all this record gets.
    secret = "correct-horse-battery-staple"
    issue = {**estimate_body["issue"], "body": secret, "title": secret}

    with caplog.at_level(logging.INFO, logger="ouroboros_engine.api.estimate"):
        client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert secret not in caplog.text


# ---------------------------------------------------------------------------
# A request that does not validate is refused, in the envelope, by name
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("block", ["issue", "context"])
def test_a_missing_block_is_named(
    client: TestClient, estimate_body: dict, block: str
) -> None:
    response = client.post(
        ESTIMATE_PATH, json={k: v for k, v in estimate_body.items() if k != block}
    )

    assert response.status_code == 422
    assert block in response.json()["details"]


def test_a_refusal_is_the_error_envelope(
    client: TestClient, estimate_body: dict
) -> None:
    body = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": {}}).json()

    assert body["code"] == VALIDATION_FAILED
    assert body["message"] == VALIDATION_MESSAGE
    assert body["details"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("number", 0),
        ("number", 1.5),
        ("title", ""),
        ("title", "x" * 257),
        ("body", 5),
        ("repo", "helios-firmware"),
        ("repo", "acme robotics/helios firmware"),
        ("labels", ["", "i2c"]),
        ("labels", "bug"),
    ],
)
def test_a_malformed_issue_field_is_refused_and_named(
    client: TestClient, estimate_body: dict, field: str, value: object
) -> None:
    issue = {**estimate_body["issue"], field: value}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert response.status_code == 422
    # Keyed the way the caller wrote it — `issue.repo`, not `body.issue.repo` — so each
    # message can be shown against the input that produced it.
    assert any(key.startswith(f"issue.{field}") for key in response.json()["details"])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("workflow_tags", []),
        ("workflow_tags", [""]),
        ("workflow_tags", "standard-fix"),
        ("model_defaults", {}),
        ("model_defaults", {"default": ""}),
        ("model_defaults", ["claude-fable-5"]),
    ],
)
def test_a_context_that_offers_no_usable_vocabulary_is_refused(
    client: TestClient, estimate_body: dict, field: str, value: object
) -> None:
    # `suggested_workflow` and `routed_model` are required, and this service holds no list
    # of either — so a request offering none has no answer the contract can give, and that
    # is a refusal rather than an estimate carrying a field the caller cannot use.
    context = {**estimate_body["context"], field: value}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"context": context})

    assert response.status_code == 422
    assert any(key.startswith(f"context.{field}") for key in response.json()["details"])


def test_a_property_the_contract_does_not_declare_is_refused(
    client: TestClient, estimate_body: dict
) -> None:
    # Closed, like the exemplar: a caller that misspells a field is told so rather than
    # having it silently dropped and getting an estimate made without it.
    issue = {**estimate_body["issue"], "lables": ["bug"]}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert response.status_code == 422
    assert "issue.lables" in response.json()["details"]


def test_every_invalid_field_is_named_rather_than_only_the_first(
    client: TestClient, estimate_body: dict
) -> None:
    issue = {**estimate_body["issue"], "number": 0, "title": ""}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert {"issue.number", "issue.title"} <= set(response.json()["details"])


def test_a_refusal_never_echoes_the_issue_it_refused(
    client: TestClient, estimate_body: dict
) -> None:
    # An issue body is mirrored GitHub content — a customer's bug report, sometimes with
    # a stack trace or a token in it — and this answer is read and logged by a service
    # that answers a browser. FastAPI's own 422 would carry it back in `detail[].input`.
    secret = "correct-horse-battery-staple"
    issue = {**estimate_body["issue"], "number": 0, "body": secret}

    response = client.post(ESTIMATE_PATH, json=estimate_body | {"issue": issue})

    assert response.status_code == 422
    assert secret not in response.text


# ---------------------------------------------------------------------------
# An estimator that answers outside the offer never reaches the gateway
# ---------------------------------------------------------------------------


def test_an_estimator_that_invents_a_workflow_tag_fails_the_request(
    settings: Settings,
    internal_key: str,
    estimate_body: dict,
    mockup_estimate: Estimate,
) -> None:
    invented = mockup_estimate.model_copy(update={"suggested_workflow": "made-up-loop"})

    with _serving(
        settings,
        internal_key,
        FixedEstimator(invented),
        raise_server_exceptions=False,
    ) as client:
        response = client.post(ESTIMATE_PATH, json=estimate_body)

    assert response.status_code == 500


def test_an_estimator_that_invents_a_model_fails_the_request(
    settings: Settings,
    internal_key: str,
    estimate_body: dict,
    mockup_estimate: Estimate,
) -> None:
    invented = mockup_estimate.model_copy(update={"routed_model": "gpt-from-nowhere"})

    with _serving(
        settings,
        internal_key,
        FixedEstimator(invented),
        raise_server_exceptions=False,
    ) as client:
        response = client.post(ESTIMATE_PATH, json=estimate_body)

    assert response.status_code == 500


def test_the_caller_is_told_nothing_about_what_the_estimator_did(
    settings: Settings,
    internal_key: str,
    estimate_body: dict,
    mockup_estimate: Estimate,
) -> None:
    # This is the service's bug, not the caller's, so it answers like every other 5xx:
    # one constant sentence, and the real diagnosis in a log an operator reads.
    invented = mockup_estimate.model_copy(update={"suggested_workflow": "made-up-loop"})

    with _serving(
        settings,
        internal_key,
        FixedEstimator(invented),
        raise_server_exceptions=False,
    ) as client:
        response = client.post(ESTIMATE_PATH, json=estimate_body)

    assert response.json() == {
        "code": "internal_error",
        "message": INTERNAL_ERROR_MESSAGE,
        "details": {},
    }
    assert "made-up-loop" not in response.text


# ---------------------------------------------------------------------------
# The boundary
# ---------------------------------------------------------------------------


def test_the_route_is_behind_the_internal_boundary(
    anonymous_client: TestClient, estimate_body: dict
) -> None:
    response = anonymous_client.post(ESTIMATE_PATH, json=estimate_body)

    assert response.status_code == 401


def test_an_unauthenticated_request_is_refused_before_its_body_is_read(
    anonymous_client: TestClient,
) -> None:
    # A body that would 422 gets the 401 instead: the guard runs before routing, so an
    # unauthenticated caller cannot use validation messages to learn the request shape.
    response = anonymous_client.post(ESTIMATE_PATH, json={"issue": {}})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


# ---------------------------------------------------------------------------
# The document, and the escalation path it specifies but does not serve
# ---------------------------------------------------------------------------


def test_the_route_is_in_the_openapi_document(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert ESTIMATE_PATH in document["paths"]


def test_the_route_is_tagged_as_the_versioned_contract(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][ESTIMATE_PATH]["post"]["tags"] == ["v0"]


def test_the_documented_request_body_is_required(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][ESTIMATE_PATH]["post"]["requestBody"]["required"] is True


@pytest.mark.parametrize("status", ["401", "422"])
def test_the_route_documents_the_refusals_it_can_answer_with(
    client: TestClient, status: str
) -> None:
    document = client.get("/openapi.json").json()

    assert status in document["paths"][ESTIMATE_PATH]["post"]["responses"]


def _escalation(client: TestClient) -> dict:
    """The escalation block the operation documents.

    Args:
        client: A client for the application serving the committed document.

    Returns:
        The operation's ``x-async-escalation`` object.
    """
    document = client.get("/openapi.json").json()
    return document["paths"][ESTIMATE_PATH]["post"]["x-async-escalation"]


def test_the_escalation_path_is_documented(client: TestClient) -> None:
    # The acceptance criterion: v0 answers synchronously, and the 202-plus-poll path O.2
    # will need is written down now — because rewriting the contract then would ripple
    # through L.3, M.1 and N.3.
    escalation = _escalation(client)

    assert escalation["status"] == ESCALATION_STATUS
    assert escalation["poll"] == ESCALATION_POLL_ROUTE
    assert escalation["retry-after-header"] == ESCALATION_RETRY_AFTER_HEADER
    assert escalation["description"].strip()


def test_the_escalation_polls_under_this_operations_own_path(
    client: TestClient,
) -> None:
    # An extension of the operation rather than a second surface, so the escalation adds
    # a route to /v0 and takes nothing away — which is what keeps it inside the version
    # rule rather than making it a /v1.
    assert _escalation(client)["poll"].startswith(ESTIMATE_PATH)


def test_the_escalation_is_specified_and_not_promised(client: TestClient) -> None:
    # It is an extension rather than a documented 202 response, deliberately: this
    # service cannot answer 202 today, and a `responses` entry is a promise a caller may
    # hold it to. When O.2 can answer one, the entry moves and this test with it.
    document = client.get("/openapi.json").json()

    assert (
        str(ESCALATION_STATUS)
        not in document["paths"][ESTIMATE_PATH]["post"]["responses"]
    )


def test_v0_answers_synchronously(client: TestClient, estimate_body: dict) -> None:
    assert (
        client.post(ESTIMATE_PATH, json=estimate_body).status_code != ESCALATION_STATUS
    )
