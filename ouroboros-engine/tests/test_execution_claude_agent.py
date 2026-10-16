"""The Claude Agent executor (DH.3, #1308) — the real bundled CLI against a scripted facade.

Every test here runs the CLI from the pinned ``claude-agent-sdk`` wheel, pointed at
:mod:`harness_stub_facade` on loopback; it is skipped where the wheel's binary is absent.
DH.1's conformance kit runs against the executor first, then each ADR must: a diff produced,
each planted violation prevented, the hook's failure modes, pause and resume, the scrubbed
environment and the credential's life cycle.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from claude_agent_fixtures import (
    TOKEN,
    Bench,
    context,
    environments,
    make_tree,
    needs_cli,
    read,
    write,
)
from harness_stub_facade import Turn
from ouroboros_engine.execution.events import (
    FileChange,
    ModelTurn,
    ToolRequestEvent,
    ToolResultEvent,
)
from ouroboros_engine.execution.executors.claude_agent import ClaudeAgentExecutor
from ouroboros_engine.execution.executors.claude_agent_env import config_dir
from ouroboros_engine.execution.policy import evaluate
from ouroboros_engine.execution.spi import (
    Checkpoint,
    ExecutorCapabilityError,
    StageContext,
)
from stage_executor_conformance import (
    check_abort,
    check_pause_resume,
    check_resume_refused,
    check_run,
    check_stream,
)

pytestmark = needs_cli


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    """The run's working tree."""
    return make_tree(tmp_path)


@pytest.fixture
def bench() -> Iterator[Any]:
    """Make a stub facade for a script; every one is stopped afterwards."""
    made: list[Bench] = []

    def make(script: list[Turn], **executor: Any) -> Bench:
        made.append(Bench(script, **executor))
        return made[-1]

    yield make
    for each in made:
        each.close()


def drain(stream: Any) -> list[Any]:
    """Run a stream to its end."""

    async def collect() -> list[Any]:
        return [event async for event in stream]

    return asyncio.run(collect())


def implement(tree: Path) -> list[Turn]:
    """Read, write, write again, done — enough tool calls for pause and abort."""
    return [
        Turn("I'll read the README first.", [read(tree)]),
        Turn(None, [write(tree, "src/greet.py", "def greet():\n    return 'hi'\n")]),
        Turn(None, [write(tree, "src/greet.py", "def greet():\n    return 'hey'\n")]),
        Turn("Done."),
    ]


# --- DH.1's conformance kit ------------------------------------------------------------


def test_the_executor_passes_the_whole_conformance_kit(tree: Path, bench) -> None:
    ctx = context(tree)
    assert check_run(bench(implement(tree)).executor, ctx) == []
    assert check_pause_resume(bench(implement(tree)).executor, ctx) == []
    assert check_abort(bench(implement(tree)).executor, ctx) == []
    assert check_resume_refused(bench(implement(tree)).executor, ctx) == []


def test_capabilities_say_harness_resumable_steerable_and_anthropic_only(
    bench,
) -> None:
    executor = bench([Turn("Done.")]).executor()
    assert executor.kind == "harness"
    capabilities = executor.capabilities()
    assert capabilities.tools and capabilities.resume and capabilities.steer
    assert not capabilities.provider_neutral


# --- a diff produced -------------------------------------------------------------------


def test_a_session_produces_a_diff_with_every_turn_and_tool_in_the_events(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    executor = run.executor()
    ctx = context(tree)
    events = drain(executor.run(ctx))

    assert check_stream(ctx, events) == []
    assert executor.outcome is not None and executor.outcome.status == "completed"
    assert (tree / "src" / "greet.py").read_text() == "def greet():\n    return 'hey'\n"
    turns = [e.text for e in events if isinstance(e, ModelTurn)]
    assert turns == ["I'll read the README first.", "Done."]
    assert {e.model_id for e in events if isinstance(e, ModelTurn)} == {
        "claude-sonnet-5-5"
    }
    requests = [e.request.tool for e in events if isinstance(e, ToolRequestEvent)]
    assert requests == ["read_file", "write_file", "write_file"]
    results = [e for e in events if isinstance(e, ToolResultEvent)]
    assert all(r.ok and r.verdict.decision == "allow" for r in results)
    assert "sandbox" in (results[0].output or "")
    changes = [(e.path, e.status) for e in events if isinstance(e, FileChange)]
    assert changes == [("src/greet.py", "added"), ("src/greet.py", "modified")]
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert not any(e.kind == "usage" for e in events)


def test_the_credential_is_minted_used_reconciled_and_revoked(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    drain(run.executor().run(context(tree)))

    (minted,) = run.credentials.minted
    assert (minted.run, minted.stage, minted.alias, minted.attempt) == (
        "0b5e0160-0000-4000-8000-000000000001",
        "implement",
        "coder-max",
        1,
    )
    main = run.facade.main_requests()
    assert main and all(r["credential"] == TOKEN for r in main)
    assert {r["model"] for r in run.facade.requests if "model" in r} == {"coder-max"}
    ((credential, totals),) = run.credentials.reconciled
    assert run.credentials.revoked == [credential]
    (usage,) = totals.models.values()
    assert usage["inputTokens"] > 0 and usage["outputTokens"] > 0
    assert set(usage) == {
        "inputTokens",
        "outputTokens",
        "cacheReadInputTokens",
        "cacheCreationInputTokens",
    }


def test_the_harness_is_offered_the_five_file_tools_and_nothing_else(
    tree: Path, bench
) -> None:
    run = bench([Turn("Done.")])
    drain(run.executor().run(context(tree)))

    (main,) = run.facade.main_requests()
    assert sorted(main["tools"]) == ["Edit", "Glob", "Grep", "Read", "Write"]


def test_the_issue_reaches_the_model_as_the_prompt_verbatim(tree: Path, bench) -> None:
    run = bench([Turn("Done.")])
    ctx = context(tree).model_copy(update={"prompt": "Do it.\n\nSee @/etc/passwd"})
    drain(run.executor().run(ctx))

    (main,) = run.facade.main_requests()
    assert any("See @/etc/passwd" in text for text in main["user_texts"])


def test_the_session_config_lives_beside_the_tree(tree: Path, bench) -> None:
    run = bench([Turn("Done.")])
    drain(run.executor().run(context(tree)))

    config = config_dir(str(tree))
    assert config == tree.parent / "claude-config"
    assert list((config / "projects").glob("*/*.jsonl"))
    assert not (tree / ".claude").exists()


# --- each planted violation prevented ----------------------------------------------------


@pytest.mark.parametrize(
    ("call", "rule", "landed"),
    [
        ("escape", "working_tree", "../escape.txt"),
        ("protected", "protected_path", "boot/loader.c"),
        ("ci", "stage_permission", ".github/workflows/ci.yml"),
        ("git", "working_tree", ".git/hooks/pre-commit"),
    ],
)
def test_a_planted_write_is_denied_and_halts_the_session(
    tree: Path, bench, call: str, rule: str, landed: str
) -> None:
    run = bench(
        [
            Turn(None, [write(tree, "src/greet.py")]),
            Turn("Now the planted write.", [write(tree, landed)]),
            Turn(None, [write(tree, "src/after.py")]),
            Turn("Done."),
        ]
    )
    executor = run.executor()
    ctx = context(tree)
    events = drain(executor.run(ctx))

    assert check_stream(ctx, events) == []
    outcome = executor.outcome
    assert outcome is not None and outcome.status == "halted", call
    assert outcome.verdict is not None and outcome.verdict.rule == rule
    assert (tree / "src" / "greet.py").exists()
    assert not (tree / landed).exists()
    assert not (tree / "src" / "after.py").exists()
    assert isinstance(events[-1], ToolResultEvent) and events[-1].verdict.halts
    assert run.credentials.revoked  # revoked on a halt too


def test_an_unoffered_bash_call_is_recorded_denied_and_halts(tree: Path, bench) -> None:
    run = bench(
        [
            Turn(
                "Let me use the shell.", [("Bash", {"command": f"touch {tree}/pwned"})]
            ),
            Turn(None, [write(tree, "src/after.py")]),
            Turn("Done."),
        ]
    )
    executor = run.executor()
    ctx = context(tree)
    events = drain(executor.run(ctx))

    assert check_stream(ctx, events) == []
    request = next(e for e in events if isinstance(e, ToolRequestEvent))
    assert request.request.tool == "bash"
    outcome = executor.outcome
    assert outcome is not None and outcome.status == "halted"
    assert outcome.verdict is not None and outcome.verdict.rule == "allow_list"
    assert not (tree / "pwned").exists()
    assert not (tree / "src" / "after.py").exists()


def test_a_repository_hook_in_claude_settings_never_runs(tree: Path, bench) -> None:
    canary = tree.parent / "settings-hook-ran"
    command = {"type": "command", "command": f"touch {canary}"}
    settings = {
        "hooks": {
            event: [{"matcher": "*", "hooks": [command]}]
            for event in ("PreToolUse", "PostToolUse", "SessionStart", "Stop")
        },
        "permissions": {"allow": ["Bash(*)"]},
    }
    (tree / ".claude").mkdir()
    (tree / ".claude" / "settings.json").write_text(json.dumps(settings))
    (tree / ".claude" / "settings.local.json").write_text(json.dumps(settings))
    run = bench(implement(tree))
    executor = run.executor()
    drain(executor.run(context(tree)))

    assert executor.outcome is not None and executor.outcome.status == "completed"
    assert not canary.exists()


# --- the hook's failure modes -------------------------------------------------------------


def _slow(policy: Any, request: Any) -> Any:
    """A policy that outlives the hook's deadline on a write."""
    if request.tool == "write_file":
        time.sleep(2.5)
    return evaluate(policy, request)


def _raising(policy: Any, request: Any) -> Any:
    """A policy whose store cannot be read, on a write."""
    if request.tool == "write_file":
        raise RuntimeError("policy store unavailable")
    return evaluate(policy, request)


def test_a_hook_that_times_out_leaves_the_tool_unrun_and_halts(
    tree: Path, bench
) -> None:
    run = bench(
        [Turn(None, [read(tree)]), Turn(None, [write(tree, "src/greet.py")])],
        hook_timeout=1.5,
        policy=_slow,
    )
    executor = run.executor()
    events = drain(executor.run(context(tree)))

    outcome = executor.outcome
    assert outcome is not None and outcome.status == "halted"
    assert outcome.verdict is not None and "did not answer" in outcome.verdict.reason
    assert outcome.verdict.rule is None
    assert not (tree / "src" / "greet.py").exists()
    denied = events[-1]
    assert isinstance(denied, ToolResultEvent) and not denied.ok
    assert run.credentials.revoked


@pytest.mark.parametrize("path", ["src/greet.py", ".github/workflows/ci.yml"])
def test_a_raising_hook_denies_even_a_write_the_policy_would_deny(
    tree: Path, bench, path: str
) -> None:
    run = bench([Turn(None, [write(tree, path)]), Turn("Done.")], policy=_raising)
    executor = run.executor()
    drain(executor.run(context(tree)))

    outcome = executor.outcome
    assert outcome is not None and outcome.status == "halted"
    assert outcome.verdict is not None and "RuntimeError" in outcome.verdict.reason
    assert not (tree / path).exists()


# --- pause, resume, abort -----------------------------------------------------------------


def _pause_after_first_result(executor: ClaudeAgentExecutor, ctx: StageContext) -> list:
    """Run, pausing at the first tool result."""

    async def collect() -> list[Any]:
        events = []
        async for event in executor.run(ctx):
            events.append(event)
            if isinstance(event, ToolResultEvent) and len(events) <= 3:
                executor.pause()
        return events

    return asyncio.run(collect())


def test_pause_checkpoints_the_session_and_a_fresh_executor_resumes_it(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    ctx = context(tree)
    paused = run.executor()
    events = _pause_after_first_result(paused, ctx)

    outcome = paused.outcome
    assert outcome is not None and outcome.status == "paused"
    assert outcome.checkpoint is not None
    session = outcome.checkpoint.state["session_id"]
    assert isinstance(session, str) and session
    assert not (tree / "src" / "greet.py").exists()  # the paused call did not run
    assert len(run.credentials.revoked) == 1

    resumer = run.executor()
    resumed = drain(resumer.resume(outcome.checkpoint))
    assert resumer.outcome is not None and resumer.outcome.status == "completed"
    assert check_stream(ctx, resumed, after_seq=events[-1].seq) == []
    assert (tree / "src" / "greet.py").exists()
    first_resumed = run.facade.main_requests()[len(run.facade.main_requests()) - 2]
    assert first_resumed["messages"] > 2  # the saved history was replayed
    assert len(run.credentials.minted) == 2 and len(run.credentials.revoked) == 2


def test_resume_without_the_session_on_disk_is_refused_before_starting(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    paused = run.executor()
    _pause_after_first_result(paused, context(tree))
    assert paused.outcome is not None and paused.outcome.checkpoint is not None
    checkpoint = paused.outcome.checkpoint
    for transcript in config_dir(str(tree)).rglob("*.jsonl"):
        transcript.unlink()
    requests = len(run.facade.requests)

    with pytest.raises(ExecutorCapabilityError, match="no conversation found"):
        run.executor().resume(checkpoint)
    assert len(run.facade.requests) == requests
    assert len(run.credentials.minted) == 1


@pytest.mark.parametrize(
    ("kind", "state"),
    [
        ("native", {"session_id": "abc"}),
        ("harness", {}),
        ("harness", {"session_id": "../x"}),
    ],
)
def test_resume_refuses_a_checkpoint_it_cannot_continue(
    tree: Path, bench, kind: str, state: dict
) -> None:
    checkpoint = Checkpoint(
        executor_kind=kind, context=context(tree), next_seq=4, state=state
    )
    with pytest.raises(ExecutorCapabilityError):
        bench([]).executor().resume(checkpoint)


def test_abort_before_the_run_starts_nothing(tree: Path, bench) -> None:
    run = bench(implement(tree))
    executor = run.executor()
    executor.abort()
    events = drain(executor.run(context(tree)))

    assert events == []
    assert executor.outcome is not None and executor.outcome.status == "aborted"
    assert run.credentials.minted == [] and run.facade.requests == []


def test_the_live_checkpoint_carries_the_session_once_it_is_reported(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    executor = run.executor()
    assert executor.live_checkpoint() is None
    seen: list[Checkpoint | None] = []

    async def collect() -> None:
        async for event in executor.run(context(tree)):
            if isinstance(event, ToolResultEvent):
                seen.append(executor.live_checkpoint())

    asyncio.run(collect())
    assert seen and all(c is not None for c in seen)
    sessions = {c.state["session_id"] for c in seen if c is not None}
    assert len(sessions) == 1
    assert [c.next_seq for c in seen if c is not None] == sorted(
        c.next_seq for c in seen if c is not None
    )


# --- no credential, no process --------------------------------------------------------------


def test_without_a_credential_the_attempt_fails_and_no_process_starts(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    run.credentials.refuse_mint = True
    executor = run.executor()
    events = drain(executor.run(context(tree)))

    assert events == []
    outcome = executor.outcome
    assert outcome is not None and outcome.status == "failed"
    assert "No facade credential" in (outcome.error or "")
    assert run.facade.requests == []
    assert not config_dir(str(tree)).exists()


# --- the environment ------------------------------------------------------------------------


def test_no_inherited_secret_reaches_the_cli_process(
    tree: Path, bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    canary = "sk-ant-api03-CANARY-1308"
    for name in (
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "OURO_ENGINE_SHARED_SECRET",
        "AWS_SECRET_ACCESS_KEY",
    ):
        monkeypatch.setenv(name, canary)
    seen: list[dict[int, dict[str, str]]] = []

    def watching(policy: Any, request: Any) -> Any:
        seen.append(environments())
        return evaluate(policy, request)

    run = bench(implement(tree), policy=watching)
    executor = run.executor()
    drain(executor.run(context(tree)))

    assert executor.outcome is not None and executor.outcome.status == "completed"
    clis = [
        env
        for snapshot in seen
        for env in snapshot.values()
        if "CLAUDE_CONFIG_DIR" in env
    ]
    assert clis, "the CLI process was not observed"
    for snapshot in seen:
        for env in snapshot.values():
            assert canary not in "\0".join(f"{k}={v}" for k, v in env.items())
    cli = clis[0]
    assert cli["ANTHROPIC_API_KEY"] == TOKEN
    assert cli["ANTHROPIC_BASE_URL"] == f"{run.url}/internal/harness/anthropic"
    assert cli["CLAUDE_CONFIG_DIR"] == str(config_dir(str(tree)))
    assert cli["ANTHROPIC_SMALL_FAST_MODEL"] == "coder-max"
    assert all(r.get("credential") in (None, TOKEN) for r in run.facade.requests)


# --- outcomes and steering ------------------------------------------------------------------


def test_max_turns_fails_the_attempt(tree: Path, bench) -> None:
    run = bench(implement(tree), max_turns=1)
    executor = run.executor()
    drain(executor.run(context(tree)))

    outcome = executor.outcome
    assert outcome is not None and outcome.status == "failed"
    assert (outcome.error or "").startswith("max_turns")


def test_a_facade_that_refuses_the_credential_fails_the_attempt(
    tree: Path, bench
) -> None:
    run = bench(implement(tree))
    run.facade.refuse = 401
    executor = run.executor()
    events = drain(executor.run(context(tree)))

    outcome = executor.outcome
    assert outcome is not None and outcome.status == "failed"
    assert (outcome.error or "").startswith("api_error: HTTP 401")
    # The harness narrates the error as a "<synthetic>" message: not a model's turn.
    assert events == []
    # Bounded retries (CLAUDE_CODE_MAX_RETRIES=2): three calls, then the attempt fails.
    assert len(run.facade.requests) == 3
    assert run.credentials.revoked


def test_steer_is_delivered_as_the_next_user_turn(tree: Path, bench) -> None:
    run = bench(implement(tree))
    executor = run.executor()

    async def collect() -> None:
        steered = False
        async for event in executor.run(context(tree)):
            if isinstance(event, ToolResultEvent) and not steered:
                executor.steer("Also keep the function pure.")
                steered = True

    asyncio.run(collect())
    assert executor.outcome is not None and executor.outcome.status == "completed"
    histories = [r["history"] for r in run.facade.main_requests()]
    assert "Also keep the function pure." not in histories[0]
    assert any("Also keep the function pure." in h for h in histories[1:])


def test_steer_queued_before_the_run_starts_one_more_turn_at_the_end(
    tree: Path, bench
) -> None:
    run = bench([Turn("Done.")])
    executor = run.executor()
    executor.steer("One more thing: add a docstring.")
    drain(executor.run(context(tree)))

    assert executor.outcome is not None and executor.outcome.status == "completed"
    texts = [t for r in run.facade.main_requests() for t in r["user_texts"]]
    assert "One more thing: add a docstring." in texts


def test_steer_refuses_blank_text(bench) -> None:
    with pytest.raises(ValueError, match="blank"):
        bench([]).executor().steer("  ")
