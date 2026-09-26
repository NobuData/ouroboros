"""The session: every report goes through the contract, and every control means what AP.4 says."""

import pytest

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.ingest import StageReturn
from ouroboros_simulator.scenarios.common import changed
from ouroboros_simulator.session import (
    MAX_BATCH,
    RunSession,
    ScenarioAborted,
    SimulationError,
    Target,
)
from simulator_fake import (
    BASE_URL,
    SIMULATOR_SECRET,
    FakeClock,
    FakeControlPlane,
    QueuedControl,
    make_session,
)


@pytest.fixture
def fake() -> FakeControlPlane:
    return FakeControlPlane()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def session(fake: FakeControlPlane, clock: FakeClock) -> RunSession:
    opened = make_session(fake, clock)
    opened.open(Target(), "loop/482-test")
    return opened


# --- opening --------------------------------------------------------------------------------


def test_open_names_the_ticket_and_claims_neither_workspace_nor_watermark(
    fake: FakeControlPlane, session: RunSession
) -> None:
    body = fake.opened_with

    assert body["ticket"] == {
        "source": "5eed001a-0000-4000-8000-000000000001",
        "externalKey": "#482",
    }
    assert body["workflow"] == {"tag": "standard-fix", "version": 14}
    assert body["branchName"] == "loop/482-test"
    assert "simulated" not in body
    assert "organizationId" not in body
    assert session.run is not None
    assert session.run.simulated is True


def test_every_request_presents_the_simulator_secret(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("issue-queued", "active")
    session.system("hello")
    session.flush()

    assert fake.requests
    assert {r.headers["X-Ouro-Internal-Key"] for r in fake.requests} == {
        SIMULATOR_SECRET
    }


def test_a_run_that_came_back_unmarked_is_refused_and_left_empty(
    clock: FakeClock,
) -> None:
    fake = FakeControlPlane(simulated=False)
    session = make_session(fake, clock)

    with pytest.raises(SimulationError, match="real run"):
        session.open(Target(), "loop/x")

    assert len(fake.requests) == 1, "nothing may be written to a run that is not marked"
    assert session.run is None
    with pytest.raises(SimulationError, match="not open"):
        session.stage("issue-queued", "active")


@pytest.mark.parametrize("prefix", ["", " sim", "x" * 97])
def test_a_key_prefix_must_be_short_and_trimmed(
    fake: FakeControlPlane, clock: FakeClock, prefix: str
) -> None:
    with pytest.raises(ValueError, match="key_prefix"):
        RunSession(
            ControlPlaneClient(BASE_URL, SIMULATOR_SECRET),
            fake,
            clock,  # duck-typed Clock
            key_prefix=prefix,
        )


@pytest.mark.parametrize("options", [{"poll_interval": 0}, {"max_pause": 0}])
def test_the_pause_intervals_must_be_positive(
    fake: FakeControlPlane, clock: FakeClock, options: dict[str, float]
) -> None:
    with pytest.raises(ValueError, match="positive"):
        make_session(fake, clock, **options)


def test_every_write_carries_its_own_idempotency_key(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("issue-queued", "active")
    session.system("one")
    session.stage("issue-queued", "succeeded")
    session.files([changed("a.c", "modified", 1, 0)])
    session.commit("a41c9e2", "m")

    keys = [
        r.json["idempotencyKey"] for r in fake.requests if "idempotencyKey" in r.json
    ]

    assert len(keys) == len(set(keys)) == 6
    assert all(key.startswith("sim-test-") for key in keys)


def test_a_redelivered_request_is_answered_from_its_receipt(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("issue-queued", "active")
    sent = fake.requests[-1]

    replay = fake.send(sent)

    assert replay.status == 200
    assert fake.stage_log == [("issue-queued", 1, "active")], "a replay moves nothing"


# --- stages ---------------------------------------------------------------------------------


def test_a_retry_carries_its_return_and_the_note_comes_back_composed(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    session.stage("implement", "failed")

    moved = session.stage(
        "implement",
        "active",
        attempt=2,
        returned_from=StageReturn(
            stage_key="checks-green", kind="gate", reason="failed_tests"
        ),
    )

    assert moved.note == "attempt 1 failed tests — loop returned from gate ↺"
    body = fake.requests[-1].json
    assert body["returnedFrom"] == {
        "stageKey": "checks-green",
        "kind": "gate",
        "reason": "failed_tests",
    }
    assert "note" not in body


def test_a_stage_keeps_the_attempt_it_is_on(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    session.stage("implement", "failed")
    session.stage("implement", "active", attempt=2)
    session.stage("implement", "succeeded")

    assert fake.stage_log[-1] == ("implement", 2, "succeeded")


def test_an_invalid_move_is_the_control_planes_refusal_not_a_silent_skip(
    session: RunSession,
) -> None:
    with pytest.raises(ControlPlaneError) as refused:
        session.stage("plan", "succeeded")

    assert refused.value.code == "stage_transition_invalid"


# --- transcript -----------------------------------------------------------------------------


def test_entries_are_batched_with_strictly_increasing_hints_across_batches(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("analyze", "active")
    session.model("one")
    session.tool("read_file", "a.c")
    session.work(10)
    session.gate("two")
    session.flush()

    hints = [event["hint"] for event in fake.events]
    batches = [r for r in fake.requests if r.url.endswith("/events")]

    assert hints == [1, 2, 3]
    assert len(batches) == 2


def test_a_model_entry_names_its_model_stage_and_attempt(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    session.stage("implement", "failed")
    session.stage("implement", "active", attempt=2)
    session.model("reasoning")
    session.flush()

    entry = fake.events[-1]
    assert entry["actor"] == "model"
    assert entry["modelId"] == "claude-fable-5"
    assert entry["stageKey"] == "implement"
    assert entry["attempt"] == 2


def test_model_output_before_any_stage_is_refused_locally(session: RunSession) -> None:
    with pytest.raises(ValueError, match="needs a stage"):
        session.model("orphan")


def test_a_long_burst_is_split_at_the_batch_cap(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("analyze", "active")
    for index in range(MAX_BATCH + 5):
        session.system(f"line {index}")
    session.flush()

    sizes = [len(r.json["events"]) for r in fake.requests if r.url.endswith("/events")]
    assert sizes == [MAX_BATCH, 5]


def test_flushing_nothing_sends_nothing(
    fake: FakeControlPlane, session: RunSession
) -> None:
    before = len(fake.requests)
    session.flush()
    assert len(fake.requests) == before


def test_work_is_scripted_time_then_a_boundary(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.work(72)

    assert clock.scripted_total == 72
    assert fake.requests[-1].url.endswith("/controls/fetch")


# --- change-sets, commits, spend ------------------------------------------------------------


def test_the_driver_reads_guardrail_verdicts_and_never_posts_one(
    fake: FakeControlPlane, session: RunSession
) -> None:
    verdict = session.files(
        [changed(".github/workflows/ci.yml", "modified", 1, 1, (1, [("add", "x")]))]
    )

    assert verdict.guardrail_failures == ["ci_config"]
    assert verdict.needs_human is True
    assert session.change_sets == [verdict]
    assert not any("guardrail" in r.url for r in fake.requests)


def test_a_commit_carries_gits_clock(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.commit("7f03b8d", "can: assign frame seq in ISR before enqueue")

    assert fake.commits[0]["sha"] == "7f03b8d"
    assert fake.commits[0]["committedAt"].endswith("Z")


def test_spend_is_attributed_to_the_runs_model_as_a_decimal_string(
    fake: FakeControlPlane, session: RunSession
) -> None:
    totals = session.spend(
        provider="anthropic",
        tokens_in=10,
        tokens_out=5,
        cost_cents="1.5000",
        task_kind="implement",
    )

    assert fake.spends[0]["model"] == "claude-fable-5"
    assert fake.spends[0]["costCents"] == "1.5000"
    assert "reservedBuildJob" not in fake.requests[-1].json
    assert totals.tokens_in == 10


def test_an_unpriced_spend_sends_no_cost(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.spend(
        provider="ollama",
        tokens_in=1,
        tokens_out=1,
        cost_cents=None,
        task_kind="implement",
    )

    assert "costCents" not in fake.spends[0]


# --- steer ----------------------------------------------------------------------------------


def test_a_steer_is_acked_with_the_current_attempt_and_does_not_pause(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    session.stage("implement", "failed")
    session.stage("implement", "active", attempt=2)
    fake.queue(QueuedControl("steer", "prefer an ISR fix"))

    session.checkpoint()

    assert fake.acks == [("steer", {"attempt": 2})]
    assert session.acks[0].detail == "steering applied to attempt 2"
    assert clock.sleeps == [], "a steer never pauses the loop"
    steer = session.steer_for("implement", 2)
    assert steer is not None
    assert steer.text == "prefer an ISR fix"
    assert session.steer_for("implement", 1) is None


def test_the_latest_steer_on_an_attempt_wins(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("steer", "first"))
    fake.queue(QueuedControl("steer", "second"))

    session.checkpoint()

    steer = session.steer_for("implement", 1)
    assert steer is not None
    assert steer.text == "second"


def test_a_steer_before_any_stage_lands_on_attempt_one(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("steer", "early"))

    session.checkpoint()

    assert fake.acks == [("steer", {"attempt": 1})]
    assert session.steers[0].stage_key is None


def test_a_correction_round_is_recorded_on_the_next_attempt_and_acked_with_it(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("steer", "move PID sampling", retry_stage=True))

    session.checkpoint()

    assert fake.acks == [
        ("steer", {"effect": "correction round queued: implement attempt 2"})
    ]
    assert session.acks[0].detail == "correction round queued: implement attempt 2"
    assert clock.sleeps == [], "a correction round never pauses the loop"
    assert session.steer_for("implement", 1) is None
    correction = session.steer_for("implement", 2)
    assert correction is not None
    assert correction.correction is True
    assert correction.text == "move PID sampling"
    assert session.correction_for("implement") == correction
    assert any(
        e["actor"] == "system"
        and e["body"].startswith("Correction round received: implement attempt 2")
        for e in fake.events
    )


def test_a_correction_is_spent_once_its_attempt_has_started(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("steer", "move PID sampling", retry_stage=True))
    session.checkpoint()

    session.stage("implement", "failed")
    session.stage("implement", "active", attempt=2)

    assert session.correction_for("implement") is None


def test_an_ordinary_steer_is_not_a_correction(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("steer", "prefer an ISR fix"))

    session.checkpoint()

    assert session.correction_for("implement") is None
    assert session.steers[0].correction is False


def test_a_correction_for_another_stage_is_not_this_stages(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("steer", "move PID sampling", retry_stage=True))

    session.checkpoint()

    assert session.correction_for("build") is None


def test_a_correction_before_any_stage_says_where_it_lands(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("steer", "early", retry_stage=True))

    session.checkpoint()

    assert fake.acks == [
        (
            "steer",
            {"effect": "correction round queued: attempt 2, before the first stage"},
        )
    ]
    assert session.steers[0].stage_key is None


def test_an_expired_correction_is_not_recorded(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(
        QueuedControl("steer", "too late", retry_stage=True, refused_as="expired")
    )

    session.checkpoint()

    assert session.correction_for("implement") is None


# --- pause and resume -----------------------------------------------------------------------


def test_a_pause_holds_at_the_boundary_until_a_resume(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("pause"))
    polls: list[int] = []

    def release_after_three_polls() -> None:
        polls.append(1)
        if len(polls) == 3:
            fake.queue(QueuedControl("resume"))

    clock.on_sleep.append(release_after_three_polls)

    session.checkpoint()

    assert [kind for kind, _ in fake.acks] == ["pause", "resume"]
    assert fake.acks[0][1] == {
        "effect": "paused at a safe boundary: implement attempt 1"
    }
    assert fake.acks[1][1] == {"effect": "resumed at implement attempt 1"}
    assert len(clock.sleeps) == 3
    bodies = [event.get("body") for event in fake.events]
    assert bodies == [
        "Paused at a safe boundary: implement attempt 1. Simulated run.",
        "Resumed at implement attempt 1.",
    ]


def test_a_pause_is_acked_only_after_the_loop_has_stopped(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("pause"))
    clock.on_sleep.append(lambda: fake.queue(QueuedControl("resume")))

    session.checkpoint()

    paused_entry = next(
        i for i, r in enumerate(fake.requests) if r.url.endswith("/events")
    )
    pause_ack = next(i for i, r in enumerate(fake.requests) if r.url.endswith("/ack"))
    assert paused_entry < pause_ack


def test_a_steer_while_paused_is_applied_and_the_pause_holds(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("pause"))
    script = [
        lambda: fake.queue(QueuedControl("steer", "ring buffer")),
        lambda: fake.queue(QueuedControl("pause")),
        lambda: fake.queue(QueuedControl("resume")),
    ]
    clock.on_sleep.append(lambda: script.pop(0)() if script else None)

    session.checkpoint()

    assert [kind for kind, _ in fake.acks] == ["pause", "steer", "pause", "resume"]
    assert fake.acks[2][1] == {"effect": "already paused at implement attempt 1"}
    assert session.steer_for("implement", 1) is not None


def test_controls_after_a_resume_in_the_same_fetch_are_applied_in_order(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("pause"))

    def resume_then_steer() -> None:
        fake.queue(QueuedControl("resume"))
        fake.queue(QueuedControl("steer", "after"))

    clock.on_sleep.append(resume_then_steer)

    session.checkpoint()

    assert [kind for kind, _ in fake.acks] == ["pause", "resume", "steer"]


def test_a_resume_with_nothing_paused_is_acked_as_a_no_op(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("resume"))

    session.checkpoint()

    assert fake.acks == [
        ("resume", {"effect": "the loop was not paused, so there is nothing to resume"})
    ]


def test_a_pause_nobody_resumes_gives_up_at_its_limit(
    fake: FakeControlPlane, clock: FakeClock
) -> None:
    session = make_session(fake, clock, max_pause=5.0)
    session.open(Target(), "loop/x")
    fake.queue(QueuedControl("pause"))

    with pytest.raises(SimulationError, match="no resume or abort"):
        session.checkpoint()

    assert len(clock.sleeps) == 5


def test_an_expired_pause_does_not_stop_the_loop(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    fake.queue(QueuedControl("pause", refused_as="expired"))

    session.checkpoint()

    assert clock.sleeps == []
    assert session.acks == []


# --- abort ----------------------------------------------------------------------------------


def test_an_abort_preserves_the_branch_and_unwinds_the_script(
    fake: FakeControlPlane, session: RunSession
) -> None:
    session.stage("implement", "active")
    fake.queue(QueuedControl("abort"))

    with pytest.raises(ScenarioAborted) as aborted:
        session.checkpoint()

    assert aborted.value.where == "implement attempt 1"
    assert fake.status == "canceled"
    assert fake.acks == [
        (
            "abort",
            {
                "effect": "aborted at implement attempt 1; branch loop/482-test preserved"
            },
        )
    ]
    assert "Branch loop/482-test is preserved" in fake.events[-1]["body"]


def test_an_abort_while_paused_still_aborts(
    fake: FakeControlPlane, clock: FakeClock, session: RunSession
) -> None:
    fake.queue(QueuedControl("pause"))
    clock.on_sleep.append(lambda: fake.queue(QueuedControl("abort")))

    with pytest.raises(ScenarioAborted):
        session.checkpoint()

    assert [kind for kind, _ in fake.acks] == ["pause", "abort"]


def test_an_expired_abort_leaves_the_loop_running(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("abort", refused_as="expired"))

    session.checkpoint()

    assert fake.status == "coding"


def test_a_starting_stage_is_a_boundary(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("abort"))

    with pytest.raises(ScenarioAborted):
        session.stage("analyze", "active")

    assert ("analyze", 1, "active") not in fake.stage_log


def test_an_ack_whose_first_answer_was_lost_counts_as_done(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("steer", "x", refused_as="acked"))

    session.checkpoint()

    assert len(session.steers) == 1, "the control plane already recorded it"
    assert session.acks == [], "but this session never saw the answer"


def test_any_other_ack_refusal_stops_the_driver(
    fake: FakeControlPlane, session: RunSession
) -> None:
    fake.queue(QueuedControl("steer", "x"))
    fake.fail_on[("POST", "/ack")] = (404, "control_not_found")

    with pytest.raises(ControlPlaneError) as refused:
        session.checkpoint()

    assert refused.value.code == "control_not_found"
