"""Controls and guardrail enforcement with the real Claude Agent executor (#315, AR.1).

The interpreter drives the bundled CLI against :mod:`harness_stub_facade`: a person's steer
reaches the model's next request, a protected-path write is refused at the pre-tool hook,
and a change-set the guardrails block stops the session at the next tool boundary.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import pytest

from claude_agent_fixtures import Bench, needs_cli
from code_fixtures import build_repo
from execution_fakes import RUN, FakeControl, chain, fast, llm, never, term, trigger
from harness_stub_facade import Turn
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.workspace import RunWorkspaces

pytestmark = needs_cli

MB = 1024 * 1024

DOC = chain(trigger(), llm("implement"), term("done", "open_pr_automerge"))


class Stack:
    """A stub facade, a fake control plane and real run trees, for one run."""

    def __init__(self, tmp_path: Path) -> None:
        """Lay out the remote, the clone cache and the run trees."""
        self.seeded = build_repo(tmp_path / "remote" / "helios-firmware.git")
        self.clones = CloneStore(tmp_path / "clones", allow_local=True)
        self.workspaces = RunWorkspaces(
            tmp_path / "runs",
            self.clones,
            max_bytes=64 * MB,
            disk_free=lambda _path: 1024 * MB,
        )
        self.tree = self.workspaces.path_of(RUN) / "tree"
        self.control = FakeControl(DOC, remote=str(self.seeded.path))
        self.bench: Bench | None = None

    def write(self, relative: str, content: str = "x = 1\n") -> tuple[str, dict]:
        """A scripted ``Write`` into the run's tree."""
        return ("Write", {"file_path": f"{self.tree}/{relative}", "content": content})

    def run(self, script: list[Turn], **facade: Any) -> FakeControl:
        """Execute the run with the harness executor registered."""
        self.bench = Bench(script)
        for name, value in facade.items():
            setattr(self.bench.facade, name, value)
        registry = ExecutorRegistry()
        registry.register("harness", self.bench.executor)
        interpreter = Interpreter(
            self.control,
            self.clones,
            self.workspaces,
            registry,
            worker="w",
            sleep=never,
            poll_sleep=fast,
        )
        asyncio.run(interpreter.execute(RUN))
        return self.control

    def close(self) -> None:
        """Stop the facade."""
        if self.bench is not None:
            self.bench.close()


@pytest.fixture
def stack(tmp_path: Path):
    """A stack, closed afterwards."""
    made = Stack(tmp_path)
    yield made
    made.close()


def _wait_for(condition: Any, seconds: float = 20.0) -> None:
    """Block the facade's thread until ``condition()`` holds, or time runs out."""
    deadline = time.monotonic() + seconds
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.02)


def test_a_steer_reaches_the_models_next_request_and_is_acked_with_the_attempt(
    stack: Stack,
) -> None:
    steer = stack.control.plan(
        "steer",
        lambda c: ("implement", "active", 1) in c.transitions(),
        payload="Keep greet() pure.",
    )
    control = stack.run(
        [
            Turn("Writing.", [stack.write("src/greet.py")]),
            Turn(None, [stack.write("src/more.py")]),
            Turn("Done."),
        ],
        # The second model call waits until the steer was handed over.
        delay=lambda turn: (
            _wait_for(lambda: bool(stack.control.acks())) or 0.0 if turn == 1 else 0.0
        ),
    )

    assert control.ack_of(steer) == {"control": steer, "effect": None, "attempt": 1}
    assert stack.bench is not None
    histories = [r["history"] for r in stack.bench.facade.main_requests()]
    assert "Keep greet() pure." not in histories[0]
    assert any("Keep greet() pure." in history for history in histories[1:])
    assert control.finished().outcome == "review"


def test_a_planted_protected_write_is_refused_at_the_hook(stack: Stack) -> None:
    control = stack.run([Turn("Patching.", [stack.write("boot/rollback_flag.c")])])

    reported = [f.path for body in control.bodies("files") for f in body.files]
    assert "boot/rollback_flag.c" not in reported  # the write never ran
    assert control.transitions()[-1] == ("implement", "failed", 1)
    finished = control.finished()
    assert finished.outcome == "failed" and "protected_path" in finished.reason


def test_a_change_set_the_guardrails_block_halts_the_harness_stage(
    stack: Stack,
) -> None:
    control = stack.control
    control.needs_human = True
    control.guardrail_failures = ["secrets"]
    control.guardrail_verdicts = [
        {
            "check": "secrets",
            "mode": "block",
            "evidence": {"path": "src/keys.py", "line": 1, "rule_id": "aws"},
        }
    ]
    stack.run(
        [
            Turn("Writing.", [stack.write("src/keys.py", "KEY = 'AKIA'\n")]),
            Turn(None, [stack.write("src/more.py")]),
            Turn("Done."),
        ],
        # The next model call waits until the change-set was reported and judged.
        delay=lambda turn: (
            _wait_for(lambda: bool(control.bodies("files"))) or 0.0
            if turn == 1
            else 0.0
        ),
    )

    assert control.transitions() == [
        ("implement", "active", 1),
        ("implement", "failed", 1),
    ]
    finished = control.finished()
    assert finished.outcome == "needs_human"
    assert finished.reason == "guardrail secrets failed: src/keys.py:1 (aws)"
    # Halted at the boundary: one change-set report, and the hook refused the next tool
    # call (the session stopped; no third model call was made).
    assert len(control.bodies("files")) == 1
    assert [f.path for f in control.bodies("files")[0].files] == ["src/keys.py"]
    assert stack.bench is not None
    assert len(stack.bench.facade.main_requests()) == 2
