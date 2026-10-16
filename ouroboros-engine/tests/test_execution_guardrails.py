"""The pieces #315 adds around the interpreter.

Halt reasons, the change-set's new fields, operator notes, the control calls and their
acknowledgments, the poller, and provenance.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import AssistantMessage, TextBlock, ThinkingBlock

from execution_fakes import RUN, FakeControl, chain, llm, refusal, term, trigger
from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.ingest import ChangeSet
from ouroboros_engine.control_plane.ingest_client import IdempotencyKeys, IngestClient
from ouroboros_engine.control_plane.transport import Response as Answer
from ouroboros_engine.control_plane.transport import TransportError
from ouroboros_engine.execution.controls import (
    EMPTY_STEER,
    Controls,
    Running,
)
from ouroboros_engine.execution.events import ModelTurn
from ouroboros_engine.execution.executors.claude_agent_session import AttemptRecorder
from ouroboros_engine.execution.guardrails import (
    GENERIC_REASON,
    REASON_LIMIT,
    halt_reason,
)
from ouroboros_engine.execution.policy import ToolPolicy, evaluate
from ouroboros_engine.execution.poller import ControlPoller
from ouroboros_engine.execution.reporter import RunReporter
from ouroboros_engine.execution.spi import ExecutorCapabilityError, StageContext
from ouroboros_engine.execution.stage import OPERATOR_NOTES, with_notes
from ouroboros_engine.workflows.dsl import LlmPermissions
from stage_executor_fakes import FakeNativeExecutor, Script

BASE = {
    "changeSetSeq": 1,
    "files": 1,
    "additions": 1,
    "deletions": 0,
    "guardrailChecks": 4,
    "guardrailFailures": [],
    "needsHuman": False,
}


def change_set(**fields: Any) -> ChangeSet:
    """A change-set answer, as the wire carries it."""
    return ChangeSet.model_validate({**BASE, **fields})


# --- the change-set answer ------------------------------------------------------------------


def test_an_answer_from_before_modes_still_parses_with_empty_defaults() -> None:
    answer = change_set(guardrailFailures=["secrets"], needsHuman=True)
    assert answer.guardrail_warnings == [] and answer.guardrail_verdicts == []
    assert answer.needs_human


def test_verdicts_parse_mode_and_evidence_with_rule_id_in_either_spelling() -> None:
    answer = change_set(
        guardrailFailures=["allowed_paths", "secrets"],
        guardrailWarnings=["secrets"],
        guardrailVerdicts=[
            {"check": "allowed_paths", "mode": "block", "evidence": {"path": "a"}},
            {"check": "secrets", "mode": "warn", "evidence": {"rule_id": "aws"}},
            {"check": "ci_config", "evidence": {"ruleId": "gha"}},
        ],
    )
    first, second, third = answer.guardrail_verdicts
    assert (first.mode, first.evidence.path) == ("block", "a")
    assert (second.mode, second.evidence.rule_id) == ("warn", "aws")
    assert (third.mode, third.evidence.rule_id) == ("block", "gha")
    assert answer.guardrail_warnings == ["secrets"]


# --- halt reasons ---------------------------------------------------------------------------


def test_the_reason_renders_only_block_verdicts_joined() -> None:
    answer = change_set(
        guardrailVerdicts=[
            {
                "check": "allowed_paths",
                "mode": "block",
                "evidence": {"path": "boot/rollback_flag.c", "glob": "boot/**"},
            },
            {"check": "secrets", "mode": "warn", "evidence": {"detail": "1 finding."}},
            {
                "check": "ci_config",
                "mode": "block",
                "evidence": {"detail": ".github/workflows/ci.yml changed."},
            },
        ],
        needsHuman=True,
    )
    assert halt_reason(answer) == (
        "guardrail allowed_paths failed: boot/rollback_flag.c (boot/**); "
        "guardrail ci_config failed: .github/workflows/ci.yml changed."
    )


@pytest.mark.parametrize(
    ("evidence", "clause"),
    [
        (None, "guardrail secrets failed"),
        ({}, "guardrail secrets failed"),
        (
            {"path": "a.env", "line": 3, "rule_id": "aws"},
            "guardrail secrets failed: a.env:3 (aws)",
        ),
        ({"path": "a.env"}, "guardrail secrets failed: a.env"),
        (
            {"path": "a.env", "detail": "  2 findings.  "},
            "guardrail secrets failed: 2 findings.",
        ),
    ],
)
def test_evidence_renders_detail_first_then_the_location(
    evidence: dict | None, clause: str
) -> None:
    verdict: dict[str, Any] = {"check": "secrets", "mode": "block"}
    if evidence is not None:
        verdict["evidence"] = evidence
    assert halt_reason(change_set(guardrailVerdicts=[verdict])) == clause


def test_without_verdicts_the_failed_names_that_are_not_warnings_are_used() -> None:
    answer = change_set(
        guardrailFailures=["allowed_paths", "secrets"],
        guardrailWarnings=["secrets"],
        needsHuman=True,
    )
    assert halt_reason(answer) == "guardrail allowed_paths failed"
    assert halt_reason(change_set(needsHuman=True)) == GENERIC_REASON


def test_a_long_reason_is_clipped_to_the_finish_limit() -> None:
    verdicts = [
        {"check": "secrets", "mode": "block", "evidence": {"detail": "x" * 300}}
    ] * 3
    reason = halt_reason(change_set(guardrailVerdicts=verdicts))
    assert len(reason) == REASON_LIMIT and reason.endswith("...")


# --- operator notes -------------------------------------------------------------------------


def test_notes_follow_the_prompt_under_their_heading_and_blank_ones_vanish() -> None:
    assert with_notes("Do it.", []) == "Do it."
    assert with_notes("Do it.", ["  "]) == "Do it."
    assert with_notes("Do it.", [" one ", "two"]) == (
        f"Do it.\n\n{OPERATOR_NOTES}\n\n- one\n\n- two"
    )


# --- the control calls ----------------------------------------------------------------------


class _Transport:
    """Answers each request with the next canned answer, recording it."""

    def __init__(self, *answers: Answer) -> None:
        self.answers = list(answers)
        self.sent: list[Any] = []

    def send(self, request: Any) -> Answer:
        self.sent.append(request)
        return self.answers.pop(0)


def _client(transport: _Transport) -> IngestClient:
    client = ControlPlaneClient("http://rest.test", "secret")
    return IngestClient(client, transport, IdempotencyKeys("engine-test"))


def test_the_ingest_client_fetches_and_acknowledges_controls() -> None:
    pending = {
        "id": "c1",
        "kind": "steer",
        "payload": "Go.",
        "retryStage": True,
        "requestedAt": "2026-10-15T12:00:00Z",
        "expiresAt": "2026-10-15T12:10:00Z",
    }
    acked = {"id": "c1", "runId": RUN, "kind": "steer", "state": "acked"}
    transport = _Transport(Answer(200, {"controls": [pending]}), Answer(200, acked))
    client = _client(transport)

    fetched = client.fetch_controls(RUN)
    assert [(c.id, c.retry_stage) for c in fetched.controls] == [("c1", True)]
    assert client.ack_control(RUN, "c1", attempt=2).state == "acked"
    fetch, ack = transport.sent
    assert fetch.url.endswith(f"/internal/runs/{RUN}/controls/fetch")
    assert ack.url.endswith(f"/internal/runs/{RUN}/controls/c1/ack")
    assert ack.json == {"attempt": 2}


def _controls(control: FakeControl) -> Controls:
    reporter = RunReporter(control, RUN, 1)

    async def no_wait(_seconds: float) -> None:
        await asyncio.sleep(0)

    return Controls(control, reporter, interval=0.0, sleep=no_wait)


def _control() -> FakeControl:
    return FakeControl(
        chain(trigger(), llm("s"), term("t", "needs_review")), remote="unused"
    )


@pytest.mark.parametrize(
    ("state", "expected"), [("acked", True), ("expired", False), ("pending", False)]
)
def test_an_ack_refused_not_delivered_counts_only_when_already_acked(
    state: str, expected: bool
) -> None:
    control = _control()
    control.refusals["ack_control"] = [refusal("control_not_delivered", state=state)]
    controls = _controls(control)
    control.plan("abort")
    (pending,) = asyncio.run(controls.fetch())
    assert asyncio.run(controls.ack(pending)) is expected


def test_a_fetch_that_fails_answers_nothing_and_a_lost_run_fetches_nothing() -> None:
    control = _control()
    control.plan("pause")
    control.refusals["fetch_controls"] = [refusal("internal", 500)]

    def fail(_run: str) -> Any:
        raise TransportError("unreachable")

    controls = _controls(control)
    original = control.fetch_controls
    control.fetch_controls = fail  # type: ignore[method-assign]
    assert asyncio.run(controls.fetch()) == []
    control.fetch_controls = original  # type: ignore[method-assign]
    controls.reporter.mark_lost("fenced")
    assert asyncio.run(controls.fetch()) == []
    assert control.planned  # still waiting: nothing was claimed


def test_a_fetch_refused_as_lost_marks_the_run_lost() -> None:
    control = _control()
    controls = _controls(control)

    def lost(_run: str) -> Any:
        raise refusal("run_not_executable")

    control.fetch_controls = lost  # type: ignore[method-assign]
    assert asyncio.run(controls.fetch()) == []
    assert controls.reporter.lost == "run_not_executable"


def test_an_empty_steer_is_acknowledged_as_changing_nothing() -> None:
    control = _control()
    steer = control.plan("steer", payload="   ")
    asyncio.run(_controls(control).poll())
    assert control.ack_of(steer)["effect"] == EMPTY_STEER


def test_a_steer_after_the_attempt_ended_waits_for_the_next_one() -> None:
    control = _control()
    steer = control.plan("steer", payload="Later.")
    controls = _controls(control)
    executor = FakeNativeExecutor(Script())
    asyncio.run(controls.poll(Running(executor, "s", 1, 3, live=False)))
    assert control.acks() == []
    assert asyncio.run(controls.notes_for(2)) == ["Later."]
    assert control.ack_of(steer)["attempt"] == 2


def test_the_spi_default_refuses_to_steer() -> None:
    with pytest.raises(ExecutorCapabilityError):
        FakeNativeExecutor(Script()).steer("x")


def test_the_poller_applies_controls_to_the_running_attempt_until_left() -> None:
    control = _control()
    executor = FakeNativeExecutor(Script())
    controls = _controls(control)

    async def scenario() -> None:
        async with ControlPoller(controls, Running(executor, "s", 1, 3)):
            control.plan("pause")
            for _ in range(100):
                if controls.pause is not None:
                    break
                await asyncio.sleep(0.001)
        control.plan("abort")
        await asyncio.sleep(0.01)

    asyncio.run(scenario())
    assert controls.pause is not None and executor._pause
    assert controls.abort is None and len(control.planned) == 1  # not polled once left


# --- provenance -----------------------------------------------------------------------------


def _recorder(tree: Path) -> AttemptRecorder:
    ctx = StageContext(
        run_id=RUN,
        stage_key="implement",
        attempt=1,
        prompt="Do it.",
        model="coder-max",
        policy=ToolPolicy(
            working_tree=str(tree),
            permissions=LlmPermissions(push_fixup=False, touch_ci=False),
        ),
    )
    return AttemptRecorder(ctx, first_seq=1, evaluate=evaluate, policy_deadline=5.0)


def _turns(recorder: AttemptRecorder) -> list[ModelTurn]:
    events = []
    while not recorder.queue.empty():
        events.append(recorder.queue.get_nowait())
    return [event for event in events if isinstance(event, ModelTurn)]


def test_a_model_turn_carries_the_model_the_facade_reported_not_the_alias(
    tmp_path: Path,
) -> None:
    recorder = _recorder(tmp_path)
    recorder.on_message(
        AssistantMessage(content=[TextBlock("Hello.")], model="claude-opus-5-5")
    )
    (turn,) = _turns(recorder)
    assert turn.model_id == "claude-opus-5-5" != recorder.ctx.model


def test_a_message_naming_no_model_yields_no_model_turn(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path)
    recorder.on_message(
        AssistantMessage(
            content=[TextBlock("Hello."), ThinkingBlock("hmm", "sig")], model=""
        )
    )
    assert _turns(recorder) == []
