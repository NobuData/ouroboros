"""Controls (AP.4) and guardrail enforcement in the interpreter (#315, AR.1).

Driven over :class:`execution_fakes.FakeControl` — whose ``plan`` releases a control to a
fetch once a condition on the calls so far holds — DH.1's scripted executors and real run
working trees (DI.1).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from code_fixtures import SeededRepo, build_repo
from execution_fakes import (
    RUN,
    Failing,
    FakeControl,
    Recording,
    Waiting,
    chain,
    fast,
    llm,
    refusal,
    term,
    trigger,
)
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.execution.controls import (
    NEXT_ATTEMPT,
    NO_ATTEMPT_FOLLOWED,
    NOTHING_TO_RESUME,
)
from ouroboros_engine.execution.stage import OPERATOR_NOTES, UNTRUSTED_TAG
from ouroboros_engine.execution.workspace import RunWorkspaces
from stage_executor_fakes import Call, Say, Script
from test_execution_interpreter import Bench

MB = 1024 * 1024

SIMPLE = chain(trigger(), llm("write-docs"), term("done", "open_pr_automerge"))
TWO = chain(trigger(), llm("plan"), llm("implement"), term("done", "open_pr_automerge"))


@pytest.fixture
def bench(tmp_path: Path):
    """Make a bench whose control polls are fast unless a test says otherwise."""
    seeded: SeededRepo = build_repo(tmp_path / "remote" / "helios-firmware.git")
    clones = CloneStore(tmp_path / "clones", allow_local=True)
    workspaces = RunWorkspaces(
        tmp_path / "runs", clones, max_bytes=64 * MB, disk_free=lambda _path: 1024 * MB
    )

    def make(doc: dict[str, Any], *executors: Any, **options: Any) -> Bench:
        options.setdefault("poll_sleep", fast)
        return Bench(seeded, clones, workspaces, doc, *executors, **options)

    return make


def script(*paths: str) -> Script:
    """Say something, then write each path."""
    return Script([Say("Writing."), *(Call("write_file", p, f"{p}\n") for p in paths)])


def running(stage: str = "write-docs"):
    """A condition: the stage's first attempt has started."""
    return lambda control: (stage, "active", 1) in control.transitions()


def acked(effect_prefix: str):
    """A condition: some control was acknowledged with an effect starting so."""

    def holds(control: FakeControl) -> bool:
        return any(
            (ack["effect"] or "").startswith(effect_prefix) for ack in control.acks()
        )

    return holds


def transitioned(stage: str, status: str, attempt: int = 1):
    """A condition: a stage attempt was moved to a status."""
    return lambda control: (stage, status, attempt) in control.transitions()


# --- pause, hold, resume --------------------------------------------------------------------


def test_a_pause_stops_at_the_boundary_holds_and_resume_continues_the_attempt(
    bench,
) -> None:
    first = Waiting(script("a.md"))
    second = Recording(script("a.md"))
    run = bench(SIMPLE, first, second, sleep=fast)
    pause = run.control.plan("pause", running())
    resume = run.control.plan("resume", acked("paused at"))
    control = run.run()

    assert control.ack_of(pause)["effect"] == (
        "paused at a safe boundary: write-docs attempt 1"
    )
    assert control.ack_of(resume)["effect"] == "resumed at write-docs attempt 1"
    # The same attempt continued from its checkpoint on a fresh instance: no attempt 2.
    assert control.transitions() == [
        ("write-docs", "active", 1),
        ("write-docs", "succeeded", 1),
    ]
    assert len(second.resumed) == 1 and second.resumed[0].context.attempt == 1
    assert second.contexts == []
    # The checkpoint was persisted before the pause was acknowledged, and the worker kept
    # heartbeating while it held.
    ops = control.ops()
    paused_at = next(
        i
        for i, (op, body) in enumerate(control.calls)
        if op == "ack_control" and body["control"] == pause
    )
    assert "checkpoint" in ops[:paused_at]
    assert control.state is not None
    resumed_at = next(
        i
        for i, (op, body) in enumerate(control.calls)
        if op == "ack_control" and body["control"] == resume
    )
    assert "heartbeat" in ops[paused_at:resumed_at]
    assert control.finished().outcome == "review"


def test_a_pause_between_stages_holds_right_there(bench) -> None:
    plan, implement = Recording(script("plan.md")), Recording(script("impl.c"))
    run = bench(TWO, plan, implement)
    pause = run.control.plan("pause", transitioned("plan", "succeeded"))
    run.control.plan("resume", acked("paused at"))
    control = run.run()

    assert control.ack_of(pause)["effect"] == (
        "paused at a safe boundary: before implement"
    )
    paused_at = control.ops().index("ack_control")
    assert ("implement", "active", 1) not in [
        (b.stage_key, b.status, b.attempt)
        for op, b in control.calls[:paused_at]
        if op == "transition"
    ]
    assert control.finished().outcome == "review"


def test_a_second_pause_while_holding_is_acknowledged_as_already_paused(bench) -> None:
    run = bench(TWO, Recording(script("plan.md")), Recording(script("impl.c")))
    run.control.plan("pause", transitioned("plan", "succeeded"))
    again = run.control.plan("pause", acked("paused at"))
    run.control.plan("resume", acked("already paused"))
    control = run.run()

    assert control.ack_of(again)["effect"] == "already paused at before implement"
    assert control.finished().outcome == "review"


def test_a_resume_outside_a_hold_has_nothing_to_resume(bench) -> None:
    run = bench(SIMPLE, Recording(script("a.md")))
    resume = run.control.plan("resume")
    control = run.run()

    assert control.ack_of(resume)["effect"] == NOTHING_TO_RESUME
    assert control.finished().outcome == "review"


def test_an_abort_while_holding_ends_the_run_without_a_finish(bench) -> None:
    run = bench(TWO, Recording(script("plan.md")), Recording(script("impl.c")))
    run.control.plan("pause", transitioned("plan", "succeeded"))
    abort = run.control.plan("abort", acked("paused at"))
    control = run.run()

    assert control.ack_of(abort)["effect"] is None
    assert control.finished() is None
    assert ("implement", "active", 1) not in control.transitions()


# --- abort ----------------------------------------------------------------------------------


def test_an_abort_keeps_the_tree_and_branch_acks_and_makes_no_finish(bench) -> None:
    executor = Waiting(script("a.md", "b.md"), wait_after="file_change")
    run = bench(SIMPLE, executor)
    abort = run.control.plan("abort", lambda c: len(c.bodies("files")) >= 1)
    control = run.run()

    assert control.ack_of(abort) == {"control": abort, "effect": None, "attempt": None}
    assert control.finished() is None
    assert control.ops()[-1] == "ack_control"
    # Closed, not finished: the tree is there, and its branch holds the work done before the
    # abort (a.md), committed as a local checkpoint. Reopening resets to that checkpoint.
    assert run.workspaces.path_of(RUN).exists()
    reopened = run.workspaces.open(run.spec())
    try:
        assert (reopened.path / "a.md").exists()
        assert not (reopened.path / "b.md").exists()
    finally:
        reopened.close()


def test_an_abort_between_stages_stops_before_the_next_one(bench) -> None:
    run = bench(TWO, Recording(script("plan.md")), Recording(script("impl.c")))
    run.control.plan("abort", transitioned("plan", "succeeded"))
    control = run.run()

    assert control.finished() is None
    assert all(stage != "implement" for stage, _, _ in control.transitions())


# --- steer ----------------------------------------------------------------------------------


def test_a_steer_mid_attempt_goes_to_an_executor_that_steers_without_pausing(
    bench,
) -> None:
    executor = Waiting(script("a.md"), steer=True)
    run = bench(SIMPLE, executor)
    steer = run.control.plan("steer", running(), payload="Keep it short.")
    control = run.run()

    assert executor.steered == ["Keep it short."]
    assert control.ack_of(steer) == {"control": steer, "effect": None, "attempt": 1}
    assert control.transitions() == [
        ("write-docs", "active", 1),
        ("write-docs", "succeeded", 1),
    ]


def test_a_steer_on_an_executor_that_cannot_lands_on_the_next_attempt(bench) -> None:
    plan = Waiting(script("plan.md"))
    implement = Recording(script("impl.c"))
    run = bench(TWO, plan, implement)
    plan.until = lambda: bool(run.control.acks())
    steer = run.control.plan("steer", running("plan"), payload="Mind the bootloader.")
    control = run.run()

    assert control.ack_of(steer)["effect"] == NEXT_ATTEMPT
    prompt = implement.contexts[0].prompt
    assert prompt.endswith(f"{OPERATOR_NOTES}\n\n- Mind the bootloader.")
    assert control.finished().outcome == "review"


def test_a_steer_between_stages_is_appended_to_the_next_prompt_and_acked_with_it(
    bench,
) -> None:
    implement = Recording(script("impl.c"))
    run = bench(TWO, Recording(script("plan.md")), implement)
    steer = run.control.plan(
        "steer", transitioned("plan", "succeeded"), payload="Use the new API."
    )
    control = run.run()

    assert control.ack_of(steer) == {"control": steer, "effect": None, "attempt": 1}
    prompt = implement.contexts[0].prompt
    closing = prompt.index(f"</{UNTRUSTED_TAG}>")
    assert prompt.index("- Use the new API.") > closing  # outside the untrusted block
    # Acknowledged once the attempt it landed on had started.
    calls = control.calls
    active = calls.index(
        next(c for c in calls if c[0] == "transition" and c[1].stage_key == "implement")
    )
    assert calls.index(next(c for c in calls if c[0] == "ack_control")) > active


def test_a_steer_no_attempt_takes_is_acknowledged_before_the_finish(bench) -> None:
    run = bench(SIMPLE, Recording(script("a.md")))
    steer = run.control.plan(
        "steer", transitioned("write-docs", "succeeded"), payload="Too late."
    )
    control = run.run()

    assert control.ack_of(steer)["effect"] == NO_ATTEMPT_FOLLOWED
    assert control.ops().index("ack_control") < control.ops().index("finish")


def test_a_correction_round_reruns_the_stage_as_the_next_attempt_with_the_note(
    bench,
) -> None:
    doc = chain(
        trigger(), llm("write-docs", max_retries=1), term("done", "open_pr_automerge")
    )
    first = Waiting(script("a.md"))
    second = Recording(script("a.md"))
    run = bench(doc, first, second)
    first.until = lambda: bool(run.control.acks())
    steer = run.control.plan(
        "steer", running(), payload="Add an example.", retry_stage=True
    )
    control = run.run()

    assert control.ack_of(steer)["effect"] == (
        "correction round queued: write-docs attempt 2"
    )
    assert control.transitions() == [
        ("write-docs", "active", 1),
        ("write-docs", "succeeded", 1),
        ("write-docs", "active", 2),
        ("write-docs", "succeeded", 2),
    ]
    assert second.contexts[0].attempt == 2
    assert second.contexts[0].prompt.endswith("- Add an example.")
    assert control.finished().outcome == "review"


def test_a_correction_round_past_the_stages_attempts_is_refused(bench) -> None:
    executor = Waiting(script("a.md"))
    run = bench(SIMPLE, executor)
    executor.until = lambda: bool(run.control.acks())
    steer = run.control.plan("steer", running(), payload="Again.", retry_stage=True)
    control = run.run()

    assert control.ack_of(steer)["effect"] == (
        "correction round refused: write-docs has used all 1 attempt(s)"
    )
    assert control.transitions()[-1] == ("write-docs", "succeeded", 1)


# --- acknowledgments ------------------------------------------------------------------------


def test_an_ack_already_landed_counts_and_an_expired_one_is_dropped(bench) -> None:
    run = bench(SIMPLE, Recording(script("a.md")))
    run.control.plan("abort")
    run.control.refusals["ack_control"] = [
        refusal("control_not_delivered", state="acked")
    ]
    control = run.run()
    assert control.finished() is None  # the abort counted

    run = bench(SIMPLE, Recording(script("a.md")))
    run.control.plan("resume")
    run.control.refusals["ack_control"] = [
        refusal("control_not_delivered", state="expired")
    ]
    control = run.run()
    assert control.finished().outcome == "review"  # dropped; the run carried on


# --- guardrails at tool boundaries ----------------------------------------------------------


def test_the_change_set_is_reported_after_every_file_change_and_at_the_end(
    bench,
) -> None:
    control = bench(SIMPLE, Recording(script("a.md", "b.md"))).run()

    reported = [[f.path for f in body.files] for body in control.bodies("files")]
    assert reported == [["a.md"], ["a.md", "b.md"], ["a.md", "b.md"]]
    assert control.finished().outcome == "review"


def test_a_block_failure_halts_the_stage_at_that_boundary(bench) -> None:
    executor = Recording(script("docs/a.md", "docs/b.md"))
    run = bench(SIMPLE, executor)
    run.control.needs_human = True
    run.control.guardrail_failures = ["allowed_paths", "secrets"]
    run.control.guardrail_warnings = ["secrets"]
    run.control.guardrail_verdicts = [
        {
            "check": "allowed_paths",
            "mode": "block",
            "evidence": {"path": "docs/a.md", "glob": "docs/**"},
        },
        {"check": "secrets", "mode": "warn", "evidence": {"detail": "a token"}},
    ]
    control = run.run()

    assert control.transitions() == [
        ("write-docs", "active", 1),
        ("write-docs", "failed", 1),
    ]
    finished = control.finished()
    assert finished.outcome == "needs_human"
    assert finished.reason == "guardrail allowed_paths failed: docs/a.md (docs/**)"
    assert finished.stage_key == "write-docs"
    # Stopped at the boundary: the second write never ran.
    assert len(control.bodies("files")) == 1
    assert [f.path for f in control.bodies("files")[0].files] == ["docs/a.md"]
    assert executor.outcome is not None and executor.outcome.status == "aborted"


def test_a_warn_failure_does_not_halt(bench) -> None:
    run = bench(SIMPLE, Recording(script("a.md", "b.md")))
    run.control.guardrail_failures = ["secrets"]
    run.control.guardrail_warnings = ["secrets"]
    run.control.guardrail_verdicts = [{"check": "secrets", "mode": "warn"}]
    control = run.run()

    assert control.transitions()[-1] == ("write-docs", "succeeded", 1)
    assert control.finished().outcome == "review"


# --- budget ---------------------------------------------------------------------------------


def test_a_budget_breach_takes_the_abort_path_not_a_retry(bench) -> None:
    doc = chain(
        trigger(), llm("write-docs", max_retries=2), term("done", "needs_review")
    )
    run = bench(doc, Failing("token_budget_exceeded: the attempt spent its budget"))
    abort = run.control.plan("abort", transitioned("write-docs", "active"))
    control = run.run()

    assert control.ack_of(abort)["effect"] is None
    assert control.finished() is None
    assert control.transitions() == [("write-docs", "active", 1)]


def test_an_abort_waiting_at_the_finish_wins_over_failed(bench) -> None:
    # The facade's abort becomes visible only after the stage failed: the end-of-attempt
    # poll misses it, the poll before the finish does not.
    run = bench(SIMPLE, Failing("cost_cap_exceeded: The run reached its spending cap."))
    abort = run.control.plan("abort", transitioned("write-docs", "failed"))
    control = run.run()

    assert control.transitions()[-1] == ("write-docs", "failed", 1)
    assert control.ack_of(abort)["effect"] is None
    assert control.finished() is None
