"""Kill mid-stage, then resume: the interpreter (#160) with the real Claude Agent executor.

DH.3 (#1308). A worker is killed while the harness waits on a model call, after one tool
result — the interpreter has stored the session's live checkpoint by then. The next worker
reopens the run's tree at its last checkpoint (DI.1, #1307: whatever the killed session wrote
since is gone, and so is a half-written file) and resumes the *same* harness session from
the per-run configuration directory, rather than starting the attempt again.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from pathlib import Path

from claude_agent_fixtures import Bench, needs_cli
from code_fixtures import build_repo
from execution_fakes import RUN, FakeControl, chain, llm, never, term, trigger
from harness_stub_facade import Turn
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.workspace import RunWorkspaces

pytestmark = needs_cli

MB = 1024 * 1024


def _interpreter(
    control: FakeControl, clones: CloneStore, workspaces: RunWorkspaces, bench: Bench
) -> Interpreter:
    registry = ExecutorRegistry()
    registry.register("harness", bench.executor)
    return Interpreter(control, clones, workspaces, registry, worker="w", sleep=never)


def test_a_worker_killed_mid_session_resumes_the_session_on_the_reset_tree(
    tmp_path: Path,
) -> None:
    seeded = build_repo(tmp_path / "remote" / "helios-firmware.git")
    clones = CloneStore(tmp_path / "clones", allow_local=True)
    workspaces = RunWorkspaces(
        tmp_path / "runs", clones, max_bytes=64 * MB, disk_free=lambda _path: 1024 * MB
    )
    tree = workspaces.path_of(RUN) / "tree"
    gate = threading.Event()
    bench = Bench(
        [
            Turn(
                "Writing.",
                [("Write", {"file_path": f"{tree}/impl.c", "content": "a\n"})],
            ),
            Turn(None, [("Write", {"file_path": f"{tree}/more.c", "content": "b\n"})]),
            Turn("Done."),
        ]
    )

    def hold(turn: int) -> float:
        """The second model call (after the first tool result) waits for the gate."""
        if turn == 1:
            gate.wait(30)
        return 0.0

    bench.facade.delay = hold
    doc = chain(trigger(), llm("implement"), term("done", "open_pr_automerge"))
    control = FakeControl(doc, remote=str(seeded.path))

    async def killed() -> None:
        task = asyncio.create_task(
            _interpreter(control, clones, workspaces, bench).execute(RUN)
        )
        while not any(r["turn"] == 1 for r in bench.facade.main_requests()):
            await asyncio.sleep(0.05)
        (tree / "half.txt").write_text("half-writ")  # a write the kill interrupted
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    try:
        asyncio.run(killed())
        stored = control.state
        assert stored is not None and stored["stage_key"] == "implement"
        live = stored["executor_checkpoint"]
        assert live["executor_kind"] == "harness"
        session = live["state"]["session_id"]
        assert control.finished() is None
        gate.set()

        asyncio.run(_interpreter(control, clones, workspaces, bench).execute(RUN))
    finally:
        gate.set()
        bench.close()

    # The same attempt, resumed — not failed and re-run.
    assert control.transitions() == [
        ("implement", "active", 1),
        ("implement", "succeeded", 1),
    ]
    resumed = bench.facade.main_requests()[-2]
    assert resumed["messages"] > 2  # the killed session's history was replayed
    files = [f.path for f in control.bodies("files")[-1].files]
    assert files == ["more.c"]  # impl.c and half.txt went with the reset
    assert control.finished().outcome == "review"
    assert len(bench.credentials.minted) == 2
    assert len(bench.credentials.revoked) == 2
    assert session  # the session the second worker resumed
