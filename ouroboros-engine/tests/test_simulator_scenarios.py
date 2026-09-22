"""The four scenarios, played through the fake control plane.

Each one is checked for the story the issue gives it, and all four are checked for the rules
every run the driver writes must keep: every entry is in order, every write is keyed, every
stage key is a node of the pinned workflow, and model output always names its model.
"""

import json
from pathlib import Path

import pytest

from ouroboros_simulator.runner import run_scenario
from ouroboros_simulator.scenarios import SCENARIOS
from ouroboros_simulator.scenarios.guardrail_violation import planted_aws_key_id
from ouroboros_simulator.session import RunSession, Target
from simulator_fake import (
    FakeClock,
    FakeControlPlane,
    QueuedControl,
    make_session,
    simulator_settings,
)

#: The committed DSL fixture `standard-fix` v14 is seeded from, byte for byte.
_STANDARD_FIX = (
    Path(__file__).resolve().parents[2]
    / "schemas"
    / "workflow-dsl"
    / "fixtures"
    / "valid"
    / "standard-fix.json"
)


def _play(name: str, fake: FakeControlPlane, clock: FakeClock | None = None) -> str:
    """Run one scenario's script through the fake and return its outcome."""
    session = _open(fake, clock or FakeClock())
    return SCENARIOS[name].script(session)


def _open(fake: FakeControlPlane, clock: FakeClock) -> RunSession:
    session = make_session(fake, clock)
    session.open(Target(), "loop/test")
    return session


def _model_bodies(fake: FakeControlPlane) -> list[str]:
    return [e["body"] for e in fake.events if e["actor"] == "model"]


# --- every scenario -------------------------------------------------------------------------


def test_there_are_the_four_scenarios_the_issue_names() -> None:
    assert list(SCENARIOS) == [
        "happy-path",
        "482-gate-return",
        "guardrail-violation",
        "control-responsive",
    ]


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_every_stage_key_is_a_node_of_the_pinned_workflow(name: str) -> None:
    nodes = {
        node["id"]
        for node in json.loads(_STANDARD_FIX.read_text(encoding="utf-8"))["nodes"]
    }
    fake = FakeControlPlane()

    _play(name, fake)

    used = {key for key, _, _ in fake.stage_log}
    assert used <= nodes, used - nodes


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_every_run_keeps_the_contracts_rules(name: str) -> None:
    fake = FakeControlPlane()

    _play(name, fake)

    hints = [event["hint"] for event in fake.events]
    assert hints == sorted(set(hints)), "hints strictly increase"
    keys = [
        r.json["idempotencyKey"] for r in fake.requests if "idempotencyKey" in r.json
    ]
    assert len(keys) == len(set(keys)), "one key per submission"
    assert all(
        e["modelId"] == "claude-fable-5" and e["stageKey"] and e["attempt"]
        for e in fake.events
        if e["actor"] == "model"
    )
    assert any("Simulated run" in (e.get("body") or "") for e in fake.events), (
        "the transcript says so in words too, not only in the flag"
    )


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_every_scenario_opens_at_the_queue_and_skips_the_split_branch(
    name: str,
) -> None:
    fake = FakeControlPlane()

    _play(name, fake)

    assert fake.stage_log[:2] == [
        ("issue-queued", 1, "active"),
        ("issue-queued", 1, "succeeded"),
    ]
    assert ("split", 1, "skipped") in fake.stage_log
    assert ("back-to-queue", 1, "skipped") in fake.stage_log


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_every_scenario_is_simulated_end_to_end_through_the_runner(name: str) -> None:
    fake = FakeControlPlane()

    result = run_scenario(name, simulator_settings(), transport=fake, clock=FakeClock())

    assert result.simulated is True
    assert result.run_id == fake.run_id
    assert result.outcome in ("completed", "needs_human")


# --- happy-path -----------------------------------------------------------------------------


def test_the_happy_path_merges_with_clean_guardrails() -> None:
    fake = FakeControlPlane()

    assert _play("happy-path", fake) == "completed"

    assert fake.stage_log[-1] == ("open-pr", 1, "succeeded")
    assert all(attempt == 1 for _, attempt, _ in fake.stage_log)
    assert not any(status == "failed" for _, _, status in fake.stage_log)
    assert "merged" in fake.events[-1]["body"]
    assert fake.status == "coding", "the contract has no operation that closes a run"


# --- 482-gate-return ------------------------------------------------------------------------


def test_the_gate_returns_the_loop_to_implement_for_attempt_two() -> None:
    fake = FakeControlPlane()

    assert _play("482-gate-return", fake) == "completed"

    log = fake.stage_log
    failed_first = log.index(("implement", 1, "failed"))
    gate_failed = log.index(("checks-green", 1, "failed"))
    retry = log.index(("implement", 2, "active"))
    assert failed_first < gate_failed < retry
    assert fake.stages[("implement", 2)].note == (
        "attempt 1 failed tests — loop returned from gate ↺"
    )
    assert ("checks-green", 2, "succeeded") in log
    assert log[-1] == ("open-pr", 1, "succeeded")


def test_build_test_and_review_wait_until_the_second_attempt() -> None:
    fake = FakeControlPlane()

    _play("482-gate-return", fake)

    retry = fake.stage_log.index(("implement", 2, "active"))
    before = {key for key, _, _ in fake.stage_log[:retry]}
    assert {"build", "test", "review"}.isdisjoint(before)


def test_without_a_steer_attempt_two_takes_the_mockups_path() -> None:
    fake = FakeControlPlane()

    _play("482-gate-return", fake)

    assert [c["sha"] for c in fake.commits] == ["a41c9e2", "7f03b8d"]
    assert "drivers/can/isr_fastpath.c" in {f["path"] for f in fake.files}


def test_a_steer_on_attempt_two_changes_what_attempt_two_does() -> None:
    fake = FakeControlPlane()
    fake.queue(
        QueuedControl(
            "steer", "prefer an IRQ lock over the ISR edit", release_on=("implement", 2)
        )
    )

    _play("482-gate-return", fake)

    assert fake.acks == [("steer", {"attempt": 2})], "applied to attempt 2"
    assert [c["sha"] for c in fake.commits] == ["a41c9e2", "3c5e1a9"]
    paths = {f["path"] for f in fake.files}
    assert "drivers/can/telemetry_lock.h" in paths
    assert "drivers/can/isr_fastpath.c" not in paths
    assert any(
        "“prefer an IRQ lock over the ISR edit”" in body for body in _model_bodies(fake)
    )


def test_a_steer_on_attempt_one_does_not_rewrite_attempt_two() -> None:
    fake = FakeControlPlane()
    fake.queue(QueuedControl("steer", "early", release_on=("implement", 1)))

    _play("482-gate-return", fake)

    assert fake.acks == [("steer", {"attempt": 1})]
    assert [c["sha"] for c in fake.commits] == ["a41c9e2", "7f03b8d"]


# --- guardrail-violation --------------------------------------------------------------------


def test_the_violation_is_judged_by_the_control_plane_and_stops_the_attempt() -> None:
    fake = FakeControlPlane()

    assert _play("guardrail-violation", fake) == "needs_human"

    assert ("implement", 1, "failed") in fake.stage_log
    assert "ci_config, secrets" in fake.events[-1]["body"]
    assert ".github/workflows/firmware-ci.yml" in {f["path"] for f in fake.files}


def test_the_planted_key_travels_only_in_hunks_and_never_in_the_transcript() -> None:
    fake = FakeControlPlane()
    key = planted_aws_key_id()

    _play("guardrail-violation", fake)

    transcript = json.dumps(fake.events)
    hunks = json.dumps(fake.files)
    assert key not in transcript
    assert key in hunks


def test_the_planted_key_has_the_shape_the_ruleset_keys_on() -> None:
    key = planted_aws_key_id()

    assert key.startswith("AKIA")
    assert len(key) == 20
    assert set(key[4:]) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")


def test_a_control_plane_that_passes_the_change_set_is_reported_as_completed() -> None:
    fake = FakeControlPlane()
    fake.flag_violations = False

    assert _play("guardrail-violation", fake) == "completed"


# --- control-responsive ---------------------------------------------------------------------


def test_uncontrolled_it_runs_to_a_merge() -> None:
    fake = FakeControlPlane()

    assert _play("control-responsive", fake) == "completed"
    assert fake.commits[0]["sha"] == "b7d20c1"


def test_a_pause_mid_stage_holds_between_tool_calls_until_resumed() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    fake.queue(QueuedControl("pause", release_on=("implement", 1)))
    clock.on_sleep.append(lambda: fake.queue(QueuedControl("resume")))

    assert _play("control-responsive", fake, clock) == "completed"

    paused = next(e for e in fake.events if (e.get("body") or "").startswith("Paused"))
    assert paused["stageKey"] == "implement"
    assert [kind for kind, _ in fake.acks] == ["pause", "resume"]


def test_a_steer_during_the_survey_changes_the_approach() -> None:
    fake = FakeControlPlane()
    fake.queue(QueuedControl("steer", "use a ring buffer", release_on=("implement", 1)))

    _play("control-responsive", fake)

    assert fake.commits[0]["sha"] == "e94f3a0"
    assert any("ring buffer" in body for body in _model_bodies(fake))


def test_an_abort_from_a_running_stage_ends_the_run_canceled() -> None:
    fake = FakeControlPlane()
    fake.queue(QueuedControl("abort", release_on=("implement", 1)))

    result = run_scenario(
        "control-responsive", simulator_settings(), transport=fake, clock=FakeClock()
    )

    assert result.outcome == "aborted"
    assert result.detail == "aborted at implement attempt 1"
    assert fake.status == "canceled"
    assert ("open-pr", 1, "active") not in fake.stage_log
    assert fake.commits == [], "nothing after the abort"
