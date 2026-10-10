"""The investigation loop against recorded tools and a recorded model (CM.1, #620).

Each of the issue's acceptance criteria is a test here, asserted on what the control plane
holds afterwards — the ledger, the checkpoint, the usage rows, the delivered brief.
"""

import logging
import re
from pathlib import Path

import pytest

from investigation_fakes import (
    INVESTIGATION,
    PLAYBOOKS,
    FakeControl,
    RecordedModel,
    request_for,
)
from ouroboros_engine.investigation import loop as loop_module
from ouroboros_engine.investigation.contract import LOOP_VERSION, task_ref
from ouroboros_engine.investigation.loop import (
    ENGINE_ERROR_DETAIL,
    InvestigationLoop,
    LoopState,
)


def _run(control: FakeControl, model: RecordedModel, **overrides) -> str:
    return InvestigationLoop(control, model).run(request_for(**overrides))


# --- the brief: every finding cites the ledger ---------------------------------------------


def test_a_gap_analysis_delivers_a_brief_whose_every_finding_cites_the_ledger() -> None:
    control, model = FakeControl(), RecordedModel()

    assert _run(control, model) == "brief_ready"

    delivered = control.delivered
    assert delivered is not None and control.status == "brief_ready"
    ledger = {source.id for source in control.sources}
    findings = [claim for claim in delivered.claims if claim.type == "finding"]
    assert len(ledger) == 4
    assert len(findings) == 4
    for finding in findings:
        assert finding.sources, finding.text
        assert set(finding.sources) <= ledger

    # Every claim is stated by exactly one span of the body, and nothing else is.
    refs = [
        span.claim
        for paragraph in delivered.body.paragraphs
        for span in paragraph.spans
        if span.claim is not None
    ]
    assert sorted(refs) == sorted(claim.ref for claim in delivered.claims)


def test_the_brief_cites_the_records_the_tools_archived() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model)

    by_text = {claim.text: claim for claim in control.delivered.claims}
    locators = {source.id: source.locator for source in control.sources}

    unchanged = by_text["Our approach controller has been unchanged in 14 months."]
    assert [locators[source] for source in unchanged.sources] == [
        "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214"
    ]


def test_a_gap_analysis_delivers_matrix_rows_gated_like_the_brief() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model)

    cells = control.delivered.deliverables["matrix"]["rows"][0]["cells"]

    assert [cell["subject"] for cell in cells] == ["Helios", "Skylink", "Novum"]
    assert cells[0]["sources"] == ["src-3"] and cells[0]["status"] == "partial"
    # The model said "none" about Novum and cited nothing: that is "unknown", not "none".
    assert cells[2] == {"subject": "Novum", "status": "unknown", "sources": []}
    assert all("cites" not in cell for cell in cells)


# --- the demotion path -----------------------------------------------------------------------


def test_a_planted_uncited_claim_is_demoted_to_an_open_question_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    control, model = FakeControl(), RecordedModel()
    model.syntheses[0]["claims"].append(
        {"text": "Novum will ship gust docking next quarter.", "cites": []}
    )
    model.syntheses[1]["claims"].append(
        {"text": "AeroMesh licenses Skylink's controller.", "cites": ["99", "nope"]}
    )

    with caplog.at_level(logging.WARNING, logger=loop_module.__name__):
        assert _run(control, model) == "brief_ready"

    by_text = {claim.text: claim for claim in control.delivered.claims}
    for planted in (
        "Novum will ship gust docking next quarter.",
        "AeroMesh licenses Skylink's controller.",
    ):
        claim = by_text[planted]
        assert claim.type == "open_question"
        assert claim.demoted is True
        assert claim.sources == []

    # The model's own open question is one too, but it was never offered as a finding.
    assert by_text["Does AeroMesh use a beacon?"].demoted is False

    demotions = [
        record
        for record in caplog.records
        if record.getMessage() == "uncited claims demoted to open questions"
    ]
    assert [record.demoted for record in demotions] == [1, 1]
    assert all(record.investigation == INVESTIGATION for record in demotions)
    # The claim's words are the workspace's and stay out of the log.
    assert "Novum" not in caplog.text
    assert control.checkpoint_state["demoted"] == 2


def test_a_brief_of_only_open_questions_is_still_delivered() -> None:
    control, model = FakeControl(), RecordedModel()
    for synthesis in model.syntheses:
        for claim in synthesis["claims"]:
            claim["cites"] = []

    assert _run(control, model) == "brief_ready"

    assert {claim.type for claim in control.delivered.claims} == {"open_question"}


# --- kill and resume -------------------------------------------------------------------------


@pytest.mark.parametrize("killed_at", [2, 3, 4, 6, 8, 9, 11])
def test_a_killed_worker_resumes_from_its_checkpoint_without_duplicate_rows(
    killed_at: int,
) -> None:
    uninterrupted, reference = FakeControl(), RecordedModel()
    _run(uninterrupted, reference)

    control, model = FakeControl(), RecordedModel()
    control.die_at_checkpoint = killed_at

    assert _run(control, model) == "interrupted"
    assert control.status == "running", (
        "a killed worker leaves the investigation running"
    )
    held = len(control.sources)

    assert _run(control, model) == "brief_ready"

    assert control.attempt == 2
    locators = [source.locator for source in control.sources]
    assert len(locators) == len(set(locators)) == 4
    assert len(control.sources) >= held
    assert sorted(control.usage) == list(range(1, len(control.usage) + 1))
    # The plan is never asked for twice, and at most the operation in flight is repeated.
    assert model.stages().count("plan") == 1
    assert len(control.tool_calls) <= len(uninterrupted.tool_calls) + 1
    assert [claim.text for claim in control.delivered.claims] == [
        claim.text for claim in uninterrupted.delivered.claims
    ]


def test_a_resumed_run_continues_with_the_operations_it_had_already_chosen() -> None:
    control, model = FakeControl(), RecordedModel()
    # Checkpoints: 1 plan, 2 selection, 3 first operation — killed writing the third.
    control.die_at_checkpoint = 3

    _run(control, model)
    assert control.checkpoint_state["pending"][0]["op"] == "search"

    _run(control, model)

    # Two iterations were selected in total — the first was not asked for again.
    assert model.stages().count("select") == 2
    assert [call[:2] for call in control.tool_calls] == [
        ("web", "search"),
        ("web", "search"),
        ("web", "fetch"),
        ("code", "query"),
        ("tickets", "query"),
    ]


def test_a_checkpoint_from_another_loop_version_is_not_continued_from() -> None:
    control, model = FakeControl(), RecordedModel()
    control.checkpoint_state = {"version": "loop-v0", "phase": "deliver"}

    assert _run(control, model) == "brief_ready"
    assert model.stages()[0] == "plan"


def test_a_replaced_worker_stops_without_touching_the_investigation() -> None:
    control, model = FakeControl(), RecordedModel()

    def replaced() -> None:
        control.before_tool = None
        control.attempt += 1  # the control plane handed the run to a newer attempt

    control.before_tool = replaced

    assert _run(control, model) == "superseded"
    assert control.status == "running" and control.finished is None


# --- cancel ----------------------------------------------------------------------------------


def test_a_cancel_mid_run_lands_the_partial_with_its_ledger_intact() -> None:
    control, model = FakeControl(), RecordedModel()
    control.cancel_at_checkpoint = 3  # after the first tool operation

    assert _run(control, model) == "cancelled"

    assert control.status == "cancelled"
    assert control.finished.outcome == "cancelled" and control.finished.reason is None
    assert [source.cite_no for source in control.sources] == [1]
    assert len(control.tool_calls) == 1, (
        "the cancel is honoured before the next operation"
    )
    assert control.checkpoint_state["phase"] == "iterate"
    assert control.checkpoint_state["operations_used"] == 1
    assert control.delivered is None
    assert "synthesize" not in model.stages()


def test_a_cancel_requested_before_the_worker_started_runs_nothing() -> None:
    control, model = FakeControl(), RecordedModel()
    control.cancel_requested = True

    assert _run(control, model) == "cancelled"
    assert model.calls == [] and control.tool_calls == []


# --- budgets and spend -----------------------------------------------------------------------


def test_a_budget_breach_stops_cleanly_with_actuals_and_partials() -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=10.0)

    # plan 10 + select 10 + digest 10 = 30¢ reaches the ceiling before the second digest.
    assert _run(control, model, spend_cents=30) == "failed"

    finished = control.finished
    assert finished.reason == "budget_breach"
    assert "30¢" in finished.detail
    assert control.status == "failed"
    assert len(control.sources) == 2, "what the tools archived is kept"
    assert control.checkpoint_state["phase"] == "iterate"
    assert control.spend_cents() == 30.0
    assert control.delivered is None


def test_a_cap_the_gateway_enforces_mid_call_is_a_budget_breach() -> None:
    control, model = FakeControl(), RecordedModel()
    model.failing["synthesize"] = "cost_cap_exceeded"

    assert _run(control, model) == "failed"
    assert control.finished.reason == "budget_breach"
    assert len(control.sources) == 4


def test_spend_reconciles_with_the_usage_rows_of_the_run() -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=8.25)
    _run(control, model)

    # One usage row per model call, numbered without gaps, and their total is the spend.
    assert len(control.usage) == len(model.calls)
    assert sorted(control.usage) == list(range(1, len(model.calls) + 1))
    assert control.spend_cents() == pytest.approx(8.25 * len(model.calls))
    assert control.checkpoint_state["spend_cents"] == pytest.approx(
        control.spend_cents()
    )
    assert {entry.stage for entry in control.usage.values()} == {
        "plan",
        "select",
        "digest",
        "synthesize",
    }
    by_stage = {entry.stage: entry.alias for entry in control.usage.values()}
    assert by_stage["plan"] == by_stage["select"] == "sizer"
    assert by_stage["digest"] == by_stage["synthesize"] == "researcher-long-ctx"


def test_an_unpriced_model_spends_nothing_and_breaches_nothing() -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=None)

    assert _run(control, model, spend_cents=0) == "failed"
    assert control.finished.reason == "budget_breach", (
        "a ceiling of zero allows no call"
    )

    control, model = FakeControl(), RecordedModel(cost_cents=None)
    assert _run(control, model, spend_cents=None) == "brief_ready"
    assert all(entry.cost_cents is None for entry in control.usage.values())


def test_each_call_is_capped_at_what_is_left_of_the_ceiling() -> None:
    control, model = FakeControl(), RecordedModel(cost_cents=10.0)
    _run(control, model, spend_cents=600)

    assert [call.cost_cap_cents for call in model.calls[:3]] == [600, 590, 580]
    assert {call.investigation for call in model.calls} == {INVESTIGATION}
    assert {call.resolution_version for call in model.calls} == {"r1"}


def test_the_depth_preset_and_the_budget_bound_the_work() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model, depth="quick")
    assert model.stages().count("select") == 1
    assert len(control.tool_calls) == 2
    assert sum(1 for call in model.calls if "Cover these" in call.user) == 1

    control, model = FakeControl(), RecordedModel()
    _run(control, model, operations=3)
    assert len(control.tool_calls) == 3, (
        "the operation budget stops the second iteration"
    )

    control, model = FakeControl(), RecordedModel()
    _run(control, model, sources=2)
    assert len(control.sources) == 2 and model.stages().count("select") == 1


def test_a_search_never_asks_for_more_hits_than_the_source_budget_allows() -> None:
    control, model = FakeControl(), RecordedModel()
    model.selections[0][0]["input"]["limit"] = 40
    _run(control, model, sources=5)

    assert control.tool_calls[0] == (
        "web",
        "search",
        {"query": "skylink docking wind", "limit": 5},
    )


# --- one engine, four kinds ------------------------------------------------------------------


@pytest.mark.parametrize("kind", sorted(PLAYBOOKS))
def test_every_kind_runs_through_the_same_loop_and_delivers_its_playbook(
    kind: str,
) -> None:
    control, model = FakeControl(), RecordedModel()

    assert _run(control, model, kind=kind) == "brief_ready"

    expected = [name for name in PLAYBOOKS[kind]["deliverables"] if name != "brief"]
    assert sorted(control.delivered.deliverables) == sorted(expected)
    assert all(
        claim.sources for claim in control.delivered.claims if claim.type == "finding"
    )
    # The same steps in the same order, whatever the kind.
    assert model.stages() == [
        "plan",
        "select",
        "digest",
        "digest",
        "select",
        "digest",
        "digest",
        "synthesize",
        "synthesize",
        "synthesize",
    ]


def test_the_loop_has_no_code_path_named_after_a_kind() -> None:
    package = Path(loop_module.__file__).parent
    for module in ("loop.py", "claims.py", "runner.py", "model.py", "prompts.py"):
        source = (package / module).read_text(encoding="utf-8")
        for kind in PLAYBOOKS:
            assert not re.search(rf"\b{kind}\b", source), f"{module} names {kind}"
        assert (
            "kind.slug ==" not in source
            and "playbook.synthesis_template ==" not in source
        )


def test_an_uncited_roadmap_theme_is_marked_rather_than_dropped() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model, kind="roadmap_improvements")

    themes = control.delivered.deliverables["roadmap_doc"]["themes"]
    assert themes[0]["sources"] == ["src-4"] and "uncited" not in themes[0]
    assert themes[1] == {
        "title": "Beacons",
        "rationale": "A hunch",
        "sources": [],
        "uncited": True,
    }


# --- provenance ------------------------------------------------------------------------------


def test_provenance_records_the_loop_version_the_alias_and_the_resolution() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model)

    assert control.provenance == {
        "researcher": LOOP_VERSION,
        "alias": "researcher-long-ctx",
        "resolution_ref": "r1",
        "task": task_ref(INVESTIGATION),
        "investigation": INVESTIGATION,
    }
    assert LOOP_VERSION == "loop-v1"
    assert control.checkpoint_state["version"] == "loop-v1"


# --- the failure taxonomy --------------------------------------------------------------------


def test_tools_that_return_nothing_citable_are_tool_exhaustion() -> None:
    control, model = FakeControl(), RecordedModel()
    control.failing_tools = {
        "web": "research_tool_not_configured",
        "code": "research_tool_failed",
        "tickets": "research_tool_failed",
    }

    assert _run(control, model) == "failed"

    assert control.finished.reason == "tool_exhaustion"
    assert len(control.tool_calls) == 2, (
        "an iteration that wholly failed is not repeated"
    )
    assert control.checkpoint_state["operations_failed"] == 2
    assert control.checkpoint_state["failures"] == [
        "web.search: research_tool_not_configured",
        "web.fetch: research_tool_not_configured",
    ]
    assert "synthesize" not in model.stages()


def test_one_failing_tool_does_not_fail_the_investigation() -> None:
    control, model = FakeControl(), RecordedModel()
    control.failing_tools = {"code": "research_tool_failed"}
    model.syntheses[1]["claims"][0]["cites"] = ["03"]  # now the tickets record

    assert _run(control, model) == "brief_ready"
    assert len(control.sources) == 3


def test_a_model_that_cannot_be_reached_is_a_synthesis_failure_keeping_the_ledger() -> (
    None
):
    control, model = FakeControl(), RecordedModel()
    model.failing["synthesize"] = "gateway_unavailable"

    assert _run(control, model) == "failed"

    assert control.finished.reason == "synthesis_failure"
    assert "synthesize" in control.finished.detail
    assert len(control.sources) == 4
    assert control.checkpoint_state["phase"] == "synthesize"


def test_an_absent_gateway_fails_the_plan_step_by_name() -> None:
    control, model = FakeControl(), RecordedModel()
    model.failing["plan"] = "gateway_unavailable"

    assert _run(control, model) == "failed"
    assert control.finished.reason == "synthesis_failure"
    assert control.tool_calls == []


def test_an_answer_that_is_not_json_is_asked_for_once_more_then_fails() -> None:
    control, model = FakeControl(), RecordedModel()
    model.garbled["plan"] = 1
    assert _run(control, model) == "brief_ready"
    assert model.stages()[:2] == ["plan", "plan"]

    control, model = FakeControl(), RecordedModel()
    model.garbled["synthesize"] = 2
    assert _run(control, model) == "failed"
    assert control.finished.reason == "synthesis_failure"
    # Both attempts were paid for and are in the usage rows.
    assert len(control.usage) == len(model.calls)


def test_a_digest_that_is_not_json_costs_the_notes_not_the_investigation() -> None:
    control, model = FakeControl(), RecordedModel()
    model.garbled["digest"] = 8

    assert _run(control, model) == "brief_ready"
    assert control.checkpoint_state["notes"] == {}


def test_synthesis_with_nothing_to_say_is_a_synthesis_failure() -> None:
    control, model = FakeControl(), RecordedModel()
    model.syntheses = [{"claims": [], "open_questions": []}] * 2

    assert _run(control, model) == "failed"
    assert control.finished.reason == "synthesis_failure"


def test_a_bug_in_the_loop_is_an_engine_error_not_a_stuck_investigation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    control, model = FakeControl(), RecordedModel()

    def broken(*_args, **_kwargs):
        raise RuntimeError("secret detail that must not reach a person")

    monkeypatch.setattr(loop_module, "gate_claims", broken)

    assert _run(control, model) == "failed"
    assert control.finished.reason == "engine_error"
    assert control.finished.detail == ENGINE_ERROR_DETAIL
    assert len(control.sources) == 4


def test_an_investigation_that_cannot_be_started_is_refused_without_work() -> None:
    control, model = FakeControl(), RecordedModel()
    control.status = "brief_ready"

    assert _run(control, model) == "refused"
    assert model.calls == []


# --- the selection step is held to the enabled tools ------------------------------------------


def test_operations_naming_a_tool_or_operation_not_enabled_are_dropped() -> None:
    control, model = FakeControl(), RecordedModel()
    model.selections[0] = [
        {"tool": "telemetry", "op": "query", "input": {"metric": "x"}},
        {"tool": "code", "op": "search", "input": {"query": "x"}},
        {"tool": "web", "op": "search", "input": {}},
        {"tool": "web", "op": "delete", "input": {"query": "x"}},
        "not an operation",
        *model.selections[0],
    ]

    assert _run(control, model) == "brief_ready"
    assert [call[:2] for call in control.tool_calls[:2]] == [
        ("web", "search"),
        ("web", "fetch"),
    ]


def test_a_selection_of_nothing_ends_iterating() -> None:
    control, model = FakeControl(), RecordedModel()
    model.selections[1] = []

    assert _run(control, model) == "brief_ready"
    assert len(control.tool_calls) == 2 and model.stages().count("select") == 2


def test_the_state_round_trips_through_a_checkpoint() -> None:
    control, model = FakeControl(), RecordedModel()
    _run(control, model)

    restored = LoopState.model_validate(control.checkpoint_state)
    assert restored.phase == "deliver"
    assert len(restored.sections) == 2
    assert restored.sections[0][0].finding


def test_a_playbook_this_build_cannot_deliver_never_claims_the_investigation() -> None:
    control, model = FakeControl(), RecordedModel()
    request = request_for()
    unsupported = request.model_copy(
        update={
            "kind": request.kind.model_copy(
                update={
                    "playbook": request.kind.playbook.model_copy(
                        update={"synthesis_template": "gap_analysis@9"}
                    )
                }
            )
        }
    )

    assert InvestigationLoop(control, model).run(unsupported) == "refused"
    assert control.status == "queued" and control.attempt == 0
