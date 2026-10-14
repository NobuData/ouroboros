"""The conformance kit: both fake kinds pass it, and each rogue fails it."""

from pathlib import Path

import pytest

from ouroboros_engine.execution.spi import (
    SAFE_BOUNDARIES,
    Checkpoint,
    ExecutorCapabilities,
    ExecutorCapabilityError,
)
from stage_executor_conformance import (
    check_abort,
    check_pause_resume,
    check_resume_refused,
    check_run,
)
from stage_executor_fakes import (
    Call,
    FakeExecutor,
    FakeHarnessExecutor,
    FakeNativeExecutor,
    Rogue,
    RogueExecutor,
    Say,
    Script,
)
from stage_executor_fixtures import make_context

#: The prototype's script: read, write, a denied CI write, and nothing after it.
IMPLEMENT = Script(
    [
        Say("I'll read the README first."),
        Call("read_file", "README.md"),
        Call("write_file", "src/greet.py", "def greet():\n    return 'hi'\n"),
        Say("Done."),
    ]
)

DENIED = Script(
    [
        Call("write_file", "src/greet.py", "x = 1\n"),
        Call("write_file", ".github/workflows/ci.yml", "on: push\n"),
        Call("write_file", "src/after.py", "never\n"),
    ]
)

KINDS = [FakeNativeExecutor, FakeHarnessExecutor]


@pytest.mark.parametrize("kind", KINDS)
def test_the_fake_passes_the_whole_kit(
    tmp_path: Path, kind: type[FakeExecutor]
) -> None:
    ctx = make_context(tmp_path)
    assert check_run(lambda: kind(IMPLEMENT), ctx) == []
    assert check_pause_resume(lambda: kind(IMPLEMENT), ctx) == []
    assert check_abort(lambda: kind(IMPLEMENT), ctx) == []
    assert check_resume_refused(lambda: kind(IMPLEMENT), ctx) == []


@pytest.mark.parametrize("kind", KINDS)
def test_a_deny_halts_and_the_write_never_lands(
    tmp_path: Path, kind: type[FakeExecutor]
) -> None:
    ctx = make_context(tmp_path)
    executor = kind(DENIED)
    assert check_run(lambda: executor, ctx) == []
    assert executor.outcome is not None
    assert executor.outcome.status == "halted"
    assert executor.outcome.verdict is not None
    assert executor.outcome.verdict.rule == "stage_permission"
    assert (tmp_path / "src" / "greet.py").exists()
    assert not (tmp_path / ".github" / "workflows" / "ci.yml").exists()
    assert not (tmp_path / "src" / "after.py").exists()


@pytest.mark.parametrize(
    ("rule", "expected"),
    [
        ("vocabulary", "event outside the vocabulary: Reasoning 'reasoning'"),
        ("skips_policy", "reports allow where the policy says deny"),
        ("wrong_stage", "belongs to elsewhere#1, not implement#1"),
        ("no_outcome", "the stream ended with no outcome"),
    ],
)
def test_a_rogue_executor_fails_the_kit(
    tmp_path: Path, rule: str, expected: str
) -> None:
    ctx = make_context(tmp_path)
    problems = check_run(lambda: RogueExecutor(DENIED, Rogue(rule)), ctx)  # type: ignore[arg-type]
    assert any(expected in problem for problem in problems), problems


class _NoResume(FakeNativeExecutor):
    def capabilities(self) -> ExecutorCapabilities:
        return ExecutorCapabilities(
            tools=True, resume=False, steer=False, provider_neutral=True
        )


def test_an_executor_that_cannot_resume_must_refuse(tmp_path: Path) -> None:
    ctx = make_context(tmp_path)
    # The fake resumes regardless of what it claims — the kit catches the mismatch.
    assert check_resume_refused(lambda: _NoResume(IMPLEMENT), ctx) == [
        "resume() ran although capabilities() says it cannot"
    ]
    assert check_pause_resume(lambda: _NoResume(IMPLEMENT), ctx) == [
        "carried a checkpoint it does not claim to resume"
    ]


def test_a_checkpoint_from_another_kind_is_refused(tmp_path: Path) -> None:
    ctx = make_context(tmp_path)
    checkpoint = Checkpoint(
        executor_kind="native", context=ctx, next_seq=3, state={"step": 1}
    )
    with pytest.raises(ExecutorCapabilityError):
        FakeHarnessExecutor(IMPLEMENT).resume(checkpoint)


def test_every_kind_names_its_safe_boundary() -> None:
    assert set(SAFE_BOUNDARIES) == {"native", "harness"}
