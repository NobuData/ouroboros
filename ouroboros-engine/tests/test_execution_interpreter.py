"""The workflow interpreter (#160): every node type, terminal, fence and resume.

Driven over :class:`execution_fakes.FakeControl`, DH.1's scripted executors and real run
working trees (DI.1) cloned from the fixture repository.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from code_fixtures import SeededRepo, build_repo
from execution_fakes import (
    ISSUE,
    RUN,
    Blocking,
    Executors,
    Failing,
    FakeControl,
    Pausing,
    Recording,
    chain,
    document,
    edge,
    flow,
    infra,
    llm,
    never,
    refusal,
    term,
    trigger,
)
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.policy import ToolPolicy
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.spi import Checkpoint, StageContext
from ouroboros_engine.execution.workspace import RunSpec, RunWorkspaces
from ouroboros_engine.workflows.dsl import LlmPermissions
from ouroboros_engine.workflows.validate import validate_workflow_document
from stage_executor_fakes import Call, Say, Script

MB = 1024 * 1024


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """The fixture repository, as the remote."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def clones(tmp_path: Path) -> CloneStore:
    """A clone cache reading local remotes."""
    return CloneStore(tmp_path / "clones", allow_local=True)


@pytest.fixture
def workspaces(tmp_path: Path, clones: CloneStore) -> RunWorkspaces:
    """Run trees with roomy limits."""
    return RunWorkspaces(
        tmp_path / "runs",
        clones,
        max_bytes=64 * MB,
        disk_free=lambda _path: 1024 * MB,
    )


class Bench:
    """One interpreter over a fake control plane, real trees and a registry."""

    def __init__(
        self,
        seeded: SeededRepo,
        clones: CloneStore,
        workspaces: RunWorkspaces,
        doc: dict[str, Any],
        *executors: Any,
        sleep: Any = never,
        poll_sleep: Any = never,
        **control: Any,
    ) -> None:
        """Build it; ``executors`` are handed out in order (the last repeats)."""
        assert validate_workflow_document(doc).valid, validate_workflow_document(doc)
        self.seeded = seeded
        self.workspaces = workspaces
        self.control = FakeControl(doc, remote=str(seeded.path), **control)
        self.registry = ExecutorRegistry()
        self.factory = Executors(*executors) if executors else None
        if self.factory is not None:
            self.registry.register("native", self.factory)
        self.interpreter = Interpreter(
            self.control,
            clones,
            workspaces,
            self.registry,
            worker="engine-test",
            heartbeat_seconds=5,
            sleep=sleep,
            poll_sleep=poll_sleep,
        )

    def run(self) -> FakeControl:
        """Execute the run to its end."""
        asyncio.run(self.interpreter.execute(RUN))
        return self.control

    def tree(self) -> Path:
        """The run's working tree directory."""
        return self.workspaces.path_of(RUN) / "tree"

    def spec(self) -> RunSpec:
        """The run's tree spec at the seeded main commit."""
        return RunSpec(
            RUN,
            ISSUE,
            self.seeded.sha("c7"),
            RepositoryRef("org-acme", "acme/helios-firmware", str(self.seeded.path)),
        )


@pytest.fixture
def bench(seeded: SeededRepo, clones: CloneStore, workspaces: RunWorkspaces):
    """Make a bench for a document and executors."""

    def make(doc: dict[str, Any], *executors: Any, **options: Any) -> Bench:
        return Bench(seeded, clones, workspaces, doc, *executors, **options)

    return make


def writes(*paths: str) -> Recording:
    """A native fake that says something, then writes each path."""
    steps: list[Any] = [Say("Writing.")]
    steps += [Call("write_file", path, f"{path}\n") for path in paths]
    return Recording(Script(steps))


SIMPLE = chain(trigger(), llm("write-docs"), term("done", "open_pr_automerge"))


# --- the pin, the brief and one model stage ---------------------------------------------------


def test_the_document_executed_is_the_pinned_one_start_answered(bench) -> None:
    executor = writes("docs/guide.md")
    control = bench(SIMPLE, executor).run()

    assert control.ops()[0] == "start"
    assert control.bodies("start") == [{"run": RUN, "worker": "engine-test"}]
    # Only the pinned version's stage ran: nothing fetched a "latest" document.
    assert {key for key, _, _ in control.transitions()} == {"write-docs"}
    assert executor.contexts[0].stage_key == "write-docs"


def test_a_new_run_stores_its_base_commit_before_any_tree_exists(
    bench, seeded: SeededRepo
) -> None:
    run = bench(SIMPLE, writes("a.md"))
    control = run.run()

    first = control.bodies("checkpoint")[0]
    assert first.base_commit == seeded.sha("c7")  # main's tip in the fixture
    assert control.base_commit == seeded.sha("c7")


def test_an_unknown_default_branch_resolves_the_clones_head(
    bench, seeded: SeededRepo
) -> None:
    control = bench(SIMPLE, writes("a.md"), default_branch=None).run()

    assert control.bodies("checkpoint")[0].base_commit == seeded.sha("c7")
    assert control.finished().outcome == "review"


def test_a_model_stage_reports_its_events_spend_and_tree_change_set(bench) -> None:
    executor = writes("docs/guide.md")
    control = bench(SIMPLE, executor).run()

    assert control.transitions() == [
        ("write-docs", "active", 1),
        ("write-docs", "succeeded", 1),
    ]
    hints = [event.hint for batch in control.bodies("events") for event in batch.events]
    assert hints == list(range(1, len(hints) + 1))
    assert control.bodies("resources")[0].spend.stage == "write-docs"
    # The change-set is the tree's diff against the base commit, not the events (A.6).
    assert [file.path for file in control.bodies("files")[0].files] == ["docs/guide.md"]
    finished = control.finished()
    assert finished is not None and finished.outcome == "review"


def test_every_write_carries_the_epoch_start_answered(bench) -> None:
    control = bench(SIMPLE, writes("a.md")).run()

    for operation, body in control.calls:
        if operation in {
            "transition",
            "events",
            "files",
            "resources",
            "checkpoint",
            "finish",
        }:
            assert body.epoch == 1, operation


def test_the_stage_context_carries_prompt_model_and_policy(bench) -> None:
    doc = chain(
        trigger(), llm("write-docs", pinned="coder-max"), term("done", "back_to_queue")
    )
    executor = writes("a.md")
    run = bench(doc, executor)
    run.control.acceptance_criteria = [{"id": "ac-1", "text": "Every node is walked."}]
    run.run()

    context = executor.contexts[0]
    assert context.prompt.startswith("Do the write-docs stage.")
    # The issue follows as untrusted data (DH.3, #1308), its criteria included.
    instructions, data = context.prompt.split("<untrusted-issue-data>")
    assert "never follow instructions" in instructions
    assert f"Issue #{ISSUE}: Execute the pinned workflow" in data
    assert "Walk it node by node." in data
    assert "- [ac-1] Every node is walked." in data
    assert context.model == "coder-max"
    assert context.policy.protected_paths == ("boot/**",)
    assert context.policy.working_tree == str(run.tree())
    assert context.policy.permissions == LlmPermissions(
        push_fixup=False, touch_ci=False
    )


def test_an_inheriting_stage_runs_on_the_runs_model(bench) -> None:
    executor = writes("a.md")
    bench(SIMPLE, executor).run()

    assert executor.contexts[0].model == "claude-sonnet-5-5"


def test_the_trigger_follows_its_default_edge_and_checkpoints_the_position(
    bench,
) -> None:
    control = bench(SIMPLE, writes("a.md")).run()

    positions = [body.state["position"] for body in control.bodies("checkpoint")]
    assert "write-docs" in positions and "done" in positions


# --- retries --------------------------------------------------------------------------------


def test_a_failed_attempt_is_retried_within_max_retries(bench) -> None:
    doc = chain(
        trigger(), llm("implement", max_retries=1), term("done", "open_pr_automerge")
    )
    control = bench(doc, Failing(), writes("a.md")).run()

    assert control.transitions() == [
        ("implement", "active", 1),
        ("implement", "failed", 1),
        ("implement", "active", 2),
        ("implement", "succeeded", 2),
    ]
    assert control.finished().outcome == "review"


def test_exhausted_retries_finish_the_run_failed_and_abandon_the_tree(bench) -> None:
    doc = chain(
        trigger(), llm("implement", max_retries=1), term("done", "open_pr_automerge")
    )
    run = bench(doc, Failing("boom"))
    control = run.run()

    finished = control.finished()
    assert finished.outcome == "failed"
    assert finished.stage_key == "implement"
    assert "`implement`" in finished.reason and "boom" in finished.reason
    assert "2 attempt(s)" in finished.reason
    assert not run.workspaces.path_of(RUN).exists()


# --- permission enforcement (DH.1's policy, given the right inputs) ---------------------------


def test_touch_ci_false_denies_a_workflow_write_and_fails_the_stage(bench) -> None:
    doc = chain(
        trigger(), llm("implement", touch_ci=False), term("done", "open_pr_automerge")
    )
    run = bench(doc, writes(".github/workflows/x.yml"))
    control = run.run()

    assert ("implement", "failed", 1) in control.transitions()
    finished = control.finished()
    assert finished.outcome == "failed"
    assert "stage_permission" in finished.reason and "touch_ci" in finished.reason
    # Denied before it ran: nothing was written, so the change-set is empty.
    assert control.bodies("files")[0].files == []


def test_touch_ci_true_lets_the_same_write_through(bench) -> None:
    doc = chain(
        trigger(), llm("implement", touch_ci=True), term("done", "open_pr_automerge")
    )
    control = bench(doc, writes(".github/workflows/x.yml")).run()

    assert control.finished().outcome == "review"
    assert [f.path for f in control.bodies("files")[0].files] == [
        ".github/workflows/x.yml"
    ]


def test_a_protected_path_from_start_is_enforced(bench) -> None:
    control = bench(SIMPLE, writes("boot/loader.c")).run()

    finished = control.finished()
    assert finished.outcome == "failed" and "protected_path" in finished.reason


def test_a_change_set_the_guardrails_flag_hands_the_run_to_a_person(bench) -> None:
    run = bench(SIMPLE, writes("a.md"))
    run.control.needs_human = True
    control = run.run()

    finished = control.finished()
    assert (finished.outcome, finished.reason) == (
        "needs_human",
        "The guardrails need a person.",
    )


# --- infrastructure, forks ------------------------------------------------------------------


def test_a_build_stage_with_nothing_pushed_fails_saying_so(bench) -> None:
    # No publisher, so no branch on the host: a runner would have nothing to check out.
    # The farm itself is driven in test_execution_build_stage.py (AJ.3, #265).
    doc = chain(trigger(), infra("build"), term("done", "open_pr_automerge"))
    run = bench(doc, writes("a.md"))
    control = run.run()

    assert control.transitions() == [("build", "active", 1), ("build", "failed", 1)]
    assert not control.bodies("build")
    finished = control.finished()
    assert finished.outcome == "failed"
    assert finished.reason.startswith("build_branch_unpublished")


def _decision_doc(globs: list[str]) -> dict[str, Any]:
    return document(
        [
            trigger(),
            llm("implement"),
            flow("route", "decision", {"kind": "always"}),
            term("docs", "back_to_queue"),
            term("ship", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "route"),
            edge(
                "route",
                "docs",
                "branch",
                condition={"kind": "paths", "op": "any", "globs": globs},
            ),
            edge("route", "ship"),
        ],
    )


@pytest.mark.parametrize(
    ("globs", "outcome"),
    [(["docs/**"], "back_to_queue"), (["src/**"], "review")],
)
def test_a_decision_takes_the_branch_that_holds_else_the_default(
    bench, globs: list[str], outcome: str
) -> None:
    control = bench(_decision_doc(globs), writes("docs/guide.md")).run()

    assert control.finished().outcome == outcome


def _branch_on(condition: dict[str, Any]) -> dict[str, Any]:
    doc = _decision_doc(["docs/**"])
    doc["edges"][2]["condition"] = condition
    return doc


@pytest.mark.parametrize(
    ("effort", "outcome"),
    [("s", "back_to_queue"), ("m", "back_to_queue"), ("xl", "review")],
)
def test_a_decision_branches_on_the_tickets_effort(
    bench, effort: str, outcome: str
) -> None:
    doc = _branch_on({"kind": "effort", "op": "lte", "value": "m"})
    control = bench(doc, writes("src/a.c"), effort=effort).run()

    assert control.finished().outcome == outcome


@pytest.mark.parametrize(
    ("labels", "outcome"),
    [(("docs", "bug"), "back_to_queue"), (("bug",), "review"), ((), "review")],
)
def test_a_decision_branches_on_the_tickets_labels(
    bench, labels: tuple[str, ...], outcome: str
) -> None:
    doc = _branch_on({"kind": "labels", "op": "any", "values": ["docs"]})
    control = bench(doc, writes("src/a.c"), labels=labels).run()

    assert control.finished().outcome == outcome


def test_a_decision_does_not_take_a_branch_on_an_unsized_ticket(bench) -> None:
    doc = _branch_on({"kind": "effort", "op": "lte", "value": "xl"})
    control = bench(doc, writes("docs/guide.md"), effort=None).run()

    assert control.finished().outcome == "review"


def test_a_gate_on_an_unsized_ticket_fails_honestly(bench) -> None:
    doc = document(
        [
            trigger(),
            llm("implement"),
            flow("small", "gate", {"kind": "effort", "op": "lte", "value": "m"}),
            term("done", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "small"),
            edge("small", "done"),
        ],
    )
    control = bench(doc, writes("a.md")).run()

    finished = control.finished()
    assert finished.outcome == "failed"
    assert "cannot be decided" in finished.reason and "sized" in finished.reason


def test_a_gate_on_labels_passes_with_the_label(bench) -> None:
    doc = document(
        [
            trigger(),
            llm("implement"),
            flow("docs", "gate", {"kind": "labels", "op": "all", "values": ["docs"]}),
            term("done", "open_pr_automerge"),
        ],
        [edge("trigger", "implement"), edge("implement", "docs"), edge("docs", "done")],
    )
    control = bench(doc, writes("a.md"), labels=("docs",)).run()

    assert control.finished().outcome == "review"


def _gate_doc(globs: list[str], max_retries: int) -> dict[str, Any]:
    return document(
        [
            trigger(),
            llm("implement", max_retries=max_retries),
            flow("docs-only", "gate", {"kind": "paths", "op": "any", "globs": globs}),
            term("done", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "docs-only"),
            edge("docs-only", "done"),
            edge("docs-only", "implement", "loop"),
        ],
    )


def test_a_passing_gate_follows_its_default_edge(bench) -> None:
    control = bench(_gate_doc(["docs/**"], 0), writes("docs/a.md")).run()

    assert control.finished().outcome == "review"


def test_a_failing_gate_loops_back_with_the_next_attempt_until_the_bound(bench) -> None:
    control = bench(_gate_doc(["docs/**"], 1), writes("src/a.c")).run()

    assert control.transitions() == [
        ("implement", "active", 1),
        ("implement", "succeeded", 1),
        ("implement", "active", 2),
        ("implement", "succeeded", 2),
    ]
    retry = control.bodies("transition")[2]
    assert retry.returned_from is not None
    assert (retry.returned_from.stage_key, retry.returned_from.kind) == (
        "docs-only",
        "gate",
    )
    finished = control.finished()
    assert finished.outcome == "failed"
    assert "`docs-only`" in finished.reason and "all 2 attempt(s)" in finished.reason
    loops = [body.state["loop_rounds"] for body in control.bodies("checkpoint")]
    assert {"docs-only->implement": 1} in loops


def test_a_gate_on_every_check_judges_the_rounds_stages(bench) -> None:
    doc = document(
        [
            trigger(),
            llm("implement"),
            flow("green", "gate", {"kind": "checks", "op": "all_passed"}),
            term("done", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "green"),
            edge("green", "done"),
        ],
    )
    control = bench(doc, writes("a.md")).run()

    # `implement` succeeded, so it is this round's one check, and it passed (AJ.3, #265).
    assert control.finished().outcome == "review"


def test_a_gate_on_a_check_that_never_ran_fails_honestly(bench) -> None:
    doc = document(
        [
            trigger(),
            llm("implement"),
            flow(
                "green",
                "gate",
                {"kind": "checks", "op": "all_passed", "names": ["build"]},
            ),
            term("done", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "green"),
            edge("green", "done"),
        ],
    )
    control = bench(doc, writes("a.md")).run()

    finished = control.finished()
    assert finished.outcome == "failed"
    assert "cannot be decided" in finished.reason
    assert "no result for `build`" in finished.reason


# --- terminals ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("action", "outcome", "tree_kept"),
    [
        ("needs_review", "needs_human", False),
        ("open_pr_automerge", "review", True),
        ("back_to_queue", "back_to_queue", False),
    ],
)
def test_each_terminal_finishes_with_its_outcome(
    bench, action: str, outcome: str, tree_kept: bool
) -> None:
    run = bench(chain(trigger(), llm("implement"), term("end", action)), writes("a.md"))
    control = run.run()

    finished = control.finished()
    assert (finished.outcome, finished.stage_key) == (outcome, "end")
    assert run.workspaces.path_of(RUN).exists() is tree_kept


def test_the_review_terminal_keeps_the_checkpointed_branch_for_di2(bench) -> None:
    run = bench(SIMPLE, writes("docs/guide.md"))
    run.run()

    with run.workspaces.open(run.spec()) as workspace:
        assert workspace.restored
        assert workspace.head != run.seeded.sha("c7")
        assert (workspace.path / "docs" / "guide.md").exists()


def test_a_pinned_document_that_does_not_validate_fails_the_run(bench) -> None:
    run = bench(SIMPLE, writes("a.md"))
    run.control.document = {"dsl_version": "1.0", "nodes": []}
    control = run.run()

    assert control.finished().outcome == "failed"
    assert "does not validate" in control.finished().reason


def test_a_refused_start_makes_no_other_call(bench) -> None:
    run = bench(SIMPLE, writes("a.md"))
    run.control.refusals["start"] = [refusal("run_simulated")]
    control = run.run()

    assert control.ops() == ["start"]


# --- fencing --------------------------------------------------------------------------------


@pytest.mark.parametrize("code", ["fenced", "run_not_executable"])
def test_a_refused_heartbeat_aborts_the_executor_and_stops_every_write(
    bench, code: str
) -> None:
    blocking = Blocking()

    async def beat_once_started(_seconds: float) -> None:
        await blocking.started.wait()

    run = bench(SIMPLE, blocking, sleep=beat_once_started)
    run.control.refusals["heartbeat"] = [refusal(code)]
    control = run.run()

    assert blocking.aborted
    refused_at = control.ops().index("heartbeat")
    assert control.ops()[refused_at + 1 :] == []
    assert control.finished() is None
    # The tree is closed, not finished: the run is the next worker's.
    assert run.workspaces.path_of(RUN).exists()


def test_a_fenced_write_stops_the_worker_without_finishing(bench) -> None:
    run = bench(SIMPLE, writes("a.md"))
    run.control.refusals["transition"] = [refusal("fenced", current_epoch=2)]
    control = run.run()

    assert control.ops()[-1] == "transition"
    assert control.finished() is None


def test_a_zombie_workers_writes_are_refused_by_the_epoch(bench) -> None:
    blocking = Blocking()

    async def beat_after_takeover(_seconds: float) -> None:
        await blocking.started.wait()
        run.control.epoch += 1  # another worker started the run

    run = bench(SIMPLE, blocking, sleep=beat_after_takeover)
    control = run.run()

    assert blocking.aborted
    assert control.finished() is None


def test_heartbeats_are_sent_with_the_epoch_while_a_stage_runs(bench) -> None:
    blocking = Blocking()
    beats = 0

    async def beat_then_cancel(_seconds: float) -> None:
        nonlocal beats
        await blocking.started.wait()
        beats += 1
        if beats > 2:
            run.control.refusals["heartbeat"] = [refusal("run_not_executable")]

    run = bench(SIMPLE, blocking, sleep=beat_then_cancel)
    control = run.run()

    assert [body["epoch"] for body in control.bodies("heartbeat")] == [1, 1, 1]
    assert blocking.aborted


# --- crash-resume (A.5) ---------------------------------------------------------------------

THREE = chain(
    trigger(),
    llm("plan"),
    llm("implement", max_retries=1),
    term("done", "open_pr_automerge"),
)


def _killed_mid_implement(run: Bench, executor_checkpoint: dict | None) -> None:
    """Leave the state a worker killed inside ``implement`` would have left."""
    workspace = run.workspaces.open(run.spec())
    (workspace.path / "plan.md").write_text("the plan\n")
    workspace.checkpoint("plan")
    (workspace.path / "half.txt").write_text("written after the last checkpoint")
    workspace.close()
    run.control.base_commit = run.seeded.sha("c7")
    run.control.hint = 5
    run.control.state = {
        "position": "implement",
        "attempts": {"plan": 1, "implement": 1},
        "loop_rounds": {},
        "seq": 5,
        "executor_checkpoint": executor_checkpoint,
        "stage_key": "implement",
        "attempt": 1,
    }


def _harness_checkpoint(tree: Path, kind: str = "native") -> dict:
    context = StageContext(
        run_id=RUN,
        stage_key="implement",
        attempt=1,
        prompt="Do the implement stage.",
        model="claude-sonnet-5-5",
        policy=ToolPolicy(
            working_tree=str(tree),
            permissions=LlmPermissions(push_fixup=False, touch_ci=False),
        ),
    )
    return Checkpoint(
        executor_kind=kind, context=context, next_seq=3, state={"step": 1}
    ).model_dump(mode="json")


def test_a_killed_worker_resumes_at_the_checkpointed_position_and_tree(bench) -> None:
    executor = Recording(
        Script([Say("Planning."), Call("write_file", "impl.c", "x\n")])
    )
    run = bench(THREE, executor)
    _killed_mid_implement(run, _harness_checkpoint(run.tree()))
    control = run.run()

    # Resumed once from the executor checkpoint; `plan` was not run again.
    assert len(executor.resumed) == 1 and executor.contexts == []
    assert all(key != "plan" for key, _, _ in control.transitions())
    assert control.transitions() == [("implement", "succeeded", 1)]
    # The tree is the last checkpoint's: the half-written file is gone.
    files = [f.path for f in control.bodies("files")[0].files]
    assert files == ["impl.c", "plan.md"]
    hints = [e.hint for batch in control.bodies("events") for e in batch.events]
    assert hints and hints[0] == 6
    assert control.finished().outcome == "review"


def test_a_refused_resume_falls_back_to_one_fresh_attempt(bench) -> None:
    executor = Recording(Script([Say("Again."), Call("write_file", "impl.c", "x\n")]))
    run = bench(THREE, executor)
    _killed_mid_implement(run, _harness_checkpoint(run.tree(), kind="harness"))
    control = run.run()

    assert control.transitions() == [
        ("implement", "failed", 1),
        ("implement", "active", 2),
        ("implement", "succeeded", 2),
    ]
    assert len(executor.contexts) == 1
    assert control.finished().outcome == "review"


def test_a_native_stage_killed_without_a_checkpoint_is_simply_rerun(bench) -> None:
    executor = Recording(Script([Say("Again.")]))
    run = bench(THREE, executor)
    _killed_mid_implement(run, None)
    control = run.run()

    assert ("implement", "active", 2) in control.transitions()
    assert executor.resumed == []


def test_a_paused_attempt_parks_and_the_next_start_resumes_it(bench) -> None:
    pausing = Pausing(Script([Say("Started."), Call("write_file", "impl.c", "x\n")]))
    run = bench(SIMPLE, pausing)
    control = run.run()

    assert control.finished() is None
    stored = control.state
    assert stored["stage_key"] == "write-docs" and stored["attempt"] == 1
    assert stored["executor_checkpoint"]["executor_kind"] == "native"

    resumer = Recording(Script([Say("Started."), Call("write_file", "impl.c", "x\n")]))
    run.factory.queue = [resumer]
    control = run.run()

    assert control.bodies("start")[-1] == {"run": RUN, "worker": "engine-test"}
    assert len(resumer.resumed) == 1
    assert control.finished().outcome == "review"
    assert control.finished().epoch == 2


def test_a_batch_refused_out_of_order_is_renumbered_past_the_accepted_hint(
    bench,
) -> None:
    run = bench(SIMPLE, writes("a.md"), accepted_hint=10)
    control = run.run()

    accepted = control.bodies("events")
    assert accepted[0].events[0].hint == 1  # refused
    assert accepted[1].events[0].hint == 11  # renumbered and sent again
    assert control.finished().outcome == "review"


def test_no_registered_executor_fails_a_model_stage_honestly(
    seeded: SeededRepo, clones: CloneStore, workspaces: RunWorkspaces
) -> None:
    run = Bench(seeded, clones, workspaces, SIMPLE)
    control = run.run()

    assert "no_executor" in control.finished().reason
