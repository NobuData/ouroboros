"""``/dev/*``: mounted only on a development engine with the simulator configured."""

import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.openapi.utils import get_openapi
from fastapi.testclient import TestClient

from ouroboros_engine import main
from ouroboros_engine.main import create_app
from ouroboros_engine.settings import Settings
from ouroboros_simulator import api
from ouroboros_simulator.runner import SimulationResult
from ouroboros_simulator.settings import SimulatorConfigurationError
from simulator_fake import ENGINE_SECRET as INTERNAL_KEY
from simulator_fake import SIMULATOR_SECRET


def _settings(**overrides: str) -> Settings:
    values = {
        "OURO_ENGINE_SHARED_SECRET": INTERNAL_KEY,
        "OURO_RUN_SIMULATOR_SECRET": SIMULATOR_SECRET,
        "OURO_REST_URL": "http://rest.test:4000",
    }
    values.update(overrides)
    return Settings(**values)


def _dev_paths(app: Any) -> set[str]:
    # Asked of FastAPI's own generator, as tests/test_openapi.py does: `app.routes` holds
    # included routers as nodes of their own in this FastAPI.
    generated = get_openapi(title=app.title, version=app.version, routes=app.routes)
    return {path for path in generated["paths"] if path.startswith("/dev")}


@pytest.fixture
def started(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Replace the runner with one that finishes instantly, recording its calls."""
    calls: list[dict[str, Any]] = []

    def fake_run(name: str, settings: Any, **options: Any) -> SimulationResult:
        calls.append({"name": name, "settings": settings, **options})

        class Opened:
            id = "run-1"
            loop_seq = 1848

        options["on_open"](Opened())
        return SimulationResult(
            scenario=name,
            outcome="completed",
            run_id="run-1",
            loop_seq=1848,
            simulated=True,
        )

    monkeypatch.setattr(api, "run_scenario", fake_run)
    return calls


@pytest.fixture
def dev() -> Iterator[TestClient]:
    with TestClient(
        create_app(_settings()), headers={"X-Ouro-Internal-Key": INTERNAL_KEY}
    ) as client:
        yield client


def _wait_finished(client: TestClient, simulation_id: str) -> dict[str, Any]:
    for _ in range(200):
        body = client.get(f"/dev/simulations/{simulation_id}").json()
        if body["state"] == "finished":
            return body
        time.sleep(0.01)
    raise AssertionError("the simulation never finished")


# --- mounting -------------------------------------------------------------------------------


def test_without_the_simulator_secret_nothing_is_mounted() -> None:
    app = create_app(Settings(OURO_ENGINE_SHARED_SECRET=INTERNAL_KEY))

    assert _dev_paths(app) == set()


def test_with_the_secret_a_development_engine_mounts_dev() -> None:
    app = create_app(_settings())

    assert _dev_paths(app) == {
        "/dev/scenarios",
        "/dev/simulations",
        "/dev/simulations/{simulation_id}",
    }


def test_a_build_without_the_driver_mounts_nothing_whatever_the_environment_says(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def absent(name: str) -> None:
        raise ModuleNotFoundError(
            f"No module named {name!r}", name="ouroboros_simulator"
        )

    monkeypatch.setattr(main.importlib, "import_module", absent)

    app = create_app(_settings())

    assert _dev_paths(app) == set()


def test_a_broken_development_install_is_not_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(_name: str) -> None:
        raise ModuleNotFoundError("No module named 'something_it_needs'", name="x")

    monkeypatch.setattr(main.importlib, "import_module", broken)

    with pytest.raises(ModuleNotFoundError):
        create_app(_settings())


def test_an_engine_whose_two_secrets_are_equal_refuses_to_start() -> None:
    with pytest.raises(SimulatorConfigurationError):
        create_app(_settings(OURO_RUN_SIMULATOR_SECRET=INTERNAL_KEY))


def test_dev_is_behind_the_internal_key() -> None:
    with TestClient(create_app(_settings())) as anonymous:
        assert anonymous.get("/dev/scenarios").status_code == 401


def test_the_simulator_reports_to_the_configured_control_plane() -> None:
    app = create_app(_settings())
    registry = app.state.simulations

    assert registry._settings.rest_url == "http://rest.test:4000"
    assert registry._settings.simulator_secret == SIMULATOR_SECRET


# --- the routes -----------------------------------------------------------------------------


def test_the_scenarios_are_listed(dev: TestClient) -> None:
    names = [s["name"] for s in dev.get("/dev/scenarios").json()["scenarios"]]

    assert names == [
        "happy-path",
        "482-gate-return",
        "guardrail-violation",
        "control-responsive",
    ]


def test_a_simulation_starts_in_the_background_and_finishes(
    dev: TestClient, started: list[dict[str, Any]]
) -> None:
    answer = dev.post(
        "/dev/simulations",
        json={"scenario": "482-gate-return", "speed": 60, "target": {"ticket": "#999"}},
    )

    assert answer.status_code == 202
    assert answer.json()["state"] in ("running", "finished")
    finished = _wait_finished(dev, answer.json()["id"])
    assert finished["runId"] == "run-1"
    assert finished["loopSeq"] == 1848
    assert finished["result"]["outcome"] == "completed"
    assert started[0]["speed"] == 60
    assert started[0]["target"].ticket == "#999"
    assert started[0]["target"].workflow == "standard-fix"


def test_an_unknown_scenario_is_404_naming_the_known_ones(dev: TestClient) -> None:
    answer = dev.post("/dev/simulations", json={"scenario": "nope"})

    assert answer.status_code == 404
    assert answer.json()["code"] == "scenario_not_found"
    assert "482-gate-return" in answer.json()["details"]["known"]


@pytest.mark.parametrize(
    "body",
    [
        {"scenario": "happy-path", "speed": 0},
        {"scenario": "happy-path", "extra": True},
        {"scenario": "happy-path", "target": {"organizationId": "o"}},
    ],
)
def test_a_malformed_start_is_refused(dev: TestClient, body: dict[str, Any]) -> None:
    assert dev.post("/dev/simulations", json=body).status_code == 422


def test_an_unknown_simulation_is_404(dev: TestClient) -> None:
    answer = dev.get("/dev/simulations/0123456789abcdef")

    assert answer.status_code == 404
    assert answer.json()["code"] == "simulation_not_found"


def test_a_malformed_simulation_id_is_refused(dev: TestClient) -> None:
    assert dev.get("/dev/simulations/not-an-id").status_code == 422


def test_too_many_running_simulations_is_429(
    dev: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate = threading.Event()

    def blocked(name: str, _settings: Any, **_options: Any) -> SimulationResult:
        gate.wait(5)
        return SimulationResult(scenario=name, outcome="completed")

    monkeypatch.setattr(api, "run_scenario", blocked)
    try:
        for _ in range(api.MAX_RUNNING):
            assert (
                dev.post(
                    "/dev/simulations", json={"scenario": "happy-path"}
                ).status_code
                == 202
            )

        refused = dev.post("/dev/simulations", json={"scenario": "happy-path"})

        assert refused.status_code == 429
        assert refused.json()["code"] == "too_many_simulations"
    finally:
        gate.set()


def test_a_crashing_simulation_is_reported_not_lost(
    dev: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def crash(*_args: Any, **_options: Any) -> SimulationResult:
        raise RuntimeError("boom")

    monkeypatch.setattr(api, "run_scenario", crash)

    answer = dev.post("/dev/simulations", json={"scenario": "happy-path"})
    finished = _wait_finished(dev, answer.json()["id"])

    assert finished["result"]["outcome"] == "failed"
    assert finished["result"]["detail"] == "RuntimeError: boom"


def test_finished_simulations_are_forgotten_past_the_limit(
    started: list[dict[str, Any]],
) -> None:
    registry = api.SimulationRegistry(
        api.SimulatorSettings(OURO_RUN_SIMULATOR_SECRET=SIMULATOR_SECRET)
    )
    body = api.StartSimulation(scenario="happy-path")
    ids = []
    for _ in range(api.MAX_REMEMBERED + 5):
        simulation = registry.start(body)
        assert simulation is not None
        simulation.done.wait(2)
        ids.append(simulation.id)

    assert registry.get(ids[-1]) is not None
    assert registry.get(ids[0]) is None
    assert len(started) == api.MAX_REMEMBERED + 5
