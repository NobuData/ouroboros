"""The eight scenarios, played through the fake control plane.

Each one is checked for the story the issue gives it, and all eight are checked for the rules
every run the driver writes must keep: every entry is in order, every write is keyed, every
stage key is a node of the pinned workflow, and model output always names its model.

Seven are pinned to ``standard-fix`` v14; ``first-loop`` (#395) is pinned to the
``quick-fixes`` v1 template, so its stage keys are checked against that document instead.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from ouroboros_simulator.runner import run_scenario
from ouroboros_simulator.scenarios import SCENARIOS
from ouroboros_simulator.scenarios.guardrail_violation import planted_aws_key_id
from ouroboros_simulator.scenarios.protected_path_allow_once import PROTECTED_PATH
from ouroboros_simulator.session import RunSession, ScenarioAborted, Target
from ouroboros_simulator.transport import Response
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

#: The migration that seeds the shipped templates; `quick-fixes` v1's DSL document is inline
#: in it, between `$quick_fixes_v1$` dollar quotes.
_V068_TEMPLATES = (
    Path(__file__).resolve().parents[2]
    / "ouroboros-db"
    / "migrations"
    / "V068__workflow_templates.sql"
)

#: The dollar-quote tag around `quick-fixes` v1's document in V068.
_QUICK_FIXES_TAG = "$quick_fixes_v1$"

#: The one scenario pinned to `quick-fixes` v1 — the wizard's first loop (#395). Every other
#: scenario runs `standard-fix` v14, which has the `effort-recheck` fork the first loop lacks.
QUICK_FIXES_SCENARIOS = frozenset({"first-loop"})
STANDARD_FIX_SCENARIOS = frozenset(SCENARIOS) - QUICK_FIXES_SCENARIOS


def _standard_fix_nodes() -> set[str]:
    """`standard-fix` v14's node ids, from the committed fixture it is seeded from."""
    return {
        node["id"]
        for node in json.loads(_STANDARD_FIX.read_text(encoding="utf-8"))["nodes"]
    }


def _quick_fixes_nodes() -> set[str]:
    """`quick-fixes` v1's node ids, read out of V068 byte for byte.

    The document is the text between the two `$quick_fixes_v1$` delimiters — a SQL dollar
    quote, so it is JSON as written, with nothing escaped.
    """
    sql = _V068_TEMPLATES.read_text(encoding="utf-8")
    start = sql.index(_QUICK_FIXES_TAG) + len(_QUICK_FIXES_TAG)
    end = sql.index(_QUICK_FIXES_TAG, start)
    return {node["id"] for node in json.loads(sql[start:end])["nodes"]}


def _pinned_nodes(name: str) -> set[str]:
    """The node ids of the workflow a scenario is written against."""
    if name in QUICK_FIXES_SCENARIOS:
        return _quick_fixes_nodes()
    return _standard_fix_nodes()


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


def test_there_are_the_eight_scenarios_the_issues_name() -> None:
    assert list(SCENARIOS) == [
        "happy-path",
        "482-gate-return",
        "guardrail-violation",
        "control-responsive",
        "correction-round",
        "failing-hil",
        "protected-path-allow-once",
        "first-loop",
    ]


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_every_stage_key_is_a_node_of_the_pinned_workflow(name: str) -> None:
    nodes = _pinned_nodes(name)
    fake = FakeControlPlane()

    _play(name, fake)

    used = {key for key, _, _ in fake.stage_log}
    assert used <= nodes, used - nodes


def test_the_two_pinned_workflows_are_read_from_their_seeds() -> None:
    standard_fix = _standard_fix_nodes()
    quick_fixes = _quick_fixes_nodes()

    assert quick_fixes == {
        "issue-queued",
        "analyze",
        "plan",
        "code",
        "build",
        "test",
        "open-pr",
    }
    assert {"effort-recheck", "split", "back-to-queue"} <= standard_fix
    assert {"effort-recheck", "split", "back-to-queue"}.isdisjoint(quick_fixes)


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
    # Only `standard-fix` has the `effort-recheck` fork whose `split` branch a ≤ M issue
    # skips. `quick-fixes` v1 has no fork at all, so `first-loop` reports no skipped stage.
    if name in STANDARD_FIX_SCENARIOS:
        assert ("split", 1, "skipped") in fake.stage_log
        assert ("back-to-queue", 1, "skipped") in fake.stage_log
    else:
        assert not any(status == "skipped" for _, _, status in fake.stage_log)


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


# --- correction-round (#332) ----------------------------------------------------------------

#: The Mark & Route card's correction note, as mockup 11 writes it.
NOTE = "Keep k_msgq, but move PID velocity sampling off the telemetry path."


def test_without_a_correction_round_the_run_needs_a_human() -> None:
    fake = FakeControlPlane()

    assert _play("correction-round", fake) == "needs_human"

    assert fake.stage_log[-1] == ("implement", 1, "failed")
    assert ("implement", 2, "active") not in fake.stage_log
    assert fake.acks == []


def test_a_correction_round_starts_the_next_attempt_with_the_note() -> None:
    fake = FakeControlPlane()
    fake.queue(
        QueuedControl(
            kind="steer", payload=NOTE, retry_stage=True, release_on=("implement", 1)
        )
    )

    assert _play("correction-round", fake) == "completed"

    log = fake.stage_log
    assert log.index(("implement", 1, "failed")) < log.index(("implement", 2, "active"))
    assert ("implement", 2, "succeeded") in log
    assert ("open-pr", 1, "succeeded") in log
    assert fake.acks == [
        ("steer", {"effect": "correction round queued: implement attempt 2"})
    ]
    attempt_two = [
        e["body"]
        for e in fake.events
        if e["actor"] == "model" and e["stageKey"] == "implement" and e["attempt"] == 2
    ]
    assert any(NOTE in body for body in attempt_two)
    assert any(
        "Correction round received: implement attempt 2" in (e.get("body") or "")
        for e in fake.events
        if e["actor"] == "system"
    )


def test_an_ordinary_steer_while_holding_does_not_start_a_new_attempt() -> None:
    fake = FakeControlPlane()
    fake.queue(QueuedControl(kind="steer", payload=NOTE, release_on=("implement", 1)))

    assert _play("correction-round", fake) == "needs_human"

    assert fake.acks == [("steer", {"attempt": 1})]


# --- failing-hil (#334) ---------------------------------------------------------------------


def _test_results(fake: FakeControlPlane) -> list[str]:
    """The run console's ``run_tests`` results, in order."""
    return [
        e["payload"]["result"]
        for e in fake.events
        if e["actor"] == "tool" and e.get("toolTag") == "run_tests" and e.get("payload")
    ]


def test_failing_hil_without_a_correction_round_needs_a_human_after_two_rig_builds() -> (
    None
):
    fake = FakeControlPlane()

    assert _play("failing-hil", fake) == "needs_human"

    assert [commit["sha"] for commit in fake.commits] == ["a3f19c2", "c81d4e7"]
    assert [r.split(" · ")[0] for r in _test_results(fake)] == [
        "49 passed, 14 failed",
        "61 passed, 2 failed",
    ]
    assert fake.stage_log[-1] == ("implement", 1, "failed")
    assert fake.acks == []


def test_failing_hil_turns_green_on_the_correction_rounds_build() -> None:
    fake = FakeControlPlane()
    fake.queue(
        QueuedControl(
            kind="steer", payload=NOTE, retry_stage=True, release_on=("implement", 1)
        )
    )

    assert _play("failing-hil", fake) == "completed"

    # Mockup 11's attempt cards: a3f19c2 49/63 · c81d4e7 61/63 · f42b9a0 63/63.
    assert [commit["sha"] for commit in fake.commits] == [
        "a3f19c2",
        "c81d4e7",
        "f42b9a0",
    ]
    assert [r.split(" · ")[0] for r in _test_results(fake)][:3] == [
        "49 passed, 14 failed",
        "61 passed, 2 failed",
        "63 passed, 0 failed",
    ]
    log = fake.stage_log
    assert log.index(("implement", 1, "failed")) < log.index(("implement", 2, "active"))
    assert ("implement", 2, "succeeded") in log
    assert ("open-pr", 1, "succeeded") in log
    assert fake.acks == [
        ("steer", {"effect": "correction round queued: implement attempt 2"})
    ]
    attempt_two = [
        e["body"]
        for e in fake.events
        if e["actor"] == "model" and e["stageKey"] == "implement" and e["attempt"] == 2
    ]
    assert any(NOTE in body for body in attempt_two)


def test_failing_hil_says_the_results_are_the_rigs_uploads() -> None:
    fake = FakeControlPlane()

    _play("failing-hil", fake)

    sent = [
        e["body"]
        for e in fake.events
        if e["actor"] == "system"
        and "sent to rig helios-rig-02" in (e.get("body") or "")
    ]
    assert len(sent) == 2
    assert all("uploads its JUnit and HIL reports" in body for body in sent)


# --- protected-path-allow-once (#470) -------------------------------------------------------


def _allow_once_on_first_poll(fake: FakeControlPlane, clock: FakeClock) -> None:
    """Play the inbox's *Allow once* while the loop holds: grant the path, then resume — once."""

    def allow() -> None:
        clock.on_sleep.clear()
        fake.allowances.add(PROTECTED_PATH)
        fake.queue(QueuedControl("resume"))

    clock.on_sleep.append(allow)


class _AnsweredBeforeTheDriverLooks(FakeControlPlane):
    """A control plane whose person allows the edit the moment the card is filed.

    The grant and the resume are in place before the change-set answer reaches the driver,
    so the resume is pending at the driver's very next fetch.
    """

    def _files(self, body: dict[str, Any]) -> Response:
        answer = super()._files(body)
        if answer.body["needsHuman"]:
            self.allowances.add(PROTECTED_PATH)
            self.queue(QueuedControl("resume"))
        return answer


def test_the_protected_path_is_the_only_check_that_fails() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    session = make_session(fake, clock, max_pause=3.0)
    session.open(Target(), "loop/test")

    assert SCENARIOS["protected-path-allow-once"].script(session) == "needs_human"

    first = session.change_sets[0]
    assert first.needs_human is True
    assert first.guardrail_failures == ["allowed_paths"]
    assert PROTECTED_PATH.startswith("boot/")
    assert not any(f["path"].startswith(".github/") for f in fake.files)


def test_allow_once_resumes_the_loop_past_implement_to_a_merge() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    _allow_once_on_first_poll(fake, clock)

    assert _play("protected-path-allow-once", fake, clock) == "completed"

    assert fake.acks == [("resume", {"effect": "resumed at implement attempt 1"})]
    log = fake.stage_log
    assert ("implement", 1, "failed") not in log
    assert log.index(("implement", 1, "active")) < log.index(
        ("implement", 1, "succeeded")
    )
    assert log[-1] == ("open-pr", 1, "succeeded")
    assert all(attempt == 1 for _, attempt, _ in log)
    assert fake.allowances == set(), "the grant is spent by the report it passed"
    bodies = [e.get("body") or "" for e in fake.events]
    holding = next(i for i, b in enumerate(bodies) if "Holding implement" in b)
    resumed = bodies.index("Resumed at implement attempt 1.")
    allowed = next(i for i, b in enumerate(bodies) if "One-time edit" in b)
    assert holding < resumed < allowed
    assert "allowed_paths" in bodies[holding]
    assert "merged" in bodies[-1]


def test_the_change_set_is_reported_again_after_the_resume() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    _allow_once_on_first_poll(fake, clock)
    session = make_session(fake, clock)
    session.open(Target(), "loop/test")

    SCENARIOS["protected-path-allow-once"].script(session)

    assert [c.guardrail_failures for c in session.change_sets] == [
        ["allowed_paths"],
        [],
    ]
    assert [c.change_set_seq for c in session.change_sets] == [1, 2]


def test_a_resume_pending_before_the_driver_looks_again_is_not_lost() -> None:
    # No boundary between the verdict and the hold, so the hold's first fetch claims it.
    fake = _AnsweredBeforeTheDriverLooks()

    assert _play("protected-path-allow-once", fake) == "completed"

    assert fake.acks == [("resume", {"effect": "resumed at implement attempt 1"})]


def test_without_a_resume_the_run_needs_a_human_at_the_session_limit() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    session = make_session(fake, clock, max_pause=4.0)
    session.open(Target(), "loop/test")

    assert SCENARIOS["protected-path-allow-once"].script(session) == "needs_human"

    assert len(clock.sleeps) == 4
    assert fake.stage_log[-1] == ("implement", 1, "failed")
    assert not any(key == "build" for key, _, _ in fake.stage_log)
    assert "No one allowed the edit in time" in fake.events[-1]["body"]
    assert len(session.change_sets) == 1


def test_a_resume_without_a_grant_stops_for_a_person() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    clock.on_sleep.append(lambda: fake.queue(QueuedControl("resume")))
    session = make_session(fake, clock)
    session.open(Target(), "loop/test")

    assert SCENARIOS["protected-path-allow-once"].script(session) == "needs_human"

    assert fake.stage_log[-1] == ("implement", 1, "failed")
    assert "still fail" in fake.events[-1]["body"]


def test_an_abort_while_holding_for_allow_once_ends_the_run_canceled() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    clock.on_sleep.append(lambda: fake.queue(QueuedControl("abort")))

    with pytest.raises(ScenarioAborted):
        _play("protected-path-allow-once", fake, clock)

    assert fake.status == "canceled"
    assert [kind for kind, _ in fake.acks] == ["abort"]


# --- first-loop (#395) ----------------------------------------------------------------------

#: `quick-fixes` v1's one path, in order — the whole stage log of a first loop.
QUICK_FIXES_PATH = [
    "issue-queued",
    "analyze",
    "plan",
    "code",
    "build",
    "test",
    "open-pr",
]


def test_the_first_loop_walks_quick_fixes_once_in_order_and_completes() -> None:
    fake = FakeControlPlane()

    assert _play("first-loop", fake) == "completed"

    assert fake.stage_log == [
        (key, 1, status)
        for key in QUICK_FIXES_PATH
        for status in ("active", "succeeded")
    ]
    assert fake.stage_log[-1] == ("open-pr", 1, "succeeded")
    assert fake.status == "coding", "the contract has no operation that closes a run"


def test_the_first_loop_leaves_the_pull_request_a_draft() -> None:
    fake = FakeControlPlane()

    _play("first-loop", fake)

    last = fake.events[-1]["body"]
    assert "draft" in last
    assert "merged" not in last
    opened = [e["body"] for e in fake.events if "pull request" in (e.get("body") or "")]
    assert all("merged" not in body for body in opened)
    assert any("Opened a draft pull request from loop/test" in body for body in opened)


def test_the_first_loops_change_set_is_docs_only_and_clean() -> None:
    fake = FakeControlPlane()
    clock = FakeClock()
    session = _open(fake, clock)

    SCENARIOS["first-loop"].script(session)

    paths = [f["path"] for f in fake.files]
    assert paths == ["docs/operator-manual.md", "docs/pairing-guide.md"]
    assert all(f["status"] == "modified" for f in fake.files)
    assert [c.guardrail_failures for c in session.change_sets] == [[]]
    assert [c["message"] for c in fake.commits] == [
        "docs: fix typos in operator manual and pairing guide"
    ]
    assert [s["taskKind"] for s in fake.spends] == ["analyze", "plan", "implement"]
    assert 120 <= clock.scripted_total <= 180, "two to three scripted minutes"
