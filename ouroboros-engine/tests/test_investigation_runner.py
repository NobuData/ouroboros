"""The background runner: one thread per investigation, a bound, and no double start."""

import threading

import pytest

from investigation_fakes import INVESTIGATION, request_for
from ouroboros_engine.investigation.contract import LOOP_VERSION, task_ref
from ouroboros_engine.investigation.runner import AtCapacityError, InvestigationRunner


class GatedLoop:
    """A loop that waits to be released, so a test can look while it runs."""

    def __init__(self, *, explode: bool = False) -> None:
        """Start closed."""
        self.release = threading.Event()
        self.entered = threading.Event()
        self.runs = 0
        self.explode = explode

    def run(self, _request) -> str:
        """Wait for the gate, then end."""
        self.runs += 1
        self.entered.set()
        self.release.wait(timeout=10)
        if self.explode:
            raise RuntimeError("the loop broke")
        return "brief_ready"


def _other(n: int) -> str:
    return f"5eed0091-0000-4000-8000-00000000{n:04d}"


def test_a_submitted_investigation_runs_in_the_background_and_is_let_go() -> None:
    loop = GatedLoop()
    runner = InvestigationRunner(loop)

    accepted = runner.submit(request_for())

    assert accepted.state == "accepted"
    assert accepted.task == task_ref(INVESTIGATION)
    assert accepted.loop_version == LOOP_VERSION
    assert loop.entered.wait(timeout=5)
    assert runner.holds(INVESTIGATION.upper())

    loop.release.set()
    assert runner.wait(INVESTIGATION, timeout=5)
    assert not runner.holds(INVESTIGATION)


def test_a_repeated_submit_starts_nothing() -> None:
    loop = GatedLoop()
    runner = InvestigationRunner(loop)
    runner.submit(request_for())
    loop.entered.wait(timeout=5)

    again = runner.submit(request_for())

    assert again.state == "already_running"
    loop.release.set()
    runner.wait(INVESTIGATION, timeout=5)
    assert loop.runs == 1


def test_the_runner_refuses_past_its_bound_and_accepts_again_when_one_ends() -> None:
    loop = GatedLoop()
    runner = InvestigationRunner(loop, max_concurrent=2)
    for n in (1, 2):
        runner.submit(request_for().model_copy(update={"investigation": _other(n)}))

    with pytest.raises(AtCapacityError):
        runner.submit(request_for())

    loop.release.set()
    assert runner.wait(_other(1), timeout=5) and runner.wait(_other(2), timeout=5)
    assert runner.submit(request_for()).state == "accepted"
    runner.wait(INVESTIGATION, timeout=5)


def test_a_loop_that_raises_is_still_let_go() -> None:
    loop = GatedLoop(explode=True)
    runner = InvestigationRunner(loop)
    runner.submit(request_for())
    loop.release.set()

    assert runner.wait(INVESTIGATION, timeout=5)
    assert not runner.holds(INVESTIGATION)


def test_waiting_on_an_investigation_not_held_returns_at_once() -> None:
    assert InvestigationRunner(GatedLoop()).wait(INVESTIGATION, timeout=0) is True
