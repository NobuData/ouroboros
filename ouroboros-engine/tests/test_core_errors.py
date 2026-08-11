"""The error envelope: one shape for every failure, including the ones no route wrote.

Two halves. The functions that build an envelope are asserted directly, because they are
what both this service and the shape of `ouroboros-rest`'s answers depend on; the handlers
are asserted through a real application, because the point of them is what happens to a
request nobody wrote a route for.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from ouroboros_engine.core.errors import (
    INTERNAL_ERROR_MESSAGE,
    VALIDATION_FAILED,
    VALIDATION_MESSAGE,
    ErrorEnvelope,
    code_for_status,
    envelope,
    field_messages,
)
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.main import create_app
from ouroboros_engine.settings import Settings

#: A path no router claims, and no test registers a route at.
UNCLAIMED_PATH = "/v0/there-is-no-such-route"


@contextmanager
def _serving(
    settings: Settings,
    internal_key: str,
    handler: object = None,
    *,
    path: str = "/v0/raises",
    raise_server_exceptions: bool = True,
) -> Iterator[TestClient]:
    """An authenticated client for an application, optionally with a route bolted on.

    A route added here is a route the guard, the router and the handlers all see exactly
    as they see a real one — which is what makes "an unhandled exception answers in the
    envelope" an assertion about the application rather than about a handler called by
    hand.

    Args:
        settings: Configuration to build the application from.
        internal_key: The shared secret to send, so the guard lets the request through.
        handler: A coroutine function to serve at ``path``, or ``None`` for a plain
            application.
        path: Where to serve ``handler``.
        raise_server_exceptions: ``False`` to read the ``500`` the application sends
            rather than having the test client re-raise what the route threw.

    Yields:
        A client bound to the application.
    """
    app = create_app(settings)
    if handler is not None:
        app.add_api_route(path, handler, methods=["GET"], include_in_schema=False)

    with TestClient(
        app,
        headers={INTERNAL_KEY_HEADER: internal_key},
        raise_server_exceptions=raise_server_exceptions,
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# The envelope itself
# ---------------------------------------------------------------------------


def test_an_envelope_carries_the_three_documented_keys() -> None:
    assert set(envelope("some_code", "Something happened.")) == {
        "code",
        "message",
        "details",
    }


def test_details_is_empty_rather_than_absent() -> None:
    # `ouroboros-rest` makes the same promise, so a caller reading `details["field"]`
    # never has to check whether `details` is there first.
    assert envelope("some_code", "Something happened.")["details"] == {}


def test_details_is_carried_through_when_there_is_some() -> None:
    body = envelope(VALIDATION_FAILED, VALIDATION_MESSAGE, {"task_kind": ["is wrong"]})

    assert body["details"] == {"task_kind": ["is wrong"]}


def test_an_envelope_cannot_be_built_without_details() -> None:
    # The model requires it rather than defaulting it: a default would let a caller
    # produce a body the document says cannot exist.
    with pytest.raises(ValueError, match="details"):
        ErrorEnvelope(code="some_code", message="Something happened.")


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (400, "bad_request"),
        (401, "unauthenticated"),
        (403, "forbidden"),
        (404, "not_found"),
        (405, "method_not_allowed"),
        (406, "not_acceptable"),
        (415, "unsupported_media_type"),
        (422, "unprocessable_entity"),
        (500, "internal_error"),
    ],
)
def test_each_status_has_the_code_the_gateway_expects(status: int, code: str) -> None:
    assert code_for_status(status) == code


@pytest.mark.parametrize(
    ("status", "code"),
    [(418, "bad_request"), (429, "bad_request"), (503, "internal_error")],
)
def test_a_status_without_its_own_code_is_still_named(status: int, code: str) -> None:
    # Derived from which half of the range it falls in rather than defaulted to one
    # catch-all, so a caller's `match code` has no hole in it.
    assert code_for_status(status) == code


# ---------------------------------------------------------------------------
# Turning pydantic's report into `details`
# ---------------------------------------------------------------------------


def test_a_field_is_keyed_by_the_name_the_caller_wrote() -> None:
    fields = field_messages([{"loc": ("body", "task_kind"), "msg": "Field required"}])

    assert fields == {"task_kind": ["Field required"]}, (
        "the caller sent `task_kind`, not `body.task_kind` — the key has to be the one "
        "they can point at in their own request"
    )


def test_a_nested_field_is_addressed_the_way_a_reader_would_write_it() -> None:
    fields = field_messages(
        [{"loc": ("body", "payload", "items", 0, "name"), "msg": "Field required"}]
    )

    assert fields == {"payload.items.0.name": ["Field required"]}


def test_two_complaints_about_one_field_are_both_reported() -> None:
    fields = field_messages(
        [
            {"loc": ("body", "task_kind"), "msg": "String should match pattern"},
            {"loc": ("body", "task_kind"), "msg": "String should have at most 64"},
        ]
    )

    assert len(fields["task_kind"]) == 2, "the last message must not win"


def test_a_fault_in_the_whole_body_keeps_the_part_it_was_in() -> None:
    # What pydantic reports when the body is not an object at all. There is no field to
    # blame, and an empty key would be no key.
    fields = field_messages([{"loc": ("body",), "msg": "Input should be a valid dict"}])

    assert fields == {"body": ["Input should be a valid dict"]}


def test_a_fault_with_no_location_is_still_reported() -> None:
    fields = field_messages([{"loc": (), "msg": "Something is wrong"}])

    assert fields == {"request": ["Something is wrong"]}


def test_a_query_parameter_is_keyed_by_its_own_name() -> None:
    fields = field_messages([{"loc": ("query", "limit"), "msg": "Field required"}])

    assert fields == {"limit": ["Field required"]}


# ---------------------------------------------------------------------------
# The handlers, through an application
# ---------------------------------------------------------------------------


def test_a_path_no_router_claims_answers_in_the_envelope(client: TestClient) -> None:
    response = client.get(UNCLAIMED_PATH)

    assert response.status_code == 404
    assert response.json() == {
        "code": "not_found",
        "message": "Not Found",
        "details": {},
    }


def test_a_method_a_path_does_not_allow_answers_in_the_envelope(
    client: TestClient,
) -> None:
    response = client.delete("/v0/status")

    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"


def test_a_rejected_method_still_says_which_ones_are_allowed(
    client: TestClient,
) -> None:
    # The envelope replaces the body, not the headers. A 405 without `Allow` is a worse
    # answer than the one the framework would have sent.
    response = client.delete("/v0/status")

    assert "GET" in response.headers.get("allow", "")


def test_a_deliberate_server_error_says_nothing_about_itself(
    settings: Settings, internal_key: str
) -> None:
    async def unavailable() -> None:
        raise HTTPException(status_code=503, detail="the queue at 10.0.0.7 is full")

    with _serving(settings, internal_key, unavailable) as client:
        response = client.get("/v0/raises")

    assert response.status_code == 503
    assert response.json()["message"] == INTERNAL_ERROR_MESSAGE
    assert "10.0.0.7" not in response.text


def test_a_deliberate_client_error_keeps_its_own_message(
    settings: Settings, internal_key: str
) -> None:
    async def refused() -> None:
        raise HTTPException(status_code=409, detail="That task is already running.")

    with _serving(settings, internal_key, refused) as client:
        response = client.get("/v0/raises")

    assert response.status_code == 409
    assert response.json()["message"] == "That task is already running."


def test_an_unhandled_exception_answers_in_the_envelope(
    settings: Settings, internal_key: str
) -> None:
    async def broken() -> None:
        raise RuntimeError("connection to 10.0.0.7 failed for user ouroboros")

    with _serving(
        settings, internal_key, broken, raise_server_exceptions=False
    ) as client:
        response = client.get("/v0/raises")

    assert response.status_code == 500
    assert response.json() == {
        "code": "internal_error",
        "message": INTERNAL_ERROR_MESSAGE,
        "details": {},
    }


def test_an_unhandled_exception_tells_the_log_what_it_would_not_tell_a_caller(
    settings: Settings, internal_key: str, capsys: pytest.CaptureFixture[str]
) -> None:
    async def broken() -> None:
        raise RuntimeError("connection to 10.0.0.7 failed for user ouroboros")

    with _serving(
        settings, internal_key, broken, raise_server_exceptions=False
    ) as client:
        response = client.get("/v0/raises")

    # Read from the stream the process really logs to rather than through `caplog`:
    # building an application configures logging, which replaces the root handler the
    # fixture had installed. This is also the stricter assertion — it is what a container
    # platform would collect.
    logged = capsys.readouterr().err

    assert "10.0.0.7" not in response.text, "the caller is told nothing"
    assert "10.0.0.7" in logged, "and the operator is told everything"
    assert "Traceback" in logged, "without the traceback there is nothing to diagnose"


def test_a_server_error_never_leaks_the_shared_secret(
    settings: Settings, internal_key: str
) -> None:
    async def broken() -> None:
        raise RuntimeError("boom")

    with _serving(
        settings, internal_key, broken, raise_server_exceptions=False
    ) as client:
        response = client.get("/v0/raises")

    assert internal_key not in response.text


def test_the_boundary_still_answers_before_the_handlers_do(
    anonymous_client: TestClient,
) -> None:
    # A 404 handler that ran first would tell an unauthenticated caller which paths
    # exist, which is the whole thing the guard-before-routing order prevents.
    response = anonymous_client.get(UNCLAIMED_PATH)

    assert response.status_code == 401
