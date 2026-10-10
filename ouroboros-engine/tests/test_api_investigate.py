"""``/v0/investigate`` over HTTP: the 202, the refusals, the key and the installed runner."""

import copy

import pytest
from fastapi.testclient import TestClient

from investigation_fakes import (
    INVESTIGATION,
    FakeControl,
    RecordedModel,
    request_for,
)
from ouroboros_engine.api.investigate import INVESTIGATE_ROUTE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import VALIDATION_FAILED
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.investigation.contract import (
    AT_CAPACITY,
    LOOP_VERSION,
    PLAYBOOK_UNSUPPORTED,
    task_ref,
)
from ouroboros_engine.investigation.loop import InvestigationLoop
from ouroboros_engine.investigation.runner import InvestigationRunner
from ouroboros_engine.settings import Settings

INVESTIGATE_PATH = f"{V0_PREFIX}{INVESTIGATE_ROUTE}"


def _body() -> dict:
    return copy.deepcopy(request_for().model_dump(mode="json"))


def _client(
    settings: Settings, control: FakeControl, **runner: int
) -> tuple[TestClient, InvestigationRunner]:
    from ouroboros_engine.main import create_app

    app = create_app(settings)
    installed = InvestigationRunner(
        InvestigationLoop(control, RecordedModel()), **runner
    )
    app.state.investigations = installed
    client = TestClient(app, headers={INTERNAL_KEY_HEADER: settings.shared_secret})
    return client, installed


def test_an_investigation_is_accepted_and_runs_to_a_brief_in_the_background(
    settings: Settings,
) -> None:
    control = FakeControl()
    client, runner = _client(settings, control)

    with client:
        response = client.post(INVESTIGATE_PATH, json=_body())
        assert runner.wait(INVESTIGATION, timeout=10)

    assert response.status_code == 202
    assert response.json() == {
        "investigation": INVESTIGATION,
        "task": task_ref(INVESTIGATION),
        "state": "accepted",
        "loop_version": LOOP_VERSION,
    }
    assert control.status == "brief_ready"
    assert control.provenance["alias"] == "researcher-long-ctx"


def test_a_repeated_submit_of_a_running_investigation_starts_nothing(
    settings: Settings,
) -> None:
    import threading

    control = FakeControl()
    gate = threading.Event()
    control.before_tool = lambda: gate.wait(timeout=10)
    client, runner = _client(settings, control)

    with client:
        client.post(INVESTIGATE_PATH, json=_body())
        again = client.post(INVESTIGATE_PATH, json=_body())
        held = runner.holds(INVESTIGATION)
        gate.set()
        assert runner.wait(INVESTIGATION, timeout=10)

    assert again.status_code == 202 and again.json()["state"] == "already_running"
    assert held
    assert control.attempt == 1


def test_a_playbook_this_build_cannot_deliver_is_refused_before_any_work(
    settings: Settings,
) -> None:
    control = FakeControl()
    client, _ = _client(settings, control)
    body = _body()
    body["kind"]["playbook"]["synthesis_template"] = "gap_analysis@9"

    with client:
        response = client.post(INVESTIGATE_PATH, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == PLAYBOOK_UNSUPPORTED
    assert response.json()["details"] == {"synthesis_template": "gap_analysis@9"}
    assert control.attempt == 0


def test_a_busy_runner_answers_503_and_starts_nothing(settings: Settings) -> None:
    control = FakeControl()
    client, _ = _client(settings, control, max_concurrent=0)

    with client:
        response = client.post(INVESTIGATE_PATH, json=_body())

    assert response.status_code == 503
    assert response.json()["code"] == AT_CAPACITY
    assert control.attempt == 0


@pytest.mark.parametrize(
    "mutate",
    [
        lambda body: body.update(investigation="RS-127"),
        lambda body: body.update(depth="exhaustive"),
        lambda body: body.update(tools=[]),
        lambda body: body.update(question="  ".strip()),
        lambda body: body["budget"].update(operations=0),
        lambda body: body["budget"].update(spend_cents=-1),
        lambda body: body["kind"]["playbook"].update(deliverables=["brief", "podcast"]),
        lambda body: body["tools"][0].update(operations=["delete"]),
        lambda body: body.update(surprise=True),
    ],
)
def test_a_body_outside_the_contract_is_the_422_envelope(
    settings: Settings, mutate
) -> None:
    control = FakeControl()
    client, _ = _client(settings, control)
    body = _body()
    mutate(body)

    with client:
        response = client.post(INVESTIGATE_PATH, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED
    assert control.attempt == 0


def test_the_route_is_behind_the_internal_key(settings: Settings) -> None:
    from ouroboros_engine.main import create_app

    with TestClient(create_app(settings)) as bare:
        assert bare.post(INVESTIGATE_PATH, json=_body()).status_code == 401


def test_the_application_installs_a_runner_that_reaches_the_control_plane(
    settings: Settings,
) -> None:
    from ouroboros_engine.main import create_app

    assert isinstance(create_app(settings).state.investigations, InvestigationRunner)
