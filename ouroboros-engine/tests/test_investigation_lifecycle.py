"""The investigation loop's lifecycle, certified (CM.7, #626).

Every promise the loop makes fails quietly: a checkpoint skipped still ends in a brief, a resume
that re-archives still delivers, a failure that drops the usage still reports a reason, and a
demotion that stops working publishes an unsupported claim as a finding — the one failure the
page cannot survive. These cases hold the loop to the promises, on the same recorded tools and
recorded model as `test_investigation_loop.py`, asserting on what the control plane holds
afterwards: the ledger, the checkpoint and the usage.

Nothing here names a row id. The fake's ledger numbers its own rows and the cases read them
back; the one guarantee the fake cannot certify — that the control plane holds each record once
whatever a resumed attempt sends — is certified on the database in `ouroboros-rest`
(`research/certification/loop.certification.integration-spec.ts`).
"""

import pytest

from investigation_fakes import FakeControl, RecordedModel, request_for
from ouroboros_engine.investigation import loop as loop_module
from ouroboros_engine.investigation.contract import FailureReason
from ouroboros_engine.investigation.loop import InvestigationLoop

#: The loop's phases, in the order a run passes through them.
PHASES = ("plan", "iterate", "synthesize", "deliver")

#: Every failure the taxonomy names.
REASONS: tuple[FailureReason, ...] = (
    "tool_exhaustion",
    "budget_breach",
    "synthesis_failure",
    "engine_error",
)


def _run(control: FakeControl, model: RecordedModel, **overrides) -> str:
    return InvestigationLoop(control, model).run(request_for(**overrides))


def _archived(control: FakeControl) -> set[str]:
    """Every locator a tool answered during the run."""
    return {locator for answer in control.answered for locator in answer}


def _arrange(
    reason: FailureReason,
    control: FakeControl,
    model: RecordedModel,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, int]:
    """Set up the one failure the taxonomy names, answering any request overrides."""
    if reason == "tool_exhaustion":
        control.failing_tools = {
            "web": "research_tool_failed",
            "code": "research_tool_failed",
            "tickets": "research_tool_failed",
        }
    elif reason == "budget_breach":
        # plan 10 + select 10 + digest 10 = 30¢ reaches the ceiling mid-iteration.
        return {"spend_cents": 30}
    elif reason == "synthesis_failure":
        model.failing["synthesize"] = "chain_exhausted"
    else:

        def broken(*_args, **_kwargs):
            raise RuntimeError("a bug in the gate")

        monkeypatch.setattr(loop_module, "gate_claims", broken)
    return {}


# --- checkpoints -----------------------------------------------------------------------------


def test_a_checkpoint_follows_every_step_in_phase_order() -> None:
    control, model = FakeControl(), RecordedModel()

    assert _run(control, model) == "brief_ready"

    # One after the plan, one after every operation, one per synthesis pass, one to deliver.
    assert control.checkpoints >= len(control.tool_calls) + 1
    kept = [
        PHASES.index(phase) for phase in control.checkpoint_phases if phase in PHASES
    ]
    assert kept == sorted(kept), (
        "a run never checkpoints an earlier phase after a later one"
    )
    assert {"iterate", "synthesize"} <= set(control.checkpoint_phases)


@pytest.mark.parametrize("killed_at", [2, 3, 4, 6, 8, 9, 11])
def test_a_resumed_attempt_repeats_at_most_the_operation_in_flight(
    killed_at: int,
) -> None:
    reference = FakeControl()
    _run(reference, RecordedModel())

    control, model = FakeControl(), RecordedModel()
    control.die_at_checkpoint = killed_at

    assert _run(control, model) == "interrupted"
    assert _run(control, model) == "brief_ready"

    # Whatever the resumed attempt archived again came from one operation — the one that was
    # in flight when the worker died — and nothing was archived a third time.
    repeated = {
        locator for locator, times in control.archive_attempts.items() if times > 1
    }
    assert all(times <= 2 for times in control.archive_attempts.values())
    assert not repeated or any(repeated <= set(answer) for answer in control.answered)
    assert len(control.tool_calls) <= len(reference.tool_calls) + 1
    # The ledger holds every record once, and the brief is the uninterrupted run's.
    locators = [source.locator for source in control.sources]
    assert len(locators) == len(set(locators))
    assert _archived(control) == _archived(reference)
    assert [claim.text for claim in control.delivered.claims] == [
        claim.text for claim in reference.delivered.claims
    ]


# --- the failure taxonomy ----------------------------------------------------------------------


@pytest.mark.parametrize("reason", REASONS)
def test_every_failure_keeps_the_ledger_the_checkpoint_and_the_usage(
    reason: FailureReason, monkeypatch: pytest.MonkeyPatch
) -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=10.0)
    overrides = _arrange(reason, control, model, monkeypatch)

    assert _run(control, model, **overrides) == "failed"

    finished = control.finished
    assert finished is not None
    assert (control.status, finished.outcome, finished.reason) == (
        "failed",
        "failed",
        reason,
    )
    assert finished.detail, "a person is told why, in a sentence"
    assert control.delivered is None, "a failed run publishes nothing"

    # The partial is kept whole: every record a tool answered, the state the run reached, and
    # every model call it paid for — reconciled, not estimated.
    assert {source.locator for source in control.sources} == _archived(control)
    assert control.checkpoint_state is not None
    assert finished.checkpoint == control.checkpoint_state
    assert control.usage, "the calls made before the failure are on the record"
    assert sorted(control.usage) == list(range(1, len(control.usage) + 1))
    assert control.spend_cents() == sum(
        entry.cost_cents or 0 for entry in control.usage.values()
    )


def test_a_cancel_at_a_checkpoint_is_a_designed_partial() -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=10.0)
    control.cancel_at_checkpoint = 3

    assert _run(control, model) == "cancelled"

    finished = control.finished
    assert finished is not None
    assert (control.status, finished.outcome, finished.reason) == (
        "cancelled",
        "cancelled",
        None,
    )
    assert control.delivered is None
    assert control.sources, "what was gathered before the cancel is kept"
    assert {source.locator for source in control.sources} == _archived(control)
    assert control.checkpoint_state is not None
    assert control.usage and control.spend_cents() > 0


# --- the citation gate -----------------------------------------------------------------------


def test_no_finding_is_ever_delivered_uncited() -> None:
    control, model = FakeControl(), RecordedModel()
    planted = (
        "Novum will ship gust docking next quarter.",
        "AeroMesh licenses Skylink's controller.",
    )
    model.syntheses[0]["claims"].append({"text": planted[0], "cites": []})
    model.syntheses[1]["claims"].append({"text": planted[1], "cites": ["99", "nope"]})

    assert _run(control, model) == "brief_ready"

    delivered = control.delivered
    assert delivered is not None
    ledger = {source.id for source in control.sources}
    by_text = {claim.text: claim for claim in delivered.claims}

    # The planted claims reach the brief as questions that say they were offered as findings.
    for text in planted:
        assert (by_text[text].type, by_text[text].demoted, by_text[text].sources) == (
            "open_question",
            True,
            [],
        )
    # And no finding at all reaches it without a citation that resolves in this ledger.
    findings = [claim for claim in delivered.claims if claim.type == "finding"]
    assert findings
    for finding in findings:
        assert finding.sources and set(finding.sources) <= ledger
