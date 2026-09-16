"""``POST /v0/plan`` — the route, its boundary, and what it will not put in a log.

The batch itself is :mod:`tests.test_planning_planner`'s and its shape is
:mod:`tests.test_planning_contract`'s. What is left for the route is the handful of things
only it can get wrong: that the answer is *the installed planner's* rather than something
the route computed, that a request which does not validate is refused in the envelope naming
the field, that a narrative with no outline is a ``200`` and not an error, that the boundary
still holds over a route carrying somebody's product description, and that a planner
answering outside the caller's vocabulary is a ``500`` this service logs rather than a batch
that crosses the gateway.

This file builds its own applications for the last of those: the planner is on
``app.state``, so a suite can install one that misbehaves — which is the case no planner
anybody has written yet would produce on purpose, and the one the guard exists for.
"""

import logging
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine.api.plan import PLAN_ROUTE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import (
    INTERNAL_ERROR_MESSAGE,
    VALIDATION_FAILED,
    VALIDATION_MESSAGE,
)
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.planning.contract import Plan
from ouroboros_engine.planning.outline_planner import (
    NARRATIVE_ONLY_NOTE,
    OUTLINE_PLANNER,
)
from ouroboros_engine.settings import Settings
from test_planning_planner import FixedPlanner

PLAN_PATH = f"{V0_PREFIX}{PLAN_ROUTE}"


@contextmanager
def _serving(
    settings: Settings,
    internal_key: str,
    planner: object,
    *,
    raise_server_exceptions: bool = True,
) -> Iterator[TestClient]:
    """An authenticated client for an application with a given planner installed.

    Args:
        settings: Configuration to build the application from.
        internal_key: The shared secret to send, so the guard lets the request through.
        planner: What to install on ``app.state.planner`` — the one line
            :func:`ouroboros_engine.main.create_app` writes, and the one AN.1 changes.
        raise_server_exceptions: ``False`` to read the ``500`` the application sends rather
            than having the test client re-raise what the route threw.

    Yields:
        A client bound to the application.
    """
    from ouroboros_engine.main import create_app

    app = create_app(settings)
    app.state.planner = planner

    with TestClient(
        app,
        headers={INTERNAL_KEY_HEADER: internal_key},
        raise_server_exceptions=raise_server_exceptions,
    ) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# The round trip
# ---------------------------------------------------------------------------


def test_a_batch_is_drafted(client: TestClient, plan_body: dict) -> None:
    response = client.post(PLAN_PATH, json=plan_body)

    assert response.status_code == 200


def test_the_answer_carries_exactly_the_documented_fields(
    client: TestClient, plan_body: dict
) -> None:
    body = client.post(PLAN_PATH, json=plan_body).json()

    assert set(body) == set(Plan.model_fields)
    assert set(body["drafts"][0]) == {
        "local_key",
        "title",
        "body",
        "suggested_workflow",
        "dependencies",
    }


def test_the_outline_parser_is_the_planner_installed_by_default(
    client: TestClient, plan_body: dict
) -> None:
    # Decision K10's question, asked of a running application: this is where a deployment
    # that thinks it has the LLM planner finds out which one it actually has.
    body = client.post(PLAN_PATH, json=plan_body).json()

    assert body["planner"] == OUTLINE_PLANNER


def test_the_mockup_s_outline_answers_with_its_six_drafts(
    client: TestClient, plan_body: dict
) -> None:
    body = client.post(PLAN_PATH, json=plan_body).json()

    assert len(body["drafts"]) == 6


def test_the_answer_is_the_installed_planner_s(
    settings: Settings, internal_key: str, plan_body: dict
) -> None:
    # The whole design of the seam, asserted: the route serves what the planner said, so
    # AN.1 is a new class rather than an edit to this module.
    answer = Plan(
        drafts=[
            {
                "local_key": "OTA-1",
                "title": "Something no parser would produce",
                "body": "",
                "suggested_workflow": "feature-loop",
                "dependencies": [],
            }
        ],
        planner="llm-v1 · claude-sonnet-5",
        notes=[],
    )

    with _serving(settings, internal_key, FixedPlanner(answer)) as client:
        body = client.post(PLAN_PATH, json=plan_body).json()

    assert body == answer.model_dump()


def test_a_narrative_without_an_outline_is_answered_rather_than_refused(
    client: TestClient, plan_body: dict
) -> None:
    # The case the whole staging exists for: it is a 200 carrying one draft and guidance,
    # not a 422. The page renders the note as designed guidance.
    response = client.post(PLAN_PATH, json=plan_body | {"outline": None})

    assert response.status_code == 200
    body = response.json()
    assert len(body["drafts"]) == 1
    assert body["notes"] == [NARRATIVE_ONLY_NOTE]


# ---------------------------------------------------------------------------
# What an operator is told
# ---------------------------------------------------------------------------


def test_a_drafting_is_logged_with_what_answered_it(
    client: TestClient, plan_body: dict, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="ouroboros_engine.api.plan"):
        client.post(PLAN_PATH, json=plan_body)

    # By logger rather than by position: the test client's own HTTP log lands after this
    # one, and `records[-1]` would be asserting about httpx.
    draftings = [
        record
        for record in caplog.records
        if record.name == "ouroboros_engine.api.plan"
    ]
    assert len(draftings) == 1, "one line per batch, no more and no fewer"
    record = draftings[0]

    assert record.planner == OUTLINE_PLANNER
    assert record.drafts == 6
    assert record.dependencies == 4
    assert record.local_key_prefix == "OTA"


def test_the_log_line_carries_none_of_what_the_caller_described(
    client: TestClient, plan_body: dict, caplog: pytest.LogCaptureFixture
) -> None:
    # A narrative and an outline are a customer's own description of their product and
    # their plans for it. Counts and provenance are enough to find the batch again, and are
    # all this record gets.
    secret = "correct-horse-battery-staple"

    with caplog.at_level(logging.INFO, logger="ouroboros_engine.api.plan"):
        client.post(
            PLAN_PATH,
            json=plan_body | {"narrative": secret, "outline": f"- {secret}"},
        )

    assert secret not in caplog.text


# ---------------------------------------------------------------------------
# A request that does not validate is refused, in the envelope, by name
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("field", ["narrative", "outline", "context"])
def test_a_missing_field_is_named(
    client: TestClient, plan_body: dict, field: str
) -> None:
    response = client.post(
        PLAN_PATH, json={k: v for k, v in plan_body.items() if k != field}
    )

    assert response.status_code == 422
    assert field in response.json()["details"]


def test_a_refusal_is_the_error_envelope(client: TestClient, plan_body: dict) -> None:
    body = client.post(PLAN_PATH, json=plan_body | {"narrative": ""}).json()

    assert body["code"] == VALIDATION_FAILED
    assert body["message"] == VALIDATION_MESSAGE
    assert body["details"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("workflow_tags", []),
        ("workflow_tags", [""]),
        ("workflow_tags", "feature-loop"),
        ("local_key_prefix", "ota"),
        ("local_key_prefix", ""),
        ("milestone", 5),
    ],
)
def test_a_malformed_context_field_is_refused_and_named(
    client: TestClient, plan_body: dict, field: str, value: object
) -> None:
    context = {**plan_body["context"], field: value}

    response = client.post(PLAN_PATH, json=plan_body | {"context": context})

    assert response.status_code == 422
    # Keyed the way the caller wrote it — `context.local_key_prefix`, not
    # `body.context.local_key_prefix` — so each message can be shown against its input.
    assert any(key.startswith(f"context.{field}") for key in response.json()["details"])


def test_a_property_the_contract_does_not_declare_is_refused(
    client: TestClient, plan_body: dict
) -> None:
    # Closed, like every request under /v0: a caller that misspells `outline` is told so
    # rather than having it dropped and getting a single draft back.
    response = client.post(PLAN_PATH, json=plan_body | {"outlne": "- typo"})

    assert response.status_code == 422
    assert "outlne" in response.json()["details"]


def test_a_refusal_never_echoes_what_it_refused(
    client: TestClient, plan_body: dict
) -> None:
    # The narrative is the customer's own words, and this answer is read and logged by a
    # service that answers a browser. FastAPI's own 422 would carry it back in
    # `detail[].input`.
    secret = "correct-horse-battery-staple"

    response = client.post(
        PLAN_PATH,
        json=plan_body | {"narrative": secret, "context": {}},
    )

    assert response.status_code == 422
    assert secret not in response.text


# ---------------------------------------------------------------------------
# A planner that answers outside the offer never reaches the gateway
# ---------------------------------------------------------------------------


def test_a_planner_that_invents_a_workflow_tag_fails_the_request(
    settings: Settings, internal_key: str, plan_body: dict
) -> None:
    invented = Plan(
        drafts=[
            {
                "local_key": "OTA-1",
                "title": "A drafted ticket",
                "body": "",
                "suggested_workflow": "made-up-loop",
                "dependencies": [],
            }
        ],
        planner=OUTLINE_PLANNER,
        notes=[],
    )

    with _serving(
        settings, internal_key, FixedPlanner(invented), raise_server_exceptions=False
    ) as client:
        response = client.post(PLAN_PATH, json=plan_body)

    assert response.status_code == 500


def test_the_caller_is_told_nothing_about_what_the_planner_did(
    settings: Settings, internal_key: str, plan_body: dict
) -> None:
    # This is the service's bug, not the caller's, so it answers like every other 5xx: one
    # constant sentence, and the real diagnosis in a log an operator reads.
    invented = Plan(
        drafts=[
            {
                "local_key": "OTA-1",
                "title": "A drafted ticket",
                "body": "",
                "suggested_workflow": "made-up-loop",
                "dependencies": [],
            }
        ],
        planner=OUTLINE_PLANNER,
        notes=[],
    )

    with _serving(
        settings, internal_key, FixedPlanner(invented), raise_server_exceptions=False
    ) as client:
        response = client.post(PLAN_PATH, json=plan_body)

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
    anonymous_client: TestClient, plan_body: dict
) -> None:
    response = anonymous_client.post(PLAN_PATH, json=plan_body)

    assert response.status_code == 401


def test_an_unauthenticated_request_is_refused_before_its_body_is_read(
    anonymous_client: TestClient,
) -> None:
    # A body that would 422 gets the 401 instead: the guard runs before routing, so an
    # unauthenticated caller cannot use validation messages to learn the request shape.
    response = anonymous_client.post(PLAN_PATH, json={"narrative": ""})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------


def test_the_route_is_in_the_openapi_document(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert PLAN_PATH in document["paths"]


def test_the_route_is_tagged_as_the_versioned_contract(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][PLAN_PATH]["post"]["tags"] == ["v0"]


def test_the_documented_request_body_is_required(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][PLAN_PATH]["post"]["requestBody"]["required"] is True


@pytest.mark.parametrize("status", ["401", "422"])
def test_the_route_documents_the_refusals_it_can_answer_with(
    client: TestClient, status: str
) -> None:
    document = client.get("/openapi.json").json()

    assert status in document["paths"][PLAN_PATH]["post"]["responses"]
