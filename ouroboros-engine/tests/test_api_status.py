"""`/v0/status` — the version and uptime of the process behind the internal boundary."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine import __version__
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.uptime import Uptime
from ouroboros_engine.execution.executors.claude_agent_env import bundled_cli
from ouroboros_engine.tasks.queue import TaskQueue
from ouroboros_engine.tasks.registry import default_registry as default_task_registry

STATUS_PATH = f"{V0_PREFIX}/status"


def test_status_reports_the_service_and_its_installed_version(
    client: TestClient,
) -> None:
    response = client.get(STATUS_PATH)

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "ouroboros-engine"
    assert body["version"] == __version__


def test_status_reports_the_uptime_of_this_process(client: TestClient) -> None:
    # Fixed at a value no real test run reaches, so the assertion is about the number
    # being read from the application's stopwatch rather than about how fast pytest is.
    ticks = iter([0.0, 61.5])
    client.app.state.uptime = Uptime(monotonic=lambda: next(ticks))

    body = client.get(STATUS_PATH).json()

    assert body["uptime_seconds"] == 61.5


def test_uptime_is_rounded_to_milliseconds(client: TestClient) -> None:
    ticks = iter([0.0, 1.23456789])
    client.app.state.uptime = Uptime(monotonic=lambda: next(ticks))

    body = client.get(STATUS_PATH).json()

    assert body["uptime_seconds"] == 1.235, (
        "sixteen digits of float noise reads as precision this measurement lacks"
    )


def test_uptime_grows_between_calls(client: TestClient) -> None:
    first = client.get(STATUS_PATH).json()["uptime_seconds"]
    second = client.get(STATUS_PATH).json()["uptime_seconds"]

    assert 0 <= first <= second


def test_status_carries_exactly_the_documented_fields(client: TestClient) -> None:
    body = client.get(STATUS_PATH).json()

    assert set(body) == {
        "service",
        "version",
        "uptime_seconds",
        "executors",
        "task_queue",
        "task_queue_depth",
    }, (
        "ouroboros-rest's typed client codes against this shape; adding a field is a "
        "contract change, and removing one is a /v1 (ouroboros_engine.api.v0)"
    )


def test_status_never_reports_the_shared_secret(
    client: TestClient, internal_key: str
) -> None:
    response = client.get(STATUS_PATH)

    assert internal_key not in response.text


def test_status_lives_under_the_versioned_prefix() -> None:
    assert V0_PREFIX == "/v0", (
        "the middleware's guard, ouroboros-rest's client and #52's contract all "
        "assume this prefix"
    )


def test_status_is_in_the_openapi_document(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert STATUS_PATH in document["paths"]


def test_the_status_response_is_documented_by_schema(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    schema = document["components"]["schemas"]["ServiceStatus"]

    assert set(schema["properties"]) == {
        "service",
        "version",
        "uptime_seconds",
        "executors",
        "task_queue",
        "task_queue_depth",
    }


def test_status_reports_no_executor_until_one_is_registered(
    client_without_harness: TestClient,
) -> None:
    # #160: REST's admission (#1312) refuses every claim `no_executor` while this is empty.
    assert client_without_harness.get(STATUS_PATH).json()["executors"] == []


@pytest.mark.skipif(
    bundled_cli() is None, reason="the bundled Claude Agent CLI is absent"
)
def test_status_reports_the_harness_wherever_its_cli_is_installed(
    client: TestClient,
) -> None:
    # DH.3 (#1308): the composition root registers the Claude Agent executor.
    assert client.get(STATUS_PATH).json()["executors"] == ["harness"]


def test_status_reports_the_registered_executor_kinds_sorted(
    client: TestClient,
) -> None:
    registry = client.app.state.executors
    registry.register("harness", lambda: None)
    registry.register("native", lambda: None)

    assert client.get(STATUS_PATH).json()["executors"] == ["harness", "native"]


def test_status_is_tagged_as_the_versioned_contract(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][STATUS_PATH]["get"]["tags"] == ["v0"]


def test_status_reports_a_running_task_queue_and_its_depth(client: TestClient) -> None:
    # The `client` fixture runs the lifespan, so the worker pool is up and idle.
    body = client.get(STATUS_PATH).json()

    assert body["task_queue"] is True
    assert body["task_queue_depth"] == 0


def test_status_reports_a_stopped_task_queue(client: TestClient) -> None:
    queue = TaskQueue(default_task_registry())
    client.app.state.tasks = queue

    body = client.get(STATUS_PATH).json()

    assert body["task_queue"] is False, "a pool that never started accepts nothing"
    assert body["task_queue_depth"] == 0


def test_the_queue_counts_tasks_waiting_for_a_worker() -> None:
    async def scenario() -> tuple[int, int, int]:
        queue = TaskQueue(default_task_registry(), workers=1)
        before = queue.depth
        await queue.start()
        try:
            queue.submit("echo", {"message": "a"})
            queue.submit("echo", {"message": "b"})
            # Nothing has yielded to the worker yet, so both are still waiting.
            waiting = queue.depth
        finally:
            await queue.stop()
        return before, waiting, queue.depth

    assert asyncio.run(scenario()) == (0, 2, 0)
