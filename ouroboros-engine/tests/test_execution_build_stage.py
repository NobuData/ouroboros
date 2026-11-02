"""A workflow's build stage on the farm (AJ.3, #265) — real lifecycle, real exit code, the loop.

Driven over :class:`execution_fakes.FakeControl`, whose farm answers each submission with a
scripted round of job reads, a real run working tree and the branch publisher pushing to the
fixture repository — so the commit a build is submitted with is the one the host holds.
"""

from __future__ import annotations

import asyncio
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from code_fixtures import SeededRepo, build_repo
from execution_fakes import (
    FAILING_BUILD,
    ISSUE,
    PASSING_BUILD,
    RUN,
    Executors,
    FakeControl,
    Recording,
    document,
    edge,
    farm_job,
    flow,
    infra,
    instant,
    llm,
    never,
    term,
    trigger,
)
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.execution.build import BuildSettings
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.publisher import (
    CommitIdentity,
    DulwichPushTransport,
    Publisher,
)
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.workspace import RunWorkspaces
from ouroboros_engine.workflows.validate import validate_workflow_document
from stage_executor_fakes import Call, Say, Script

TARGET = f"refs/heads/ouro/run-{RUN}-{ISSUE}".encode()
IDENTITY = CommitIdentity(name="Ouroboros", email="loop@ouroboros.invalid")


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """The fixture repository — the run's remote, and the host it pushes to."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def workspaces(tmp_path: Path) -> RunWorkspaces:
    """Run trees with roomy limits."""
    return RunWorkspaces(
        tmp_path / "runs",
        CloneStore(tmp_path / "clones", allow_local=True),
        max_bytes=64 * 1024 * 1024,
        idle_seconds=3600.0,
        disk_free=lambda _path: 1024 * 1024 * 1024,
    )


def writes(*paths: str) -> Recording:
    """A native fake that writes each path."""
    steps: list[Any] = [Say("Writing.")]
    steps += [Call("write_file", path, f"{path}\n") for path in paths]
    return Recording(Script(steps))


def loop_doc(
    *,
    max_retries: int = 1,
    build: dict[str, Any] | None = None,
    require: list[str] | None = None,
    between: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """``implement → build → [between…] → checks-green → done``, ``onFail: implement``."""
    middle = between or []
    nodes = [
        trigger(),
        llm("implement", max_retries=max_retries),
        build or infra("build"),
        *middle,
        flow(
            "checks-green",
            "gate",
            {"kind": "checks", "op": "all_passed", "names": require or ["build"]},
        ),
        term("done", "open_pr_automerge"),
    ]
    chain_ids = ["trigger", "implement", "build", *(n["id"] for n in middle)]
    edges = [edge(a, b) for a, b in pairwise(chain_ids)]
    edges += [
        edge(chain_ids[-1], "checks-green"),
        edge("checks-green", "done"),
        edge("checks-green", "implement", "loop"),
    ]
    return document(nodes, edges)


def run(
    seeded: SeededRepo,
    workspaces: RunWorkspaces,
    doc: dict[str, Any],
    *executors: Any,
    rounds: list[list[dict[str, Any]]] | None = None,
    settings: BuildSettings | None = None,
    setup: Any = None,
) -> FakeControl:
    """Execute one run to its end, with a publisher over the fixture host."""
    assert validate_workflow_document(doc).valid, validate_workflow_document(doc)
    control = FakeControl(doc, remote=str(seeded.path))
    if rounds is not None:
        control.build_rounds = rounds
    if setup is not None:
        setup(control)
    registry = ExecutorRegistry()
    registry.register("native", Executors(*(executors or (writes("src/ota.c"),))))
    engine = Interpreter(
        control,
        workspaces.clones,
        workspaces,
        registry,
        worker="engine-test",
        heartbeat_seconds=5,
        sleep=never,
        poll_sleep=never,
        build_sleep=instant,
        publisher=Publisher(IDENTITY, DulwichPushTransport(allow_local=True)),
        build=settings,
    )
    asyncio.run(engine.execute(RUN))
    return control


def notes(control: FakeControl) -> list[str]:
    """Every transcript entry's text, in order."""
    return [
        event.body
        for body in control.bodies("events")
        for event in body.events
        if event.body is not None
    ]


def host_head(seeded: SeededRepo) -> str:
    """Where the run branch points on the host."""
    from dulwich.repo import Repo

    with Repo(str(seeded.path)) as repo:
        return repo.refs[TARGET].decode()


# --- a passing build ------------------------------------------------------------------------


def test_a_build_runs_on_the_farm_at_the_pushed_commit_and_the_gate_passes(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc())

    submitted = control.bodies("build")
    assert len(submitted) == 1
    body = submitted[0]
    assert (body.stage_key, body.attempt, body.pool) == ("build", 1, "pool-a")
    assert body.command is None, "no command: the pool's default"
    assert body.commit == host_head(seeded), "the runner builds what the host holds"
    assert body.epoch == 1
    assert ("build", "succeeded", 1) in control.transitions()
    assert control.finished().outcome == "review"


def test_stage_progress_is_the_jobs_real_lifecycle(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc())

    said = notes(control)
    assert "Build #483 was offered to forge-02." in said
    assert "Build #483 is running on forge-02." in said
    assert "Build #483 passed on forge-02 (exit 0 · ccache 78.4%)." in said
    assert said.index("Build #483 was offered to forge-02.") < said.index(
        "Build #483 is running on forge-02."
    )
    build = [t for t in control.transitions() if t[0] == "build"]
    assert build == [("build", "active", 1), ("build", "succeeded", 1)], (
        "active while the job lives, then its verdict — never a generic spinner state"
    )


def test_a_progress_entry_names_the_job_so_the_console_can_link_its_log(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc())

    payloads = [
        event.payload
        for body in control.bodies("events")
        for event in body.events
        if event.payload and event.payload.get("kind") == "build"
    ]
    assert payloads[-1] == {
        "kind": "build",
        "job_id": "5eed0028-0000-4000-8000-000000000483",
        "job_number": 483,
        "phase": "succeeded",
        "pool": "pool-a",
        "runner": "forge-02",
        "exit_code": 0,
        "ccache_hit_rate_pct": 78.4,
    }


def test_the_gate_reports_the_exit_code_and_ccache_it_decided_on(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc())

    assert (
        "Gate `checks-green` passed: `build` passed (build #483, exit 0, ccache 78.4%)."
        in notes(control)
    )
    gate = next(
        event
        for body in control.bodies("events")
        for event in body.events
        if event.actor == "gate"
    )
    assert gate.payload["checks"]["build"] == {
        "passed": True,
        "failure": None,
        "exit_code": 0,
        "job_number": 483,
        "ccache_hit_rate_pct": 78.4,
    }


def test_the_stage_command_is_split_into_argv(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = loop_doc(build=infra("build", command="west build -b 'helios mainboard' app"))
    control = run(seeded, workspaces, doc)

    assert control.bodies("build")[0].command == [
        "west",
        "build",
        "-b",
        "helios mainboard",
        "app",
    ]


def test_a_waiting_job_a_runner_could_take_is_waited_for(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    waiting = farm_job("waiting", queueState="queued_runner_available")
    rounds = [[waiting, waiting, waiting, *PASSING_BUILD]]
    control = run(
        seeded,
        workspaces,
        loop_doc(),
        rounds=rounds,
        settings=BuildSettings(poll_seconds=5, no_runner_grace_seconds=5),
    )

    assert control.finished().outcome == "review"
    assert not control.bodies("cancel_build")
    assert "Build #483 is waiting for a runner in pool `pool-a`." in notes(control)


# --- a failing build: the ouroboros edge ----------------------------------------------------


def test_a_failing_build_loops_back_to_implement_per_the_gate(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(
        seeded,
        workspaces,
        loop_doc(max_retries=1),
        writes("src/ota.c"),
        writes("src/ota_fix.c"),
        rounds=[FAILING_BUILD, PASSING_BUILD],
    )

    assert control.transitions() == [
        ("implement", "active", 1),
        ("implement", "succeeded", 1),
        ("build", "active", 1),
        ("build", "failed", 1),
        ("implement", "active", 2),
        ("implement", "succeeded", 2),
        ("build", "active", 2),
        ("build", "succeeded", 2),
    ]
    retry = control.bodies("transition")[4]
    assert retry.returned_from is not None
    assert (retry.returned_from.stage_key, retry.returned_from.reason) == (
        "checks-green",
        "failed_build",
    )
    assert [body.attempt for body in control.bodies("build")] == [1, 2]
    assert control.finished().outcome == "review", "the second round's build decides"
    assert (
        "Gate `checks-green` did not pass: `build` failed (build #483, exit 2, ccache "
        "78.4%)." in notes(control)
    )


def test_a_failed_build_skips_the_stages_before_its_gate(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = loop_doc(require=["build", "review"], between=[llm("review")])
    control = run(
        seeded,
        workspaces,
        doc,
        writes("src/ota.c"),
        writes("docs/review.md"),
        writes("src/ota_fix.c"),
        writes("docs/review2.md"),
        rounds=[FAILING_BUILD, PASSING_BUILD],
    )

    reviews = [t for t in control.transitions() if t[0] == "review"]
    assert reviews == [("review", "active", 1), ("review", "succeeded", 1)], (
        "review is not run on a tree that does not build — only in the round that built"
    )
    assert control.finished().outcome == "review"


def test_a_failing_build_ends_the_run_when_implement_has_no_attempts_left(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc(max_retries=0), rounds=[FAILING_BUILD])

    finished = control.finished()
    assert finished.outcome == "failed"
    assert "`checks-green` did not pass" in finished.reason
    assert "all 1 attempt(s)" in finished.reason


def test_a_failing_build_no_gate_decides_on_ends_the_run_saying_so(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = document(
        [
            trigger(),
            llm("implement"),
            infra("build"),
            term("done", "open_pr_automerge"),
        ],
        [
            edge("trigger", "implement"),
            edge("implement", "build"),
            edge("build", "done"),
        ],
    )
    control = run(seeded, workspaces, doc, rounds=[FAILING_BUILD])

    finished = control.finished()
    assert finished.outcome == "failed"
    assert finished.reason == (
        "Build #483 of `build` failed (exit 2), and no gate after it decides on its result."
    )


def test_a_failed_test_stage_returns_as_failed_tests(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = loop_doc(build=infra("test"), require=["test"])
    doc["edges"] = [
        {**e, "from": "test"} if e["from"] == "build" else e for e in doc["edges"]
    ]
    doc["edges"] = [
        {**e, "to": "test"} if e["to"] == "build" else e for e in doc["edges"]
    ]
    control = run(
        seeded,
        workspaces,
        doc,
        writes("src/a.c"),
        writes("src/b.c"),
        rounds=[FAILING_BUILD, PASSING_BUILD],
    )

    retry = control.bodies("transition")[4]
    assert retry.returned_from is not None
    assert retry.returned_from.reason == "failed_tests"


# --- designed failures ----------------------------------------------------------------------


def test_a_farm_with_no_eligible_runner_fails_the_stage_with_the_reason(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    message = (
        "No runner in pool `pool-a` can take this build: every runner is offline, "
        "drained, full, or lacks the pool's executor. Build #483 was cancelled."
    )

    def refuse(control: FakeControl) -> None:
        control.refusals["build"] = [
            ControlPlaneError("build_no_eligible_runner", message, 409)
        ]

    control = run(seeded, workspaces, loop_doc(), setup=refuse)

    assert control.transitions()[-2:] == [
        ("build", "active", 1),
        ("build", "failed", 1),
    ]
    finished = control.finished()
    assert (finished.outcome, finished.reason, finished.stage_key) == (
        "failed",
        message,
        "build",
    )


def test_a_job_left_with_no_eligible_runner_is_cancelled_after_the_grace_window(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    stranded = farm_job("waiting", queueState="queued_no_eligible_runner")
    control = run(
        seeded,
        workspaces,
        loop_doc(),
        rounds=[[stranded]],
        settings=BuildSettings(poll_seconds=5, no_runner_grace_seconds=60),
    )

    assert len(control.bodies("read_build")) == 12, "a minute of five-second reads"
    assert len(control.bodies("cancel_build")) == 1
    finished = control.finished()
    assert finished.outcome == "failed"
    assert finished.reason.startswith(
        "No runner in pool `pool-a` could take build #483 within 1 minute(s)"
    )


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("farm_pool_not_found", 404),
        ("farm_pool_disabled", 409),
        ("farm_command_required", 422),
        ("run_branch_missing", 409),
    ],
)
def test_a_farm_refusal_ends_the_run_with_its_sentence(
    seeded: SeededRepo, workspaces: RunWorkspaces, code: str, status: int
) -> None:
    def refuse(control: FakeControl) -> None:
        control.refusals["build"] = [
            ControlPlaneError(code, f"The farm said {code}.", status)
        ]

    control = run(seeded, workspaces, loop_doc(), setup=refuse)

    assert control.finished().reason == f"The farm said {code}."


def test_a_build_stage_without_a_pool_fails_before_submitting(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(seeded, workspaces, loop_doc(build=infra("build", pool=None)))

    assert not control.bodies("build")
    assert control.finished().reason.startswith("build_pool_required:")


def test_a_command_that_does_not_split_fails_before_submitting(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(
        seeded, workspaces, loop_doc(build=infra("build", command="make 'oops"))
    )

    assert not control.bodies("build")
    assert control.finished().reason.startswith("build_command_invalid:")


def test_a_job_cancelled_on_the_farm_fails_the_run_not_the_gate(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = run(
        seeded,
        workspaces,
        loop_doc(),
        rounds=[[farm_job("offered"), farm_job("canceled", runnerName=None)]],
    )

    finished = control.finished()
    assert finished.outcome == "failed"
    assert finished.reason == "Build #483 was cancelled on the farm before it finished."
    assert ("implement", "active", 2) not in control.transitions()


def test_an_abort_during_a_build_cancels_the_job(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    running = farm_job("running")

    def abort_once_building(control: FakeControl) -> None:
        control.plan("abort", lambda c: len(c.bodies("read_build")) >= 2)

    control = run(
        seeded,
        workspaces,
        loop_doc(),
        rounds=[[farm_job("offered"), running]],
        setup=abort_once_building,
    )

    assert len(control.bodies("cancel_build")) == 1
    assert control.finished() is None, "an abort is acknowledged, never finished"
    assert control.acks()
