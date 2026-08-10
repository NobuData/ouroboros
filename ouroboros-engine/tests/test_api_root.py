"""The service identity route and the OpenAPI document generated around it."""

from fastapi.testclient import TestClient

from ouroboros_engine import __version__


def test_the_root_route_identifies_the_service(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"service": "ouroboros-engine", "version": __version__}


def test_the_root_route_is_json(client: TestClient) -> None:
    response = client.get("/")

    assert response.headers["content-type"].startswith("application/json")


def test_an_unknown_path_is_a_404(client: TestClient) -> None:
    # Nothing else is served yet: /healthz arrives with #51 and /v0 with #52.
    response = client.get("/healthz")

    assert response.status_code == 404


def test_the_openapi_document_describes_the_service(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    assert document["info"]["title"] == "ouroboros-engine"
    assert document["info"]["version"] == __version__
    assert "/" in document["paths"]


def test_the_root_response_is_documented_by_schema(client: TestClient) -> None:
    document = client.get("/openapi.json").json()

    schema = document["components"]["schemas"]["ServiceIdentity"]

    assert set(schema["properties"]) == {"service", "version"}
