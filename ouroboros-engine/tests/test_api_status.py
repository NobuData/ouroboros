"""`/v0/status` — the version and uptime of the process behind the internal boundary."""

from fastapi.testclient import TestClient

from ouroboros_engine import __version__
from ouroboros_engine.api.status import V0_PREFIX
from ouroboros_engine.core.uptime import Uptime

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

    assert set(body) == {"service", "version", "uptime_seconds"}, (
        "ouroboros-rest codes against this shape; a field added here is a contract "
        "change and belongs to #52"
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

    assert set(schema["properties"]) == {"service", "version", "uptime_seconds"}


def test_status_is_tagged_as_the_versioned_contract(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["paths"][STATUS_PATH]["get"]["tags"] == ["v0"]
