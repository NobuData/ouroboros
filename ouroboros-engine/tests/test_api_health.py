"""Liveness — open, shallow, and shaped the way a probe expects."""

from fastapi.testclient import TestClient

from ouroboros_engine.api.health import HEALTH_PATH


def test_liveness_answers_without_a_key(anonymous_client: TestClient) -> None:
    response = anonymous_client.get(HEALTH_PATH)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_liveness_answers_the_authenticated_caller_the_same_way(
    client: TestClient,
) -> None:
    response = client.get(HEALTH_PATH)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_liveness_is_json(anonymous_client: TestClient) -> None:
    response = anonymous_client.get(HEALTH_PATH)

    assert response.headers["content-type"].startswith("application/json")


def test_the_path_is_the_one_the_healthcheck_will_probe() -> None:
    # docker-compose and the image's HEALTHCHECK (#53) hard-code this string, and
    # ARCHITECTURE.md § 2.3 documents it. Renaming it is a deployment change.
    assert HEALTH_PATH == "/healthz"


def test_liveness_carries_nothing_about_the_engine(
    anonymous_client: TestClient,
) -> None:
    # It answers before the key is checked, so anything it reports is reported to
    # whoever can reach the port — no version, no configuration, no uptime.
    body = anonymous_client.get(HEALTH_PATH).json()

    assert set(body) == {"status"}


def test_liveness_does_not_read_the_configuration(
    anonymous_client: TestClient,
) -> None:
    # A probe that fails when a dependency is unhappy gets the container killed for a
    # reason restarting it will not fix. Deleting the settings out from under it is a
    # blunt way to assert it touches none of them.
    del anonymous_client.app.state.settings

    assert anonymous_client.get(HEALTH_PATH).status_code == 200


def test_liveness_is_in_the_openapi_document(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert HEALTH_PATH in document["paths"]
