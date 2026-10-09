"""``POST /v0/copilot-workflow`` over HTTP: framing, the installed runner, the key, the 422."""

import json
from collections.abc import Iterator

from fastapi.testclient import TestClient

from ouroboros_engine.api.copilot import COPILOT_ROUTE, NDJSON_MEDIA_TYPE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneRequest,
)
from ouroboros_engine.copilot.contract import GATEWAY_UNAVAILABLE
from ouroboros_engine.copilot.gateway import GatewayError
from ouroboros_engine.copilot.turn import CopilotTurnRunner
from ouroboros_engine.core.errors import VALIDATION_FAILED
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.settings import Settings

COPILOT_PATH = f"{V0_PREFIX}{COPILOT_ROUTE}"

_BODY = {
    "alias": "coder-max",
    "session": "5eed008a-0000-4000-8000-000000000001",
    "context": {"draft": None, "draft_label": "v0.0"},
    "transcript": [{"role": "user", "text": "security patches: second review"}],
}


class ScriptedGateway:
    """Answers every invocation with the same lines, or the same failure."""

    def __init__(
        self, lines: list[dict] | None = None, failure: GatewayError | None = None
    ) -> None:
        """Script the answer."""
        self.lines = lines or []
        self.failure = failure

    def stream(self, _outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Answer the script."""
        if self.failure is not None:
            raise self.failure
        for line in self.lines:
            yield json.dumps(line) + "\n"


def _client(settings: Settings, gateway: ScriptedGateway) -> TestClient:
    from ouroboros_engine.main import create_app

    app = create_app(settings)
    app.state.copilot = CopilotTurnRunner(
        ControlPlaneClient("http://rest", "k"), gateway
    )
    return TestClient(app, headers={INTERNAL_KEY_HEADER: settings.shared_secret})


def _events(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_a_turn_streams_ndjson_events_in_order(settings: Settings) -> None:
    gateway = ScriptedGateway(
        [
            {"kind": "delta", "hop": 0, "text": "Drafted.\n"},
            {"kind": "done", "hop": 0, "finish_reason": "stop"},
        ]
    )
    with _client(settings, gateway) as client:
        response = client.post(COPILOT_PATH, json=_BODY)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(NDJSON_MEDIA_TYPE)
    assert _events(response) == [
        {"kind": "delta", "text": "Drafted.\n"},
        {"kind": "done", "finish_reason": "stop"},
    ]


def test_the_gateway_unavailable_state_is_a_200_with_an_error_event(
    settings: Settings,
) -> None:
    gateway = ScriptedGateway(
        failure=GatewayError(GATEWAY_UNAVAILABLE, "AF.2 is not here")
    )
    with _client(settings, gateway) as client:
        response = client.post(COPILOT_PATH, json=_BODY)

    assert response.status_code == 200
    assert _events(response) == [
        {"kind": "error", "code": GATEWAY_UNAVAILABLE, "message": "AF.2 is not here"}
    ]


def test_the_production_app_installs_a_runner(client: TestClient) -> None:
    assert isinstance(client.app.state.copilot, CopilotTurnRunner)


def test_a_body_outside_the_contract_is_a_422(client: TestClient) -> None:
    response = client.post(COPILOT_PATH, json={**_BODY, "transcript": []})

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == VALIDATION_FAILED
    assert "transcript" in body["details"]


def test_an_undeclared_property_is_refused(client: TestClient) -> None:
    response = client.post(COPILOT_PATH, json={**_BODY, "definition": {}})

    assert response.status_code == 422


def test_the_route_is_behind_the_internal_key(anonymous_client: TestClient) -> None:
    response = anonymous_client.post(COPILOT_PATH, json=_BODY)

    assert response.status_code == 401
