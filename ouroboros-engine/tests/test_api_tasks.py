"""`POST /v0/tasks/echo` — the round trip the rest of the contract is written to.

Three things are being asserted here, and only the first is about echoing. That the round
trip works; that a request which does not validate is *refused* rather than half-accepted,
in the envelope, naming the field; and that the boundary still holds over a route that
takes a body — a `401` for an unauthenticated caller, before anything reads the body at
all.
"""

import time

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine import __version__
from ouroboros_engine.api.tasks import MAX_TASK_KIND_LENGTH
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import VALIDATION_FAILED, VALIDATION_MESSAGE
from ouroboros_engine.tasks.contract import (
    TASK_KIND_UNKNOWN,
    TASK_NOT_FOUND,
    TASK_QUEUE_FULL,
)

ECHO_PATH = f"{V0_PREFIX}/tasks/echo"

#: A request the route accepts, as a caller would write it. Copied and edited by the
#: tests below, so what each one is really varying is one field.
VALID_TASK = {"task_kind": "echo", "payload": {"note": "hello"}}


def test_a_valid_task_is_accepted(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json=VALID_TASK)

    assert response.status_code == 200
    assert response.json()["accepted"] is True


def test_the_task_comes_back_exactly_as_it_was_sent(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json=VALID_TASK)

    assert response.json()["echo"] == VALID_TASK


def test_a_nested_payload_survives_the_round_trip(client: TestClient) -> None:
    # The payload is an open object and the contract says nothing about its contents, so
    # what has to be true is that nothing here is flattened, reordered or coerced.
    payload = {
        "issue": {"number": 52, "labels": ["mvp", "engine"]},
        "dry_run": False,
        "ratio": 0.5,
        "unset": None,
    }

    response = client.post(
        ECHO_PATH, json={"task_kind": "plan.issue", "payload": payload}
    )

    assert response.json()["echo"]["payload"] == payload


def test_an_empty_payload_is_a_payload(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json={"task_kind": "echo", "payload": {}})

    assert response.status_code == 200
    assert response.json()["echo"]["payload"] == {}


def test_the_answer_names_the_build_that_answered(client: TestClient) -> None:
    body = client.post(ECHO_PATH, json=VALID_TASK).json()

    assert body["engine_version"] == __version__


def test_the_answer_carries_exactly_the_documented_fields(client: TestClient) -> None:
    body = client.post(ECHO_PATH, json=VALID_TASK).json()

    assert set(body) == {"accepted", "echo", "engine_version"}, (
        "ouroboros-rest's typed client codes against this shape; adding a field is a "
        "contract change, and removing one is a /v1 (ouroboros_engine.api.v0)"
    )


@pytest.mark.parametrize(
    "kind",
    [
        "echo",
        "plan.issue",
        "build_container",
        "review-pr",
        "a",
        "task2",
        "a" * MAX_TASK_KIND_LENGTH,
    ],
)
def test_a_well_formed_kind_is_accepted(client: TestClient, kind: str) -> None:
    response = client.post(ECHO_PATH, json={"task_kind": kind, "payload": {}})

    assert response.status_code == 200, f"{kind!r} is a well-formed task kind"


@pytest.mark.parametrize(
    "kind",
    [
        "",
        " echo",
        "echo ",
        "Echo",
        "ECHO",
        "2fast",
        ".echo",
        "echo.",
        "echo..twice",
        "echo/task",
        "echo task",
        "a" * (MAX_TASK_KIND_LENGTH + 1),
    ],
)
def test_a_malformed_kind_is_refused(client: TestClient, kind: str) -> None:
    response = client.post(ECHO_PATH, json={"task_kind": kind, "payload": {}})

    assert response.status_code == 422, f"{kind!r} is not a task kind"
    assert "task_kind" in response.json()["details"]


def test_a_refusal_is_the_error_envelope(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json={"task_kind": "Echo", "payload": {}})

    body = response.json()
    assert set(body) == {"code", "message", "details"}
    assert body["code"] == VALIDATION_FAILED
    assert body["message"] == VALIDATION_MESSAGE


def test_a_missing_field_is_named(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json={"payload": {}})

    assert response.status_code == 422
    assert "task_kind" in response.json()["details"]


def test_every_missing_field_is_named_rather_than_only_the_first(
    client: TestClient,
) -> None:
    response = client.post(ECHO_PATH, json={})

    assert set(response.json()["details"]) == {"task_kind", "payload"}, (
        "a caller fixing one field at a time makes one round trip per field"
    )


def test_a_property_the_contract_does_not_declare_is_refused(
    client: TestClient,
) -> None:
    # Closed by construction: the failure this prevents is a caller misspelling a field,
    # having it silently dropped, and reading a `200` as confirmation it was honoured.
    response = client.post(ECHO_PATH, json={**VALID_TASK, "priority": "urgent"})

    assert response.status_code == 422
    assert "priority" in response.json()["details"]


def test_a_payload_that_is_not_an_object_is_refused(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json={"task_kind": "echo", "payload": "hello"})

    assert response.status_code == 422
    assert "payload" in response.json()["details"]


def test_a_body_that_is_not_an_object_is_refused(client: TestClient) -> None:
    response = client.post(ECHO_PATH, json=["echo"])

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED


def test_a_body_that_is_not_json_is_refused_in_the_envelope(client: TestClient) -> None:
    response = client.post(
        ECHO_PATH,
        content=b"{not json",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    assert set(response.json()) == {"code", "message", "details"}, (
        "a parse failure answers in the envelope too — the gateway parses one shape"
    )


def test_a_refusal_never_echoes_what_was_refused(client: TestClient) -> None:
    # FastAPI's own 422 carries the rejected input back in `detail[].input`. A task
    # payload is whatever the caller put in it, and this route's answer is read and
    # logged by a service that answers a browser, so the value never leaves the process.
    secret = "correct-horse-battery-staple"

    response = client.post(
        ECHO_PATH, json={"task_kind": "Nope", "payload": {"token": secret}}
    )

    assert response.status_code == 422
    assert secret not in response.text


def test_the_route_is_behind_the_internal_boundary(
    anonymous_client: TestClient,
) -> None:
    response = anonymous_client.post(ECHO_PATH, json=VALID_TASK)

    assert response.status_code == 401


def test_an_unauthenticated_request_is_refused_before_its_body_is_read(
    anonymous_client: TestClient,
) -> None:
    # A body that would 422 gets the 401 instead: the guard runs before routing, so an
    # unauthenticated caller cannot use validation messages to learn the request shape.
    response = anonymous_client.post(ECHO_PATH, json={"task_kind": "Nope"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


def test_the_route_is_in_the_openapi_document(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert ECHO_PATH in document["paths"]


def test_the_route_is_tagged_as_the_versioned_contract(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][ECHO_PATH]["post"]["tags"] == ["v0"]


def test_the_documented_request_body_is_required(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][ECHO_PATH]["post"]["requestBody"]["required"] is True


def test_the_route_documents_the_refusal_it_can_answer_with(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert "422" in document["paths"][ECHO_PATH]["post"]["responses"], (
        "an operation that validates a body can refuse one, and a caller reading the "
        "document has to know what that looks like"
    )


# ---------------------------------------------------------------------------
# The queue: POST /v0/tasks, GET /v0/tasks/{task_id}, POST /v0/tasks/{task_id}/cancel
# ---------------------------------------------------------------------------

TASKS_PATH = f"{V0_PREFIX}/tasks"


def _poll_until_final(client: TestClient, task_id: str) -> dict:
    """Poll a task the way a caller would, until it is final.

    Args:
        client: The authenticated client.
        task_id: The task.

    Returns:
        The final record.
    """
    for _ in range(500):
        record = client.get(f"{TASKS_PATH}/{task_id}").json()
        if record["status"] in ("done", "failed", "cancelled"):
            return record
        time.sleep(0.01)
    raise AssertionError(f"task {task_id} never finished")


def test_a_sleep_task_is_submitted_polled_and_completed(client: TestClient) -> None:
    submitted = client.post(
        TASKS_PATH, json={"task_kind": "sleep", "payload": {"seconds": 0.05}}
    )

    assert submitted.status_code == 202
    assert submitted.json()["status"] == "queued"

    record = _poll_until_final(client, submitted.json()["task_id"])

    assert record["status"] == "done"
    assert record["result"] == {"slept_seconds": 0.05}
    assert record["error"] is None
    assert record["finished_at"] is not None


def test_a_running_task_is_cancelled_through_the_route(client: TestClient) -> None:
    task_id = client.post(
        TASKS_PATH, json={"task_kind": "sleep", "payload": {"seconds": 300}}
    ).json()["task_id"]

    cancelled = client.post(f"{TASKS_PATH}/{task_id}/cancel")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert client.get(f"{TASKS_PATH}/{task_id}").json()["status"] == "cancelled"


def test_an_unknown_kind_is_refused_naming_what_is_registered(
    client: TestClient,
) -> None:
    response = client.post(TASKS_PATH, json={"task_kind": "build", "payload": {}})

    assert response.status_code == 422
    assert response.json()["code"] == TASK_KIND_UNKNOWN
    assert response.json()["details"] == {
        "task_kind": "build",
        "registered": ["echo", "sleep"],
    }


def test_a_payload_the_kind_cannot_run_is_refused_by_field(client: TestClient) -> None:
    response = client.post(
        TASKS_PATH, json={"task_kind": "sleep", "payload": {"seconds": -1}}
    )

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED
    assert list(response.json()["details"]) == ["payload.seconds"]


def test_a_malformed_submission_is_refused_before_the_queue(client: TestClient) -> None:
    response = client.post(TASKS_PATH, json={"task_kind": "Sleep", "extra": 1})

    assert response.status_code == 422
    assert set(response.json()["details"]) == {"task_kind", "extra"}


@pytest.mark.parametrize("suffix", ["", "/cancel"])
def test_an_unknown_id_is_not_found(client: TestClient, suffix: str) -> None:
    method = client.post if suffix else client.get

    response = method(f"{TASKS_PATH}/no-such-task{suffix}")

    assert response.status_code == 404
    assert response.json()["code"] == TASK_NOT_FOUND
    assert response.json()["details"] == {"task_id": "no-such-task"}


def test_a_queue_that_is_not_running_refuses_with_503(client: TestClient) -> None:
    client.portal.call(client.app.state.tasks.stop)  # type: ignore[attr-defined]

    response = client.post(TASKS_PATH, json={"task_kind": "echo", "payload": {}})

    assert response.status_code == 503
    assert response.json()["code"] == TASK_QUEUE_FULL


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", TASKS_PATH),
        ("GET", f"{TASKS_PATH}/any"),
        ("POST", f"{TASKS_PATH}/any/cancel"),
    ],
)
def test_the_queue_routes_need_the_internal_key(
    anonymous_client: TestClient, method: str, path: str
) -> None:
    assert anonymous_client.request(method, path, json={}).status_code == 401
