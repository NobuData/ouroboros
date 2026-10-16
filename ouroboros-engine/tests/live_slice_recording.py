"""The live slice's recorded provider exchange — made, and checked, with the pinned harness.

DI.5 ([#1314](https://github.com/NobuData/ouroboros/issues/1314)) stands a recorded provider
at the HTTP boundary of the e2e stack (``tests/e2e/fixtures/provider-fixture``, infrastructure
option 6-A): an Anthropic Messages-format server that replays one exchange for the fixture
issue, so the whole path above the provider's socket — executor, facade, harness, working tree
— runs for real and deterministically. This module is where that exchange comes from.

**What is recorded, and what is scripted.** The assistant's turns are :data:`PLAN_SCRIPT` and
:data:`IMPLEMENT_SCRIPT` below — a model answering the fixture issue would not answer the
same way twice, and a recording whose turns came from a live model would still be a script
the moment it was replayed. What is *captured* is everything the pinned harness sends around
those turns: the ``anthropic-beta`` set and API version, the tools it offers, the tool
results it reports back (the deliberate failure's ``is_error`` among them), and the files it
leaves on disk. Those are the facts a different harness version would change, and the
provider fixture refuses, naming the version it was made with, when they do.

**The deliberate failure.** The implement script's first ``Edit`` names a line that is not in
``bin/greet`` (it assumes ``echo`` where the script uses ``printf``); the harness reports the
tool's error, and the next turn corrects it. The recording therefore carries one
failure-then-correction, as the issue asks, inside one session.

Used by ``test_live_slice_recording.py``: with ``OURO_RECORD_LIVE_SLICE=1`` the recording is
rewritten from a run of the real CLI; otherwise the committed recording must equal what the
run produces, which is the standing assertion that the recording and the pinned SDK agree.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from claude_agent_fixtures import CLI, FakeCredentials
from harness_stub_facade import Facade, Turn, serve
from ouroboros_engine.execution.executors.claude_agent import ClaudeAgentExecutor
from ouroboros_engine.execution.policy import ToolPolicy
from ouroboros_engine.execution.spi import StageContext, StageEvent
from ouroboros_engine.workflows.dsl import LlmPermissions

#: The repository root, from this file.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The fixture repository's tree — what git-stub serves as `acme-robotics/helios-greeter`.
FIXTURE_TREE = (
    REPO_ROOT / "tests/e2e/fixtures/git-stub/repos/acme-robotics/helios-greeter"
)

#: The committed recording the provider fixture replays.
RECORDING_PATH = (
    REPO_ROOT / "tests/e2e/fixtures/provider-fixture/recordings/live-slice.json"
)

#: The seeded fixture issue (R__dev_seed_live_slice.sql).
ISSUE_TITLE = "greet: the exclamation mark is missing"
ISSUE_BODY = (
    "`bin/greet World` prints `Hello, World` — the exclamation mark the README promises "
    "is missing.\n\nExpected: `Hello, World!` for `bin/greet World`, and `Hello, world!` "
    "when no name is given. `sh tests/check.sh` must pass."
)

#: The plan the plan session ends with, and the implement session is handed.
PLAN_TEXT = (
    "Plan: bin/greet prints the greeting with printf and drops the exclamation mark; "
    "change its format string to `Hello, %s!`. No other file changes: tests/check.sh "
    "already asserts both outputs and will pass once the script prints the mark."
)

#: The `plan` stage's prompt, as `live-slice@v1`'s template renders for the issue.
PLAN_PROMPT = (
    "Plan the change for this issue.\n\n"
    f"Issue: {ISSUE_TITLE}\nBody:  {ISSUE_BODY}\n\n"
    "Name every file the change touches and the test that proves it."
)

#: The `implement` stage's prompt, likewise.
IMPLEMENT_PROMPT = (
    "Implement the plan.\n\n"
    f"Issue: {ISSUE_TITLE}\nPlan:  {PLAN_TEXT}\n\n"
    "Change only what the plan names. Every acceptance criterion needs a test."
)

#: The aliases the slice workspace routes `plan` and `implement` to, and the model ids the
#: facade rewrites them to (R__dev_seed_live_slice.sql).
SESSIONS = {
    "plan": {"alias": "slice-planner", "model": "claude-sonnet-4-5"},
    "implement": {"alias": "slice-coder", "model": "claude-sonnet-4-5-20250929"},
}

#: The line the greeter prints before the fix, and after it.
BROKEN_LINE = "printf 'Hello, %s\\n' \"$name\""
FIXED_LINE = "printf 'Hello, %s!\\n' \"$name\""

#: The final text of each session — what the fixture answers past its last tool turn too.
PLAN_DONE = PLAN_TEXT
IMPLEMENT_DONE = (
    "Done: bin/greet now prints the exclamation mark; sh tests/check.sh passes."
)


#: The greeter, as every tool call names it — relative to the working tree, which the CLI
#: resolves against its ``cwd`` and the policy hook against the run's tree, so the recording
#: carries no machine's path and replays over any tree.
GREETER = "bin/greet"


def plan_script() -> list[Turn]:
    """The plan session's turns.

    Returns:
        Glob, read the script, read the test, then the plan.
    """
    return [
        Turn("Reading the greeter and its test.", [("Glob", {"pattern": GREETER})]),
        Turn(None, [("Read", {"file_path": GREETER})]),
        Turn(None, [("Read", {"file_path": "tests/check.sh"})]),
        Turn(PLAN_DONE),
    ]


def implement_script() -> list[Turn]:
    """The implement session's turns, with the deliberate failure.

    Returns:
        Glob, read, a wrong edit (refused by the tool), the right edit, done.
    """
    script = GREETER
    return [
        Turn("Finding the greeter script.", [("Glob", {"pattern": "bin/greet"})]),
        Turn(None, [("Read", {"file_path": script})]),
        Turn(
            "Adding the exclamation mark the README promises.",
            [
                (
                    "Edit",
                    {
                        "file_path": script,
                        "old_string": 'echo "Hello, $name"',
                        "new_string": 'echo "Hello, $name!"',
                    },
                )
            ],
        ),
        Turn(
            "The script uses printf, not echo — correcting the edit.",
            [
                (
                    "Edit",
                    {
                        "file_path": script,
                        "old_string": BROKEN_LINE,
                        "new_string": FIXED_LINE,
                    },
                )
            ],
        ),
        Turn(IMPLEMENT_DONE),
    ]


@dataclass
class CapturingFacade(Facade):
    """The scripted facade, remembering each main request's headers too.

    Attributes:
        headers: Lower-cased headers, one entry per request, in arrival order.
    """

    headers: list[dict[str, str]] = field(default_factory=list)

    def answer(
        self, body: dict[str, Any], headers: dict[str, str]
    ) -> list[dict[str, Any]]:
        """Log the headers, then answer as the script says.

        Args:
            body: The request body.
            headers: Its headers, lower-cased.

        Returns:
            The assistant's content blocks.
        """
        with self.lock:
            self.headers.append(dict(headers))
        return super().answer(body, headers)


def stage_context(tree: Path, stage: str, prompt: str) -> StageContext:
    """One attempt of ``stage`` over ``tree`` under L5.

    Args:
        tree: The working tree.
        stage: ``plan`` or ``implement``.
        prompt: The rendered prompt.

    Returns:
        The context, routed to the slice workspace's alias for the stage.
    """
    return StageContext(
        run_id="0b5e0160-0000-4000-8000-000000001314",
        stage_key=stage,
        attempt=1,
        prompt=prompt,
        model=SESSIONS[stage]["alias"],
        policy=ToolPolicy(
            working_tree=str(tree),
            permissions=LlmPermissions(push_fixup=False, touch_ci=False),
            protected_paths=(),
        ),
    )


def make_tree(tmp_path: Path, name: str) -> Path:
    """A run directory holding a copy of the fixture repository as its tree.

    Args:
        tmp_path: The test's directory.
        name: The run directory's name under it.

    Returns:
        ``<tmp>/<name>/tree``.
    """
    tree = tmp_path / name / "tree"
    shutil.copytree(FIXTURE_TREE, tree)
    return tree


def run_session(
    tree: Path, stage: str, prompt: str, *, rest_url: str, cli_path: Path
) -> tuple[list[StageEvent], ClaudeAgentExecutor]:
    """Run one stage attempt through the real executor and CLI.

    Args:
        tree: The working tree.
        stage: ``plan`` or ``implement``.
        prompt: The rendered prompt.
        rest_url: Where the Messages server answers (the facade path is appended).
        cli_path: The bundled CLI.

    Returns:
        The events streamed, and the executor (its ``outcome`` says how it ended).
    """
    executor = ClaudeAgentExecutor(
        FakeCredentials(), rest_url=rest_url, cli_path=cli_path
    )

    async def collect() -> list[StageEvent]:
        return [
            event async for event in executor.run(stage_context(tree, stage, prompt))
        ]

    return asyncio.run(collect()), executor


def _tool_results(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The tool results the last user message carries — what a turn expects.

    Args:
        messages: A request's history.

    Returns:
        ``{"tool_use_id", "is_error"}`` per result block, in order; empty for a plain turn.
    """
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            return []
        return [
            {
                "tool_use_id": block.get("tool_use_id"),
                "is_error": bool(block.get("is_error", False)),
            }
            for block in content
            if isinstance(block, dict) and block.get("type") == "tool_result"
        ]
    return []


def _record_session(
    tmp_path: Path, stage: str, prompt: str, script_for: Any, cli_path: Path
) -> tuple[dict[str, Any], dict[str, Any], Path]:
    """Run one session against the scripted facade and shape what it captured.

    Args:
        tmp_path: The test's directory.
        stage: ``plan`` or ``implement``.
        prompt: The rendered prompt.
        script_for: ``plan_script`` or ``implement_script``.
        cli_path: The bundled CLI.

    Returns:
        The session's recording entry, the harness facts seen (betas, version, tools),
        and the tree the session ran over.

    Raises:
        AssertionError: When the session did not complete, or a main request's turn was
            not answered by the script in order.
    """
    tree = make_tree(tmp_path, stage)
    script = script_for()
    facade = CapturingFacade(script)
    server = serve(facade)
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}"
        _events, executor = run_session(
            tree, stage, prompt, rest_url=url, cli_path=cli_path
        )
    finally:
        server.shutdown()
        server.server_close()

    outcome = executor.outcome
    assert outcome is not None and outcome.status == "completed", (
        f"the {stage} session did not complete: {outcome}"
    )

    with facade.lock:
        requests = list(facade.requests)
        headers = list(facade.headers)
    main = [
        (request, header)
        for request, header in zip(requests, headers, strict=True)
        if request.get("main")
    ]
    assert [request["turn"] for request, _ in main] == list(range(len(script))), (
        f"the {stage} session's main requests did not walk the script in order: "
        f"{[request['turn'] for request, _ in main]}"
    )

    turns: list[dict[str, Any]] = []
    for index, (request, _header) in enumerate(main):
        scripted = script[index]
        content: list[dict[str, Any]] = []
        if scripted.text:
            content.append({"type": "text", "text": scripted.text})
        for tool_index, (name, tool_input) in enumerate(scripted.tools):
            content.append(
                {
                    "type": "tool_use",
                    "id": f"toolu_{index:02d}_{tool_index}",
                    "name": name,
                    "input": tool_input,
                }
            )
        turns.append(
            {
                "expect": {
                    "tool_results": _tool_results(json.loads(request["history"]))
                },
                "content": content,
            }
        )

    betas = {
        beta.strip()
        for _request, header in main
        for beta in header.get("anthropic-beta", "").split(",")
        if beta.strip()
    }
    versions = {header.get("anthropic-version", "") for _request, header in main}
    tools = sorted({tool for request, _ in main for tool in request["tools"]})
    harness = {
        "anthropic_beta": sorted(betas),
        "anthropic_version": versions,
        "tools": tools,
    }
    session = {
        **SESSIONS[stage],
        "prompt_prefix": prompt.split("\n", 1)[0],
        "turns": turns,
    }
    return session, harness, tree


def sha256_of(path: Path) -> str:
    """A file's SHA-256, hex.

    Args:
        path: The file.

    Returns:
        Sixty-four hex characters.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


def harness_versions() -> dict[str, str]:
    """The pinned SDK and the CLI it bundles.

    Returns:
        ``{"sdk", "cli"}``.
    """
    from claude_agent_sdk import __version__ as sdk_version
    from claude_agent_sdk._cli_version import (
        __cli_version__ as cli_version,
    )

    return {"sdk": sdk_version, "cli": cli_version}


def record(tmp_path: Path) -> dict[str, Any]:
    """Run both sessions with the pinned harness and shape the recording.

    Args:
        tmp_path: The test's directory.

    Returns:
        The recording document (``recorded_at`` is now).

    Raises:
        AssertionError: When a session did not complete, the two sessions disagreed on
            the harness's facts, or the implement session left ``bin/greet`` unfixed.
    """
    assert CLI is not None, "the bundled Claude Agent CLI is absent"
    plan, plan_harness, _plan_tree = _record_session(
        tmp_path, "plan", PLAN_PROMPT, plan_script, CLI
    )
    implement, implement_harness, implement_tree = _record_session(
        tmp_path, "implement", IMPLEMENT_PROMPT, implement_script, CLI
    )
    assert plan_harness == implement_harness, (
        f"the two sessions saw different harness facts: {plan_harness} / {implement_harness}"
    )
    assert len(implement_harness["anthropic_version"]) == 1, (
        f"more than one API version seen: {implement_harness['anthropic_version']}"
    )

    greeter = implement_tree / "bin" / "greet"
    assert (
        FIXED_LINE in greeter.read_text() and BROKEN_LINE not in greeter.read_text()
    ), f"the implement session left bin/greet unfixed:\n{greeter.read_text()}"
    implement["files_after"] = {"bin/greet": sha256_of(greeter)}

    return {
        "recording": "live-slice",
        "format": 1,
        "source": {
            "issue": f"acme-robotics/helios-greeter#1 — {ISSUE_TITLE}",
            "repository": "acme-robotics/helios-greeter "
            "(tests/e2e/fixtures/git-stub/repos/acme-robotics/helios-greeter)",
            "workflow": "live-slice@v1 (R__dev_seed_live_slice.sql)",
            "produced_by": "ouroboros-engine/tests/test_live_slice_recording.py "
            "with OURO_RECORD_LIVE_SLICE=1",
            "model_turns": "scripted in ouroboros-engine/tests/live_slice_recording.py; "
            "the harness's requests, tool results and the files it left are captured "
            "from a run of the pinned claude-agent-sdk",
        },
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "harness": {
            **harness_versions(),
            "anthropic_version": next(iter(implement_harness["anthropic_version"])),
            "anthropic_beta": implement_harness["anthropic_beta"],
            "tools": implement_harness["tools"],
        },
        "side_traffic": [{"type": "text", "text": "ok"}],
        "sessions": {"plan": plan, "implement": implement},
    }


def without_timestamp(recording: dict[str, Any]) -> dict[str, Any]:
    """A recording with its one volatile field removed, for comparison.

    Args:
        recording: The document.

    Returns:
        The same document without ``recorded_at``.
    """
    return {key: value for key, value in recording.items() if key != "recorded_at"}
