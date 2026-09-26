"""The runner, the CLI, the settings and the clock: the driver's ways in and its guard rails."""

import json

import pytest

from ouroboros_simulator import cli
from ouroboros_simulator.clock import Clock
from ouroboros_simulator.runner import SimulationResult, run_scenario
from ouroboros_simulator.settings import (
    SimulatorConfigurationError,
    SimulatorSettings,
    load_simulator_settings,
)
from ouroboros_simulator.transport import Response, TransportError
from simulator_fake import (
    ENGINE_SECRET,
    SIMULATOR_SECRET,
    FakeClock,
    FakeControlPlane,
    simulator_settings,
)

# --- the runner -----------------------------------------------------------------------------


def test_the_run_is_announced_as_soon_as_it_opens() -> None:
    fake = FakeControlPlane()
    announced: list[str] = []

    result = run_scenario(
        "happy-path",
        simulator_settings(),
        transport=fake,
        clock=FakeClock(),
        on_open=lambda run: announced.append(run.id),
    )

    assert announced == [result.run_id]
    assert result.loop_seq == 1848
    assert result.guardrail_failures == [[]]


def test_a_refusal_midway_is_a_failed_result_that_names_its_run() -> None:
    fake = FakeControlPlane()
    fake.fail_on[("PUT", "/files")] = (404, "run_not_found")

    result = run_scenario(
        "happy-path", simulator_settings(), transport=fake, clock=FakeClock()
    )

    assert result.outcome == "failed"
    assert result.run_id == fake.run_id
    assert result.detail is not None
    assert result.detail.startswith("run_not_found")


def test_an_unmarked_run_is_a_failed_result_with_nothing_written() -> None:
    fake = FakeControlPlane(simulated=False)

    result = run_scenario(
        "happy-path", simulator_settings(), transport=fake, clock=FakeClock()
    )

    assert result.outcome == "failed"
    assert result.run_id is None
    assert "real run" in (result.detail or "")
    assert len(fake.requests) == 1


def test_an_unreachable_control_plane_is_a_failed_result() -> None:
    class Down:
        def send(self, _request: object) -> Response:
            raise TransportError("POST http://x failed after 3 attempts: URLError")

    result = run_scenario(
        "happy-path", simulator_settings(), transport=Down(), clock=FakeClock()
    )

    assert result.outcome == "failed"
    assert "URLError" in (result.detail or "")


def test_an_unknown_scenario_is_a_key_error() -> None:
    with pytest.raises(KeyError):
        run_scenario(
            "no-such-scenario", simulator_settings(), transport=FakeControlPlane()
        )


def test_the_executors_secret_is_refused_before_anything_is_sent() -> None:
    fake = FakeControlPlane()
    settings = SimulatorSettings(
        OURO_RUN_SIMULATOR_SECRET=ENGINE_SECRET,
        OURO_ENGINE_SHARED_SECRET=ENGINE_SECRET,
    )

    with pytest.raises(SimulatorConfigurationError, match="equals"):
        run_scenario("happy-path", settings, transport=fake)

    assert fake.requests == []


def test_a_result_is_published_in_camel_case() -> None:
    result = SimulationResult(
        scenario="happy-path", outcome="completed", run_id="r", loop_seq=1
    )

    assert result.as_json() == {
        "scenario": "happy-path",
        "outcome": "completed",
        "runId": "r",
        "loopSeq": 1,
        "simulated": None,
        "steers": [],
        "acks": [],
        "guardrailFailures": [],
        "detail": None,
    }


# --- settings -------------------------------------------------------------------------------


def test_settings_read_the_two_variables_rest_reads_too(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OURO_RUN_SIMULATOR_SECRET", SIMULATOR_SECRET)
    monkeypatch.setenv("OURO_REST_URL", "http://rest:4000")

    settings = load_simulator_settings()

    assert settings.simulator_secret == SIMULATOR_SECRET
    assert settings.rest_url == "http://rest:4000"


def test_the_rest_url_defaults_to_the_development_stacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OURO_RUN_SIMULATOR_SECRET", SIMULATOR_SECRET)

    assert load_simulator_settings().rest_url == "http://localhost:4000"


def test_a_missing_simulator_secret_is_named() -> None:
    with pytest.raises(SimulatorConfigurationError, match="OURO_RUN_SIMULATOR_SECRET"):
        load_simulator_settings()


def test_a_simulator_secret_equal_to_the_executors_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OURO_RUN_SIMULATOR_SECRET", "same")
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", "same")

    with pytest.raises(SimulatorConfigurationError, match="cannot tell"):
        load_simulator_settings()


def test_a_refusal_never_echoes_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OURO_RUN_SIMULATOR_SECRET", "hunter2-secret")
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", "hunter2-secret")

    with pytest.raises(SimulatorConfigurationError) as refused:
        load_simulator_settings()

    assert "hunter2" not in str(refused.value)


# --- the clock ------------------------------------------------------------------------------


def test_scripted_time_is_divided_by_the_speed(monkeypatch: pytest.MonkeyPatch) -> None:
    slept: list[float] = []
    monkeypatch.setattr("ouroboros_simulator.clock.time.sleep", slept.append)

    Clock(speed=60).scripted(120)
    Clock(speed=60).sleep(0)

    assert slept == [2.0], "a zero sleep does not reach the system"


@pytest.mark.parametrize("speed", [0, -1])
def test_speed_must_be_positive(speed: float) -> None:
    with pytest.raises(ValueError, match="positive"):
        Clock(speed=speed)


def test_timestamps_are_the_contracts_iso_form() -> None:
    stamp = Clock().iso_now()

    assert stamp.endswith("Z")
    assert len(stamp) == len("2026-09-22T14:25:01.000Z")


# --- the CLI --------------------------------------------------------------------------------


def test_list_prints_every_scenario(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["--list"]) == 0

    out = capsys.readouterr().out
    for name in (
        "happy-path",
        "482-gate-return",
        "guardrail-violation",
        "control-responsive",
        "correction-round",
    ):
        assert name in out


def test_no_scenario_is_a_usage_error(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main([]) == 2
    assert "name a scenario" in capsys.readouterr().err


def test_an_unknown_scenario_is_refused_by_the_parser() -> None:
    with pytest.raises(SystemExit) as exited:
        cli.main(["nope"])

    assert exited.value.code == 2


def test_a_non_positive_speed_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["happy-path", "--speed", "0"]) == 2
    assert "--speed" in capsys.readouterr().err


def test_a_missing_secret_is_a_configuration_error(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["happy-path"]) == 2
    assert "OURO_RUN_SIMULATOR_SECRET" in capsys.readouterr().err


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    monkeypatch.setenv("OURO_RUN_SIMULATOR_SECRET", SIMULATOR_SECRET)
    calls: list[dict[str, object]] = []

    def fake_run(name: str, settings: SimulatorSettings, **options: object) -> object:
        calls.append({"name": name, "settings": settings, **options})
        outcome = "failed" if name == "guardrail-violation" else "completed"
        return SimulationResult(
            scenario=name,
            outcome=outcome,
            run_id="run-1",
            loop_seq=1848,
            simulated=True,
            acks=[{"kind": "steer", "detail": "steering applied to attempt 2"}],
            steers=[{"stage": "implement", "attempt": 2, "text": "x"}],
            guardrail_failures=[["ci_config"]],
            detail="why" if outcome == "failed" else None,
        )

    monkeypatch.setattr(cli, "run_scenario", fake_run)
    return calls


def test_a_run_passes_the_target_speed_and_url_through(
    configured: list[dict[str, object]], capsys: pytest.CaptureFixture[str]
) -> None:
    code = cli.main(
        [
            "482-gate-return",
            "--speed",
            "60",
            "--rest-url",
            "http://rest:4000",
            "--ticket",
            "#999",
        ]
    )

    assert code == 0
    call = configured[0]
    assert call["speed"] == 60
    assert call["settings"].rest_url == "http://rest:4000"  # type: ignore[attr-defined]
    assert call["target"].ticket == "#999"  # type: ignore[attr-defined]
    out = capsys.readouterr().out
    assert "482-gate-return: completed" in out
    assert "steering applied to attempt 2" in out
    assert "change-set 1: ci_config" in out


def test_json_output_is_the_result(
    configured: list[dict[str, object]], capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["happy-path", "--json"]) == 0

    printed = json.loads(capsys.readouterr().out)
    assert printed["runId"] == "run-1"
    assert printed["simulated"] is True
    assert configured


def test_a_failed_simulation_exits_one(
    configured: list[dict[str, object]], capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["guardrail-violation"]) == 1
    assert "why" in capsys.readouterr().out
    assert configured
