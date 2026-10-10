"""Fakes for the dry-run harness suites (CD.2, #560).

The seeded ``security-patch`` draft as a document, the repository it reads, a reader that
records every call, a model that answers from a script, and an estimator that answers from
recorded history. Nothing here reaches a network.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from typing import Any

from ouroboros_engine.dryrun.contract import DryRunRequest
from ouroboros_engine.dryrun.estimates import (
    EstimateUnavailableError,
    InfraKind,
    ReplayedStage,
)
from ouroboros_engine.dryrun.harness import DryRunHarness
from ouroboros_engine.dryrun.model import StageCall
from ouroboros_engine.dryrun.workspace import (
    ReadCache,
    Tree,
    TreeEntry,
    WorkspaceError,
)
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelAnswer,
    ModelFailureError,
)

DRY_RUN = "5eed008b-0000-4000-8000-000000000001"
SHA = "8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2"
SLUG = "acme-robotics/helios-firmware"
TOKEN = "ghs_dry_run_read_token"

ARBITRATION = "drivers/can/arbitration.c"

#: The repository at the pinned commit.
FILES: dict[str, str] = {
    ARBITRATION: (
        "static void can_handle_tx_error(const struct device *dev)\n"
        "{\n"
        "\tif (err & CAN_ERR_LOSTARB) {\n"
        "\t\tcan_retry_tx(dev, frame); /* immediate retry floods the bus */\n"
        "\t}\n"
        "}\n"
    ),
    "drivers/can/can.h": "#define CAN_ERR_LOSTARB 0x02\n",
    "drivers/can/Kconfig": 'config CAN\n\tbool "CAN bus"\n',
    "tests/can/test_arbitration.c": "ZTEST(can, test_retry) { zassert_true(true); }\n",
    "README.md": "# helios-firmware\n",
}

#: ``arbitration.c`` with the backoff the implementer drafts.
PATCHED = FILES[ARBITRATION].replace(
    "\t\tcan_retry_tx(dev, frame); /* immediate retry floods the bus */\n",
    "\t\tk_sleep(K_USEC(backoff_us)); /* exponential backoff */\n"
    "\t\tbackoff_us = MIN(backoff_us << 1, CAN_ARB_BACKOFF_MAX_US);\n"
    "\t\tcan_retry_tx(dev, frame);\n",
)


def _llm(node_id: str, title: str, prompt: str, routing: dict, **extra: Any) -> dict:
    return {
        "id": node_id,
        "type": "llm",
        "title": title,
        "position": {"x": 0, "y": 0},
        "config": {
            "mode": "prompt",
            "prompt_template": prompt,
            "routing": routing,
            "limits": {"max_retries": 1, "token_budget": 200000},
            "permissions": {"push_fixup": False, "touch_ci": False},
            **extra,
        },
    }


def definition() -> dict:
    """The seeded ``security-patch`` draft, v0.3: nine stages after the trigger."""
    pinned = {"pinned_model": {"alias": "coder-std"}}
    nodes = [
        {
            "id": "trigger",
            "type": "trigger",
            "title": "trigger",
            "position": {"x": 0, "y": 0},
            "config": {},
        },
        _llm(
            "analyze",
            "analyze",
            "Map the code paths {{issue.title}} touches.",
            pinned,
            mode="skill",
            skill="advisory-db",
        ),
        _llm("plan", "plan", "Plan the fix for {{ issue.key }}.", pinned),
        _llm("implement", "implement", "Implement the plan.", {"inherit_task": "code"}),
        {
            "id": "build",
            "type": "infra",
            "title": "build",
            "position": {"x": 0, "y": 0},
            "config": {"runner_pool": "pool-a"},
        },
        {
            "id": "test",
            "type": "infra",
            "title": "test",
            "position": {"x": 0, "y": 0},
            "config": {"command": "west twister -T tests"},
        },
        _llm(
            "review-primary", "review", "Review the change.", {"inherit_task": "review"}
        ),
        _llm("review-second", "review", "Review the change again.", pinned),
        {
            "id": "open-pr",
            "type": "term",
            "title": "open PR",
            "position": {"x": 0, "y": 0},
            "config": {"action": "needs_review", "options": {}},
        },
        _llm(
            "exploit-verify",
            "exploit-verify",
            "Re-run the CVE proof-of-concept against the patched build.",
            {"inherit_task": "exploit-verify"},
        ),
    ]
    chain = [
        "trigger",
        "analyze",
        "plan",
        "implement",
        "build",
        "test",
        "exploit-verify",
    ]
    edges = [{"from": a, "to": b, "kind": "default"} for a, b in pairwise(chain)]
    for reviewer in ("review-primary", "review-second"):
        edges.append({"from": "exploit-verify", "to": reviewer, "kind": "default"})
        edges.append({"from": reviewer, "to": "open-pr", "kind": "default"})
    return {
        "dsl_version": "1.0",
        "trigger": {"event": "ticket_queued", "conditions": {"labels": ["security"]}},
        "nodes": nodes,
        "edges": edges,
    }


#: What routing and context assembly resolved: everything but ``exploit-verify``.
STAGES: dict[str, dict] = {
    "analyze": {
        "alias": "coder-std",
        "skill_resolved": False,
        "warnings": ["No skill named `advisory-db` is defined in this workspace yet."],
    },
    "plan": {"alias": "coder-std", "manifest": "Repo profile: Zephyr RTOS, C17."},
    "implement": {"alias": "coder-max", "resolution_version": "z1-v7"},
    "review-primary": {"alias": "reviewer"},
    "review-second": {"alias": "coder-std"},
    "exploit-verify": {
        "alias": None,
        "warnings": [
            "No routing task named `exploit-verify` exists in this workspace yet."
        ],
    },
}


def request(**overrides: Any) -> DryRunRequest:
    """The seeded dry run of ``#489``, with anything overridden."""
    body = {
        "dry_run": DRY_RUN,
        "definition": definition(),
        "ticket": {
            "external_key": "#489",
            "source": "github",
            "labels": ["security", "can"],
            "estimate": {"effort": "m"},
            "title": "CAN arbitration retries flood the bus",
            "body": "Lost-arbitration frames are retried at once.",
        },
        "repository": {"slug": SLUG, "pinned_sha": SHA, "token": TOKEN},
        "stages": STAGES,
        **overrides,
    }
    return DryRunRequest.model_validate(body)


class RecordingReader:
    """A repository in memory that remembers every call made to it."""

    def __init__(
        self, files: dict[str, str] | None = None, *, truncated: bool = False
    ) -> None:
        """Hold the files."""
        self.files = dict(FILES if files is None else files)
        self.truncated = truncated
        self.calls: list[tuple[str, str]] = []
        self.fail: WorkspaceError | None = None

    def tree(self) -> Tree:
        """List the files."""
        self.calls.append(("tree", ""))
        if self.fail is not None:
            raise self.fail
        return Tree(
            entries=tuple(
                TreeEntry(path=path, size=len(text.encode()))
                for path, text in sorted(self.files.items())
            ),
            truncated=self.truncated,
        )

    def blob(self, path: str) -> bytes:
        """Read one file."""
        self.calls.append(("blob", path))
        if self.fail is not None:
            raise self.fail
        if path not in self.files:
            raise WorkspaceError("not_found", "no such file at the pinned commit")
        return self.files[path].encode()

    def blobs(self, path: str) -> int:
        """How many times a file was fetched."""
        return self.calls.count(("blob", path))


def tool(name: str, **arguments: Any) -> str:
    """A ``tool`` block."""
    return "```tool\n" + json.dumps({"tool": name, "arguments": arguments}) + "\n```"


def result(**report: Any) -> str:
    """A ``result`` block."""
    return "```result\n" + json.dumps(report) + "\n```"


Turn = str | ModelFailureError | Callable[[StageCall], str]


class ScriptedModel:
    """Answers each stage from its own script of turns, and remembers every call."""

    def __init__(
        self,
        scripts: dict[str, list[Turn]] | None = None,
        *,
        tokens: dict[str, int] | None = None,
        cost: dict[str, float | None] | None = None,
    ) -> None:
        """Script the answers.

        Args:
            scripts: Per stage key, the turns it answers with, in order.
            tokens: Per stage key, the tokens each turn reports (default 1000).
            cost: Per stage key, the cents each turn reports (default 1.0; ``None`` unpriced).
        """
        self.scripts = {key: list(turns) for key, turns in (scripts or happy()).items()}
        self.tokens = tokens or {}
        self.cost = cost or {}
        self.calls: list[StageCall] = []

    def call(self, call: StageCall) -> ModelAnswer:
        """Answer the next turn of the calling stage."""
        self.calls.append(call)
        turns = self.scripts.get(call.stage_key) or []
        if not turns:
            raise AssertionError(f"no scripted turn left for stage {call.stage_key}")
        turn = turns.pop(0)
        if isinstance(turn, ModelFailureError):
            raise turn
        text = turn(call) if callable(turn) else turn
        used = self.tokens.get(call.stage_key, 1000)
        return ModelAnswer(text=text, usage=[self.usage(call.stage_key, used)])

    def usage(self, stage: str, tokens: int) -> CallUsage:
        """One hop's usage for a stage."""
        return CallUsage(
            hop=0,
            connection="conn-anthropic",
            model="claude-sonnet-5",
            input_tokens=tokens - tokens // 10,
            output_tokens=tokens // 10,
            cost_cents=self.cost.get(stage, 1.0),
        )

    def stages_called(self) -> list[str]:
        """Which stages called, in order, without repeats."""
        return list(dict.fromkeys(call.stage_key for call in self.calls))


def happy() -> dict[str, list[Turn]]:
    """The script of the seeded run: analyze, plan, implement, two reviews."""
    return {
        "analyze": [
            tool("search", query="LOSTARB")
            + "\n"
            + tool("read_file", path=ARBITRATION)
            + "\n"
            + tool("read_file", path="drivers/can/can.h"),
            tool("read_file", path="drivers/can/Kconfig")
            + "\n"
            + tool("read_file", path="tests/can/test_arbitration.c"),
            result(summary="The retry path is in arbitration.c."),
        ],
        "plan": [
            result(
                summary="Back off before retrying.",
                steps=[
                    "Add a backoff counter",
                    "Sleep before retry",
                    "Cap the backoff",
                ],
                would_touch=[ARBITRATION],
            )
        ],
        "implement": [
            tool("read_file", path=ARBITRATION),
            tool("edit_file", path=ARBITRATION, content=PATCHED) + "\n" + tool("build"),
            result(summary="Drafted the backoff."),
        ],
        "review-primary": [
            tool("read_file", path=ARBITRATION),
            result(
                summary="Correct.",
                verdict="approve",
                nits=[{"kind": "style", "text": "Name the 50 us constant."}],
            ),
        ],
        "review-second": [result(summary="Fine.", verdict="approve")],
    }


BUILD_NOTE = "est. 4m 02s (214 similar builds, ±20s)".replace("±", chr(0xB1))


class RecordedEstimates:
    """Answers from recorded history, and remembers what it was asked."""

    def __init__(self) -> None:
        """Start with the seeded history: builds measured, tests not."""
        self.asked: list[tuple[str, InfraKind, str | None, str | None]] = []
        self.fail: EstimateUnavailableError | None = None

    def estimate(
        self,
        dry_run: str,
        kind: InfraKind,
        *,
        runner_pool: str | None,
        command: str | None,
    ) -> ReplayedStage:
        """Answer one estimate."""
        self.asked.append((dry_run, kind, runner_pool, command))
        if self.fail is not None:
            raise self.fail
        if kind == "build":
            return ReplayedStage(
                note=BUILD_NOTE,
                metrics={
                    "estimate_ms": 242000,
                    "spread_ms": 20000,
                    "sample_count": 214,
                    "similarity_class": "pool-a · helios-firmware",
                    "window_days": 30,
                },
            )
        return ReplayedStage(
            note="insufficient history — the first real run will measure this "
            "(0 similar runs found)",
            metrics={
                "insufficient_history": True,
                "sample_count": 0,
                "similarity_class": "helios-firmware · tests",
                "window_days": 30,
            },
        )


class TickingClock:
    """A clock that advances a second every time it is read."""

    def __init__(self) -> None:
        """Start at a fixed instant."""
        self.now = datetime(2026, 10, 10, 12, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        """Read the time, then move it on."""
        current = self.now
        self.now += timedelta(seconds=1)
        return current


class Bench:
    """A harness over fakes, and the fakes."""

    def __init__(
        self,
        model: ScriptedModel | None = None,
        reader: RecordingReader | None = None,
        estimates: RecordedEstimates | None = None,
        cache: ReadCache | None = None,
    ) -> None:
        """Assemble the harness."""
        self.model = model or ScriptedModel()
        self.reader = reader or RecordingReader()
        self.estimates = estimates or RecordedEstimates()
        self.cache = cache if cache is not None else ReadCache()
        self.repositories: list[Any] = []
        self.harness = DryRunHarness(
            self.model,
            self.estimates,
            cache=self.cache,
            reader_factory=self._reader,
            clock=TickingClock(),
        )

    def _reader(self, repository: Any) -> RecordingReader:
        self.repositories.append(repository)
        return self.reader

    def run(self, **overrides: Any) -> tuple[list[Any], Any]:
        """Run the seeded dry run; answer its events and its result."""
        events = list(self.harness.run(request(**overrides)))
        return events, events[-1].result
