"""The deep dry run, end to end over fakes: the rows, the diff, the skips, the caps (CD.2, #560)."""

import copy

import pytest

from dryrun_fakes import (
    ARBITRATION,
    BUILD_NOTE,
    DRY_RUN,
    PATCHED,
    STAGES,
    Bench,
    RecordedEstimates,
    RecordingReader,
    ScriptedModel,
    definition,
    happy,
    request,
    result,
    tool,
)
from ouroboros_engine.dryrun.contract import (
    MAX_ARTIFACT_BYTES,
    DryRunDone,
    GuardBlocked,
    StageFinished,
    StageStarted,
)
from ouroboros_engine.dryrun.estimates import EstimateUnavailableError
from ouroboros_engine.dryrun.harness import (
    MAX_ROUNDS,
    deep_evaluate,
    infra_kind,
    stage_order,
)
from ouroboros_engine.dryrun.notes import MINUS, TIMES
from ouroboros_engine.dryrun.workspace import (
    ReadCache,
    VirtualWorkspace,
    WorkspaceError,
)
from ouroboros_engine.investigation.model import ModelFailureError
from ouroboros_engine.workflows.dsl import PathsPredicate
from ouroboros_engine.workflows.validate import validate_workflow_document

W7 = "No routing task named `exploit-verify` exists in this workspace yet."


def rows(result_) -> list[tuple]:
    return [
        (r.stage_key, r.display_name, r.verdict, r.how, r.note) for r in result_.stages
    ]


# -- the seeded run ---------------------------------------------------------------------


def test_the_seeded_draft_is_a_valid_document():
    assert validate_workflow_document(definition()).valid


def test_the_seeded_dry_run_reproduces_the_cards_row_shapes():
    _, done = Bench().run()

    assert done.status == "complete"
    assert done.failure_reason is None
    assert rows(done) == [
        (
            "analyze",
            "analyze",
            "ok",
            "llm",
            "mapped 4 files · skill advisory-db skipped (not defined yet)",
        ),
        ("plan", "plan", "ok", "llm", f"3 steps · would touch {ARBITRATION}"),
        (
            "implement",
            "implement",
            "ok",
            "llm",
            f"diff drafted +3 {MINUS}1 (below) · 3k tokens",
        ),
        ("build", "build", "ok", "replayed", BUILD_NOTE),
        (
            "test",
            "test",
            "ok",
            "replayed",
            "insufficient history — the first real run will measure this "
            "(0 similar runs found)",
        ),
        ("exploit-verify", "exploit-verify", "skipped", "skipped", W7),
        ("review", f"review {TIMES}2", "ok", "llm", "both approve · 1 style nit"),
        (
            "open-pr",
            "open PR",
            "not_reached",
            "deterministic",
            "would open DRAFT PR · not merged (policy)",
        ),
    ]
    assert [r.seq for r in done.stages] == list(range(1, 9))


def test_rows_carry_the_metrics_the_record_stores():
    _, done = Bench().run()
    by_key = {r.stage_key: r for r in done.stages}

    assert by_key["analyze"].metrics == {
        "tokens": 3000,
        "cost_cents": 3,
        "files_touched": 4,
    }
    assert by_key["plan"].metrics == {"tokens": 1000, "cost_cents": 1}
    assert by_key["implement"].metrics == {
        "tokens": 3000,
        "cost_cents": 3,
        "files_touched": 1,
        "simulated_writes": 1,
        "lines_added": 3,
        "lines_removed": 1,
    }
    assert by_key["build"].metrics["sample_count"] == 214
    assert by_key["review"].metrics == {
        "tokens": 3000,
        "cost_cents": 3,
        "files_touched": 1,
    }
    assert by_key["review"].nodes == ["review-primary", "review-second"]
    assert by_key["exploit-verify"].skip_reason == W7
    assert by_key["exploit-verify"].metrics == {}
    assert by_key["open-pr"].metrics == {}
    assert done.tokens == 10000
    assert done.cost_cents == 10


def test_a_skipped_row_has_a_reason_exactly_when_it_is_skipped():
    _, done = Bench().run()

    for row in done.stages:
        assert (row.verdict == "skipped") == (row.how == "skipped")
        assert (row.verdict == "skipped") == (row.skip_reason is not None)
        assert row.verdict == "not_reached" or row.note.strip()


def test_the_diff_artifact_is_the_overlay_and_only_in_memory():
    bench = Bench()
    _, done = bench.run()
    diff = next(a for a in done.artifacts if a.kind == "overlay_diff")

    assert diff.content.startswith(f"--- a/{ARBITRATION}\n+++ b/{ARBITRATION}\n@@ ")
    assert "+\t\tk_sleep(K_USEC(backoff_us)); /* exponential backoff */" in diff.content
    assert (
        "-\t\tcan_retry_tx(dev, frame); /* immediate retry floods the bus */"
        in diff.content
    )
    assert diff.truncated is False
    assert diff.original_bytes == len(diff.content.encode())
    assert [(p.path, p.added, p.removed) for p in diff.path_summary] == [
        (ARBITRATION, 3, 1)
    ]
    # The repository still holds what it held: nothing was written back.
    assert bench.reader.files[ARBITRATION] != PATCHED
    assert {call for call, _ in bench.reader.calls} <= {"tree", "blob"}


def test_plan_and_review_excerpts_are_kept():
    _, done = Bench().run()
    kinds = {a.kind: a for a in done.artifacts}

    assert kinds["plan_excerpt"].content == (
        "plan\n1. Add a backoff counter\n2. Sleep before retry\n3. Cap the backoff"
    )
    assert kinds["review_excerpt"].content == (
        "review-primary: approve\nCorrect.\n- style: Name the 50 us constant.\n\n"
        "review-second: approve\nFine."
    )
    assert kinds["plan_excerpt"].path_summary == []


def test_progress_is_streamed_stage_by_stage_and_ends_with_one_done():
    events, done = Bench().run()

    assert isinstance(events[-1], DryRunDone)
    assert sum(isinstance(e, DryRunDone) for e in events) == 1
    started = [e.stage_key for e in events if isinstance(e, StageStarted)]
    finished = [e.stage.stage_key for e in events if isinstance(e, StageFinished)]
    assert started == ["analyze", "plan", "implement", "build", "test", "review"]
    assert finished == [r.stage_key for r in done.stages]
    # A started row is announced before it finishes, with the seq it will carry.
    for event in events:
        if isinstance(event, StageStarted):
            later = next(
                e
                for e in events[events.index(event) :]
                if isinstance(e, StageFinished) and e.stage.stage_key == event.stage_key
            )
            assert later.stage.seq == event.seq
            assert later.stage.started_at < later.stage.finished_at
    assert not any(isinstance(e, GuardBlocked) for e in events)
    assert done.guard_audit == []
    assert done.guards_clean is True
    assert done.duration_ms > 0


def test_the_same_outputs_compose_the_same_notes():
    first = rows(Bench().run()[1])
    second = rows(Bench().run()[1])

    assert first == second


# -- real models, attributed and routed -------------------------------------------------


def test_each_model_stage_calls_its_resolved_alias_attributed_to_the_dry_run():
    bench = Bench()
    bench.run()
    calls = {call.stage_key: call for call in bench.model.calls}

    assert bench.model.stages_called() == [
        "analyze",
        "plan",
        "implement",
        "review-primary",
        "review-second",
    ]
    assert {key: call.alias for key, call in calls.items()} == {
        "analyze": "coder-std",
        "plan": "coder-std",
        "implement": "coder-max",
        "review-primary": "reviewer",
        "review-second": "coder-std",
    }
    assert all(call.dry_run == DRY_RUN for call in bench.model.calls)
    assert calls["implement"].resolution_version == "z1-v7"
    assert calls["plan"].cost_cap_cents is None


def test_a_stage_is_told_its_own_prompt_its_knowledge_and_the_ticket():
    bench = Bench()
    bench.run()
    first = {}
    for call in bench.model.calls:
        first.setdefault(call.stage_key, call.messages[0]["content"])

    assert (
        "Map the code paths CAN arbitration retries flood the bus touches."
        in first["analyze"]
    )
    assert "Plan the fix for #489." in first["plan"]
    assert "Repo profile: Zephyr RTOS, C17." in first["plan"]
    assert "# Knowledge" not in first["analyze"]
    assert "Lost-arbitration frames are retried at once." in first["implement"]
    assert "Labels: security, can" in first["implement"]
    # Earlier stages' conclusions travel forward.
    assert "1. Add a backoff counter" in first["implement"]
    assert "Would touch: drivers/can/arbitration.c" in first["implement"]


def test_the_repository_token_never_reaches_a_model_or_the_result():
    bench = Bench()
    events, _ = bench.run()
    said = "".join(
        call.system + "".join(m["content"] for m in call.messages)
        for call in bench.model.calls
    )
    streamed = "".join(event.model_dump_json() for event in events)

    assert "ghs_dry_run_read_token" not in said
    assert "ghs_dry_run_read_token" not in streamed
    assert "ghs_dry_run_read_token" not in repr(bench.repositories[0])
    assert bench.repositories[0].token == "ghs_dry_run_read_token"


def test_a_reviewer_reads_the_implementers_draft_through_the_overlay():
    seen = {}

    def review(call):
        seen["context"] = call.messages[0]["content"]
        return tool("read_file", path=ARBITRATION)

    def verdict(call):
        seen["read"] = call.messages[-1]["content"]
        return result(verdict="approve")

    script = happy()
    script["review-primary"] = [review, verdict]
    bench = Bench(model=ScriptedModel(script))
    _, done = bench.run()

    assert done.status == "complete"
    # The reviewer is shown the simulated diff…
    assert "# Simulated diff so far" in seen["context"]
    assert (
        "+\t\tbackoff_us = MIN(backoff_us << 1, CAN_ARB_BACKOFF_MAX_US);"
        in seen["context"]
    )
    # …and a read of the file returns the implementer's text, not the commit's.
    assert "k_sleep(K_USEC(backoff_us))" in seen["read"]
    assert "immediate retry floods the bus" not in seen["read"]
    # While the stage before the edit saw none of it.
    analyze = next(c for c in bench.model.calls if c.stage_key == "analyze")
    assert "Simulated diff" not in analyze.messages[0]["content"]


# -- reads: pinned, lazy, cached --------------------------------------------------------


def test_reads_resolve_at_the_pinned_commit_and_are_not_refetched():
    bench = Bench()
    _, done = bench.run()

    assert (
        bench.repositories[0].pinned_sha == "8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2"
    )
    # analyze, implement and a reviewer all read arbitration.c: one fetch.
    assert bench.reader.blobs(ARBITRATION) == 1
    assert bench.reader.calls.count(("tree", "")) == 1
    assert done.fetches == len(bench.reader.calls)
    # README.md was never asked for by a tool; the search fetched it once, lazily.
    assert bench.reader.blobs("README.md") == 1


def test_a_second_run_of_the_same_commit_reads_nothing_again():
    bench = Bench()
    bench.run()
    fetched = len(bench.reader.calls)

    again = Bench(reader=bench.reader, cache=bench.cache)
    _, done = again.run()

    assert len(bench.reader.calls) == fetched
    assert done.fetches == 0
    assert done.status == "complete"


def test_another_commit_does_not_share_the_cache():
    bench = Bench()
    bench.run()
    fetched = len(bench.reader.calls)

    other = Bench(reader=bench.reader, cache=bench.cache)
    other.run(
        repository={
            "slug": "acme-robotics/helios-firmware",
            "pinned_sha": "a" * 40,
        }
    )

    assert len(bench.reader.calls) > fetched


def test_what_a_lazy_workspace_could_not_do_is_noted():
    _, done = Bench(reader=RecordingReader(truncated=True)).run()

    assert done.workspace_notes == [
        "the git host truncated the file listing: paths deep in the tree may be "
        "missing from listings and searches"
    ]
    assert Bench().run()[1].workspace_notes == []


def test_an_unreadable_repository_fails_the_stage_that_needed_it_and_keeps_the_rows():
    reader = RecordingReader()
    reader.fail = WorkspaceError("unavailable", "the git host answered 502")
    script = happy()
    script["implement"] = [
        tool("edit_file", path="NOTES.md", content="x\n"),
        result(summary="Wrote a note."),
    ]
    _, done = Bench(model=ScriptedModel(script), reader=reader).run()
    by_key = {r.stage_key: r for r in done.stages}

    assert done.status == "failed"
    assert (
        done.failure_reason
        == "the repository could not be read: the git host answered 502"
    )
    # Stages that only talked finished; their reads were refused, and they were told so.
    assert (by_key["analyze"].verdict, by_key["plan"].verdict) == ("ok", "ok")
    assert by_key["analyze"].note.startswith("completed")
    # The stage whose draft could not be measured against the commit fails, with a row.
    assert (by_key["implement"].verdict, by_key["implement"].note) == (
        "failed",
        "the repository could not be read: the git host answered 502",
    )
    assert {by_key[k].verdict for k in ("build", "test", "review", "open-pr")} == {
        "not_reached"
    }
    assert done.artifacts == []


# -- infrastructure: replayed, never invented -------------------------------------------


def test_infrastructure_stages_ask_the_estimator_with_their_pool_and_command():
    bench = Bench()
    _, done = bench.run()
    stage_asks = [ask for ask in bench.estimates.asked if ask[2:] != (None, None)]

    assert stage_asks == [
        (DRY_RUN, "build", "pool-a", None),
        (DRY_RUN, "test", None, "west twister -T tests"),
    ]
    assert "build" not in bench.model.stages_called()
    assert "test" not in bench.model.stages_called()
    build = next(r for r in done.stages if r.stage_key == "build")
    assert build.how == "replayed"
    assert build.metrics["estimate_ms"] == 242000


def test_insufficient_history_is_passed_on_with_no_number():
    _, done = Bench().run()
    test_row = next(r for r in done.stages if r.stage_key == "test")

    assert test_row.metrics["insufficient_history"] is True
    assert "estimate_ms" not in test_row.metrics
    assert test_row.verdict == "ok"


def test_the_build_tool_answers_from_history_not_from_the_model():
    seen = {}

    def after_build(call):
        seen["tool_result"] = call.messages[-1]["content"]
        return result(summary="Drafted.")

    script = happy()
    script["implement"] = [
        tool("edit_file", path=ARBITRATION, content=PATCHED) + "\n" + tool("build"),
        after_build,
    ]
    bench = Bench(model=ScriptedModel(script))
    bench.run()

    assert (
        f"[build] ok\nReplayed from history, nothing was run: {BUILD_NOTE}"
        in seen["tool_result"]
    )
    assert (DRY_RUN, "build", None, None) in bench.estimates.asked


def test_a_model_stating_a_build_time_changes_no_row():
    script = happy()
    script["implement"][-1] = result(summary="The build takes 9m 59s, I am sure.")
    _, done = Bench(model=ScriptedModel(script)).run()

    assert next(r for r in done.stages if r.stage_key == "build").note == BUILD_NOTE
    assert not any("9m 59s" in r.note for r in done.stages)


def test_an_estimator_that_cannot_answer_fails_the_run_rather_than_guessing():
    estimates = RecordedEstimates()
    estimates.fail = EstimateUnavailableError("replay_pool_required", "no pool")
    _, done = Bench(estimates=estimates).run()
    by_key = {r.stage_key: r for r in done.stages}

    assert done.status == "failed"
    assert (
        done.failure_reason
        == "stage `build` could not be estimated (replay_pool_required)"
    )
    assert (by_key["build"].verdict, by_key["build"].how, by_key["build"].note) == (
        "failed",
        "deterministic",
        "no replay estimate: replay_pool_required",
    )
    assert by_key["test"].verdict == "not_reached"
    assert by_key["review"].verdict == "not_reached"
    assert by_key["implement"].verdict == "ok"
    # What was drafted before the failure is kept.
    assert any(a.kind == "overlay_diff" for a in done.artifacts)


@pytest.mark.parametrize(
    ("node_id", "title", "kind"),
    [
        ("build", "build", "build"),
        ("tests", "tests", "test"),
        ("hil", "Run tests on the rig", "test"),
        ("unit-tests", "unit", "test"),
        ("package", "contest image", "build"),
        ("attest", "attestation", "build"),
    ],
)
def test_an_infrastructure_stage_is_a_test_only_when_its_name_says_test(
    node_id, title, kind
):
    doc = copy.deepcopy(definition())
    node = next(n for n in doc["nodes"] if n["id"] == "build")
    node["id"], node["title"] = node_id, title
    for edge in doc["edges"]:
        edge["from"] = node_id if edge["from"] == "build" else edge["from"]
        edge["to"] = node_id if edge["to"] == "build" else edge["to"]
    document = validate_workflow_document(doc).document

    assert infra_kind(next(n for n in document.nodes if n.id == node_id)) == kind


# -- skips ------------------------------------------------------------------------------


def test_an_unresolved_stage_kind_skips_with_its_warning_and_the_run_goes_on():
    bench = Bench()
    _, done = bench.run()
    skipped = next(r for r in done.stages if r.stage_key == "exploit-verify")

    assert (skipped.verdict, skipped.how, skipped.note, skipped.skip_reason) == (
        "skipped",
        "skipped",
        W7,
        W7,
    )
    assert "exploit-verify" not in bench.model.stages_called()
    assert done.status == "complete"
    # The stages after it still ran.
    assert next(r for r in done.stages if r.stage_key == "review").verdict == "ok"


def test_a_stage_with_no_resolution_at_all_is_treated_as_unresolved():
    stages = dict(STAGES)
    del stages["plan"]
    script = happy()
    del script["plan"]
    _, done = Bench(model=ScriptedModel(script)).run(stages=stages)
    plan = next(r for r in done.stages if r.stage_key == "plan")

    assert plan.verdict == "skipped"
    assert plan.skip_reason == (
        "no route resolves for stage `plan` — its task kind or alias is not in the catalog yet"
    )
    assert done.status == "complete"


def test_reviewers_share_a_row_only_when_both_resolved():
    stages = dict(STAGES)
    stages["review-second"] = {
        "alias": None,
        "warnings": ["No alias named `coder-std`."],
    }
    script = happy()
    del script["review-second"]
    _, done = Bench(model=ScriptedModel(script)).run(stages=stages)
    review_rows = [
        (r.stage_key, r.display_name, r.verdict, r.note) for r in done.stages[6:8]
    ]

    assert review_rows == [
        ("review-primary", "review", "ok", "approves · 1 style nit"),
        ("review-second", "review", "skipped", "No alias named `coder-std`."),
    ]


def _branching() -> dict:
    """The seeded draft with the PoC stage behind a branch on the `cve` label."""
    doc = copy.deepcopy(definition())
    doc["edges"] = [e for e in doc["edges"] if e["to"] != "exploit-verify"]
    doc["edges"].append(
        {
            "from": "test",
            "to": "exploit-verify",
            "kind": "branch",
            "label": "has CVE",
            "condition": {"kind": "labels", "op": "any", "values": ["cve"]},
        }
    )
    for reviewer in ("review-primary", "review-second"):
        doc["edges"].append({"from": "test", "to": reviewer, "kind": "default"})
    return doc


def test_a_false_predicate_skips_its_stage_with_the_composed_reason():
    assert validate_workflow_document(_branching()).valid
    stages = dict(STAGES)
    stages["exploit-verify"] = {"alias": "coder-max"}
    bench = Bench()
    _, done = bench.run(definition=_branching(), stages=stages)
    skipped = next(r for r in done.stages if r.stage_key == "exploit-verify")

    assert skipped.verdict == "skipped"
    assert skipped.skip_reason.startswith(
        "the branch from `test` is not taken, because "
    )
    assert "`cve`" in skipped.skip_reason
    assert "exploit-verify" not in bench.model.stages_called()
    assert done.status == "complete"
    assert next(r for r in done.stages if r.stage_key == "review").verdict == "ok"


def test_a_true_predicate_runs_its_stage():
    stages = dict(STAGES)
    stages["exploit-verify"] = {"alias": "coder-max"}
    script = happy()
    script["exploit-verify"] = [result(summary="No PoC to run.")]
    ticket = {
        "external_key": "#489",
        "source": "github",
        "labels": ["security", "cve"],
        "estimate": None,
        "title": "CVE-2026-1234 in the CAN stack",
    }
    bench = Bench(model=ScriptedModel(script))
    _, done = bench.run(definition=_branching(), stages=stages, ticket=ticket)

    assert "exploit-verify" in bench.model.stages_called()
    assert (
        next(r for r in done.stages if r.stage_key == "exploit-verify").verdict == "ok"
    )


def test_a_paths_predicate_is_tested_against_the_simulated_diff():
    doc = copy.deepcopy(definition())
    doc["edges"] = [e for e in doc["edges"] if e["to"] != "exploit-verify"]
    doc["edges"].append(
        {
            "from": "test",
            "to": "exploit-verify",
            "kind": "branch",
            "condition": {"kind": "paths", "op": "any", "globs": ["drivers/can/**"]},
        }
    )
    for reviewer in ("review-primary", "review-second"):
        doc["edges"].append({"from": "test", "to": reviewer, "kind": "default"})
    stages = dict(STAGES)
    stages["exploit-verify"] = {"alias": "coder-max"}

    taken = happy()
    taken["exploit-verify"] = [result(summary="Ran.")]
    bench = Bench(model=ScriptedModel(taken))
    _, done = bench.run(definition=doc, stages=stages)
    assert "exploit-verify" in bench.model.stages_called()

    untouched = happy()
    untouched["implement"] = [result(summary="Nothing to change.")]
    bench = Bench(model=ScriptedModel(untouched))
    _, done = bench.run(definition=doc, stages=stages)
    skipped = next(r for r in done.stages if r.stage_key == "exploit-verify")
    assert skipped.skip_reason == (
        "the branch from `test` is not taken, because no path the simulated diff changes "
        "matches `drivers/can/**`"
    )


def test_deep_evaluate_reads_real_changed_paths_and_none_inverts():
    workspace = VirtualWorkspace(RecordingReader(), ReadCache(), "o/r", "a" * 40)
    ticket = request().ticket
    any_can = PathsPredicate(kind="paths", op="any", globs=["drivers/can/**"])
    none_can = PathsPredicate(kind="paths", op="none", globs=["drivers/can/**"])

    assert deep_evaluate(any_can, ticket, workspace).holds is False
    assert deep_evaluate(none_can, ticket, workspace).holds is True
    workspace.write(ARBITRATION, PATCHED)
    hit = deep_evaluate(any_can, ticket, workspace)
    assert (hit.holds, hit.assumed) == (True, False)
    assert hit.clause == (
        f"the simulated diff changes `{ARBITRATION}`, which matches `drivers/can/**`"
    )
    assert deep_evaluate(none_can, ticket, workspace).holds is False


def test_a_trigger_that_does_not_fire_skips_every_stage_and_calls_nothing():
    bench = Bench()
    ticket = {
        "external_key": "#490",
        "source": "github",
        "labels": ["docs"],
        "estimate": None,
        "title": "Fix a typo",
    }
    _, done = bench.run(ticket=ticket)

    assert done.status == "complete"
    assert bench.model.calls == []
    assert bench.estimates.asked == []
    assert bench.reader.calls == []
    assert {r.verdict for r in done.stages} == {"skipped"}
    assert {r.skip_reason for r in done.stages} == {
        "the trigger does not fire for #490"
    }
    assert done.artifacts == []


# -- budgets ----------------------------------------------------------------------------


def test_a_stage_token_cap_stops_the_run_cleanly_with_partial_results():
    bench = Bench(model=ScriptedModel(tokens={"implement": 60_000}))
    events, done = bench.run(budget={"stage_tokens": 100_000})
    by_key = {r.stage_key: r for r in done.stages}

    assert done.status == "budget_stopped"
    assert done.failure_reason == (
        "stage `implement` stopped: stage token cap reached (120k of 100k tokens)"
    )
    assert (by_key["analyze"].verdict, by_key["plan"].verdict) == ("ok", "ok")
    assert (by_key["implement"].verdict, by_key["implement"].how) == ("failed", "llm")
    assert (
        by_key["implement"].note
        == "stopped: stage token cap reached (120k of 100k tokens)"
    )
    assert by_key["implement"].metrics["tokens"] == 120_000
    for later in ("build", "test", "exploit-verify", "review"):
        assert (by_key[later].verdict, by_key[later].note) == ("not_reached", "")
    assert by_key["open-pr"].verdict == "not_reached"
    # Nothing after the stop was asked of anything: the one estimate is the build *tool*
    # the implementer called before its cap was reached.
    assert bench.estimates.asked == [(DRY_RUN, "build", None, None)]
    assert bench.model.stages_called() == ["analyze", "plan", "implement"]
    assert isinstance(events[-1], DryRunDone)
    assert done.tokens == 124_000


def test_a_stages_own_token_budget_applies_and_the_lower_cap_wins():
    doc = copy.deepcopy(definition())
    next(n for n in doc["nodes"] if n["id"] == "analyze")["config"]["limits"][
        "token_budget"
    ] = 1500
    _, done = Bench().run(definition=doc, budget={"stage_tokens": 100_000})
    analyze = done.stages[0]

    assert done.status == "budget_stopped"
    assert analyze.note == "stopped: stage token cap reached (2k of 2k tokens)"


def test_a_run_token_cap_stops_before_the_next_stage_starts():
    bench = Bench()
    _, done = bench.run(budget={"run_tokens": 4000})
    by_key = {r.stage_key: r for r in done.stages}

    assert done.status == "budget_stopped"
    assert done.failure_reason == "stopped: run token cap reached (4k of 4k tokens)"
    assert (by_key["analyze"].verdict, by_key["plan"].verdict) == ("ok", "ok")
    assert (by_key["implement"].verdict, by_key["implement"].note) == (
        "not_reached",
        "",
    )
    assert bench.model.stages_called() == ["analyze", "plan"]


def test_a_run_cost_cap_is_handed_to_the_gateway_as_what_is_left():
    bench = Bench(model=ScriptedModel(cost={"analyze": 12.5}))
    _, done = bench.run(budget={"run_cost_cents": 50, "stage_cost_cents": 40})
    caps = [c.cost_cap_cents for c in bench.model.calls if c.stage_key == "analyze"]
    plan = next(c for c in bench.model.calls if c.stage_key == "plan")

    # The stage cap is the tighter one for analyze: 40, then 27, then 15 left.
    assert caps == [40, 27, 15]
    # Then the run has 50 - 37.5 = 12.5 left, tighter than a fresh stage's 40.
    assert plan.cost_cap_cents == 12
    assert done.status == "complete"


def test_a_cost_cap_reached_stops_the_run():
    bench = Bench(model=ScriptedModel(cost={"analyze": 30.0}))
    _, done = bench.run(budget={"run_cost_cents": 50})

    assert done.status == "budget_stopped"
    assert done.stages[0].note == "stopped: run cost cap reached ($0.60 of $0.50)"
    assert done.cost_cents == 60


def test_the_gateway_refusing_on_the_cap_is_a_budget_stop_not_a_failure():
    script = happy()
    capped = ModelFailureError("cost_cap_exceeded", "The run's spend cap is spent.")
    script["plan"] = [capped]
    _, done = Bench(model=ScriptedModel(script)).run(budget={"run_cost_cents": 500})
    plan = next(r for r in done.stages if r.stage_key == "plan")

    assert done.status == "budget_stopped"
    assert (plan.verdict, plan.note) == ("failed", "stopped: spend cap reached")


def test_a_zero_cap_stops_before_any_model_is_called():
    bench = Bench()
    _, done = bench.run(budget={"run_tokens": 0})

    assert done.status == "budget_stopped"
    assert bench.model.calls == []
    assert done.stages[0].verdict == "not_reached"
    assert done.tokens == 0
    assert done.cost_cents is None


# -- failures ---------------------------------------------------------------------------


def test_an_unavailable_gateway_fails_the_run_naming_it():
    script = happy()
    script["analyze"] = [
        ModelFailureError("gateway_unavailable", "nothing implements model invocation")
    ]
    bench = Bench(model=ScriptedModel(script))
    _, done = bench.run()

    assert done.status == "failed"
    assert done.failure_reason == (
        "stage `analyze` failed: model call failed: gateway_unavailable"
    )
    assert (done.stages[0].verdict, done.stages[0].how) == ("failed", "llm")
    assert done.stages[0].note == "model call failed: gateway_unavailable"
    assert {r.verdict for r in done.stages[1:]} == {"not_reached"}
    assert done.cost_cents is None
    assert bench.estimates.asked == []


def test_usage_paid_for_before_a_failure_is_still_counted():
    script = happy()
    failed = ModelFailureError(
        "chain_exhausted", "every hop failed", [ScriptedModel().usage("plan", 700)]
    )
    script["plan"] = [failed]
    _, done = Bench(model=ScriptedModel(script)).run()

    assert next(r for r in done.stages if r.stage_key == "plan").metrics == {
        "tokens": 700,
        "cost_cents": 1,
    }
    assert done.tokens == 3700


def test_a_stage_that_never_finishes_is_failed_after_its_turns():
    script = happy()
    script["analyze"] = [tool("list_dir", path="")] * (MAX_ROUNDS + 2)
    bench = Bench(model=ScriptedModel(script))
    _, done = bench.run()

    assert done.status == "failed"
    assert done.stages[0].note == f"did not finish within {MAX_ROUNDS} turns"
    assert len(bench.model.calls) == MAX_ROUNDS


def test_a_reply_with_no_block_is_taken_as_the_stages_summary():
    script = happy()
    script["analyze"] = ["The retry path lives in arbitration.c."]
    _, done = Bench(model=ScriptedModel(script)).run()

    assert done.stages[0].verdict == "ok"
    assert done.stages[0].note == (
        "completed · 1k tokens · skill advisory-db skipped (not defined yet)"
    )


def test_a_malformed_tool_block_is_told_to_the_model_not_dropped():
    seen = {}

    def retry(call):
        seen["told"] = call.messages[-1]["content"]
        return result(summary="Done.")

    script = happy()
    script["analyze"] = ["```tool\n{not json\n```", retry]
    Bench(model=ScriptedModel(script)).run()

    assert seen["told"] == "[tool block] The tool block was not valid JSON."


def test_unpriced_calls_leave_cost_absent_never_zero():
    stages = ("analyze", "plan", "implement", "review-primary", "review-second")
    _, done = Bench(model=ScriptedModel(cost=dict.fromkeys(stages))).run()

    assert done.cost_cents is None
    assert all("cost_cents" not in r.metrics for r in done.stages)
    assert done.tokens == 10000


def test_a_definition_that_does_not_validate_answers_its_findings_and_runs_nothing():
    bench = Bench()
    doc = definition()
    doc["nodes"][1]["type"] = "robot"
    events, done = bench.run(definition=doc)

    assert len(events) == 1
    assert done.status == "failed"
    assert done.failure_reason == "the workflow definition does not validate"
    assert done.findings
    assert done.stages == []
    assert bench.model.calls == []
    assert bench.repositories == []


def test_a_large_diff_is_cut_at_a_line_and_says_so():
    big = "".join(f"line {n} of a very large generated file\n" for n in range(4000))
    script = happy()
    script["implement"] = [
        tool("edit_file", path="gen/table.c", content=big),
        result(summary="Generated."),
    ]
    _, done = Bench(model=ScriptedModel(script)).run()
    diff = next(a for a in done.artifacts if a.kind == "overlay_diff")

    assert diff.truncated is True
    assert diff.original_bytes > MAX_ARTIFACT_BYTES
    assert len(diff.content.encode()) <= MAX_ARTIFACT_BYTES
    assert diff.content.endswith("\n")
    assert [(p.path, p.added) for p in diff.path_summary] == [("gen/table.c", 4000)]


# -- order ------------------------------------------------------------------------------


def test_stages_are_ordered_after_everything_that_leads_to_them():
    document = validate_workflow_document(definition()).document

    assert [node.id for node in stage_order(document)] == [
        "trigger",
        "analyze",
        "plan",
        "implement",
        "build",
        "test",
        "exploit-verify",
        "review-primary",
        "review-second",
        "open-pr",
    ]
