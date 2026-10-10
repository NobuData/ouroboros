"""``/v0/skills/run`` over HTTP: the result, the refusals, the key and the installed runner."""

import json

from fastapi.testclient import TestClient

from ouroboros_engine.api.skills import SKILL_INPUT_INVALID, SKILLS_RUN_ROUTE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import VALIDATION_FAILED
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.investigation.model import ModelFailureError
from ouroboros_engine.settings import Settings
from ouroboros_engine.skills.contract import SKILL_MODEL_FAILED, SKILL_OUTPUT_INVALID
from ouroboros_engine.skills.runner import SkillRunner
from skills_fakes import ROADMAP, ScriptedModel, issues_request, roadmap_request

RUN_PATH = f"{V0_PREFIX}{SKILLS_RUN_ROUTE}"


def _client(settings: Settings, model: ScriptedModel | None) -> TestClient:
    from ouroboros_engine.main import create_app

    app = create_app(settings)
    if model is not None:
        app.state.skills = SkillRunner(model)
    return TestClient(app, headers={INTERNAL_KEY_HEADER: settings.shared_secret})


def _body() -> dict:
    return roadmap_request().model_dump(mode="json")


def test_a_run_answers_the_validated_roadmap(settings: Settings) -> None:
    with _client(settings, ScriptedModel(json.dumps(ROADMAP))) as client:
        response = client.post(RUN_PATH, json=_body())

    assert response.status_code == 200
    answer = response.json()
    assert answer["roadmap"] == ROADMAP
    assert answer["issues"] is None
    assert (answer["skill"], answer["version"], answer["attempts"]) == (
        "create-roadmap",
        3,
        1,
    )
    assert answer["usage"][0]["model"] == "claude-fable-5"


def test_an_issue_run_answers_one_body_per_item(settings: Settings) -> None:
    script = json.dumps(
        {
            "issues": [
                {"key": "dock-mpc", "body": "MPC."},
                {"key": "dock-retry", "body": "Retry."},
            ]
        }
    )
    with _client(settings, ScriptedModel(script)) as client:
        response = client.post(RUN_PATH, json=issues_request().model_dump(mode="json"))

    assert response.status_code == 200
    assert response.json()["issues"] == [
        {"key": "dock-mpc", "body": "MPC."},
        {"key": "dock-retry", "body": "Retry."},
    ]


def test_an_answer_outside_the_contract_twice_is_a_422(settings: Settings) -> None:
    with _client(settings, ScriptedModel("prose", "more prose")) as client:
        response = client.post(RUN_PATH, json=_body())

    assert response.status_code == 422
    assert response.json() == {
        "code": SKILL_OUTPUT_INVALID,
        "message": "The model did not answer in the shape the skill's output requires.",
        "details": {"problem": "the answer holds no JSON object"},
    }


def test_an_input_that_cannot_be_run_is_a_422_and_calls_no_model(
    settings: Settings,
) -> None:
    model = ScriptedModel()
    body = issues_request().model_dump(mode="json")
    body["input"] = {"items": []}

    with _client(settings, model) as client:
        response = client.post(RUN_PATH, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == SKILL_INPUT_INVALID
    assert model.calls == []


def test_a_failed_model_call_is_a_502_naming_the_gateways_reason(
    settings: Settings,
) -> None:
    failure = ModelFailureError("chain_exhausted", "Every hop failed.")
    with _client(settings, ScriptedModel(failure)) as client:
        response = client.post(RUN_PATH, json=_body())

    assert response.status_code == 502
    assert response.json() == {
        "code": SKILL_MODEL_FAILED,
        "message": "Every hop failed.",
        "details": {"reason": "chain_exhausted"},
    }


def test_a_malformed_body_is_the_validation_envelope(settings: Settings) -> None:
    body = _body()
    body["output"] = "prose"

    with _client(settings, ScriptedModel()) as client:
        response = client.post(RUN_PATH, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED


def test_the_route_is_behind_the_internal_key(settings: Settings) -> None:
    with _client(settings, ScriptedModel()) as client:
        response = client.post(
            RUN_PATH, json=_body(), headers={INTERNAL_KEY_HEADER: ""}
        )

    assert response.status_code == 401


def test_the_installed_runner_reports_the_missing_gateway(
    settings: Settings, monkeypatch
) -> None:
    # Nothing is installed over the default: the run goes to the real gateway client, which
    # has no control plane to reach here and must say so as a 502, not a 500.
    from ouroboros_engine.copilot.gateway import GatewayError, UrllibGateway

    def refuse(_self: UrllibGateway, _outgoing: object):
        raise GatewayError(
            "gateway_unavailable", "The invocation gateway is not available."
        )

    monkeypatch.setattr(UrllibGateway, "stream", refuse)

    with _client(settings, None) as client:
        response = client.post(RUN_PATH, json=_body())

    assert response.status_code == 502
    assert response.json()["details"] == {"reason": "gateway_unavailable"}
