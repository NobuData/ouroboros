"""The parts every scenario shares: the walk up to ``implement``, and the walk out of it.

Every scenario runs ``standard-fix`` v14, the development seeds' pinned workflow, whose node
ids are the stage keys used here::

    issue-queued → analyze → effort-recheck ─┬─ plan → implement → build → test → review
                                             │                                      │
                                             └─ split → back-to-queue   checks-green ┤
                                                                ↺ implement ─ fail ─┘
                                                                  open-pr ─ pass ───┘

The issue is ``≤ M``, so ``effort-recheck`` takes the ``plan`` branch and ``split`` and
``back-to-queue`` are reported ``skipped``: a stage the path avoided, which the stepper
does not draw.

Scripted durations follow mockup 10: queued 4 s, analyze 1 m 12 s, plan 2 m 05 s. They are
divided by the clock's speed.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from ouroboros_engine.control_plane.ingest import (
    FileStatus,
    IngestFile,
    IngestHunk,
    IngestHunkLine,
)
from ouroboros_simulator.session import STEER_QUOTE_LIMIT, RunSession, Steer

#: The provider every spend is attributed to: the one that serves the run's model.
PROVIDER = "anthropic"

#: What a scenario ends as. ``aborted`` comes from the session, not from a script.
Outcome = Literal["completed", "needs_human", "aborted"]


@dataclass(frozen=True)
class Scenario:
    """One scripted lifecycle.

    Attributes:
        name: What the CLI and the dev endpoint call it: ``482-gate-return``.
        summary: One line, for ``--list`` and ``GET /dev/scenarios``.
        branch: The branch the run works on.
        script: Drives an **open** session to its end and says how it ended.
    """

    name: str
    summary: str
    branch: str
    script: Callable[[RunSession], Outcome]


def prelude(session: RunSession) -> None:
    """Walk from the queue to the start of ``implement``, as mockup 10's first three stages.

    Args:
        session: The open run.
    """
    session.stage("issue-queued", "active")
    session.system(
        "Picked up from the queue. Simulated run: nothing here was said by a model."
    )
    session.work(4)
    session.stage("issue-queued", "succeeded")

    session.stage("analyze", "active")
    session.tool("read_file", "drivers/can/telemetry_buf.c")
    session.work(40)
    session.model(
        "The failing assertion is on frame order in tests/telemetry. The CAN RX path and the "
        "telemetry thread share one buffer; the change stays inside drivers/can and its test."
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=18000,
        tokens_out=6000,
        cost_cents="12.0000",
        task_kind="analyze",
    )
    session.work(32)
    session.stage("analyze", "succeeded")

    session.stage("effort-recheck", "active")
    session.gate("Effort M: within the ≤ M branch, continuing to plan.")
    session.stage("effort-recheck", "succeeded")
    session.stage("split", "skipped")
    session.stage("back-to-queue", "skipped")

    session.stage("plan", "active")
    session.work(55)
    session.plan(
        "Root cause: test asserts on frame order; CAN driver ISR can reorder under load."
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=29000,
        tokens_out=9000,
        cost_cents="20.0000",
        task_kind="plan",
    )
    session.work(70)
    session.stage("plan", "succeeded")


def delivery(session: RunSession, *, gate_attempt: int = 1) -> None:
    """Walk from a finished ``implement`` to a merged pull request.

    Ends with ``open-pr`` succeeded. The run's ``status`` is not moved: the ingestion
    contract has no operation for it (AP.1, decision 4), and a terminal node's action is
    WF-T.6's to carry out. The merge is reported as a transcript entry.

    Args:
        session: The open run.
        gate_attempt: Which attempt at ``checks-green`` this is. 2 after a gate return.
    """
    session.stage("build", "active")
    session.tool(
        "build", "west build -b native_sim", {"result": "build ok · 0 warnings"}
    )
    session.work(45)
    session.stage("build", "succeeded")

    session.stage("test", "active")
    session.tool("run_tests", "twister -T tests/telemetry --load-profile")
    session.work(60)
    session.tool(
        "run_tests",
        "twister -T tests/telemetry --load-profile",
        {"result": "63 passed, 0 failed"},
    )
    session.stage("test", "succeeded")

    session.stage("review", "active")
    session.work(40)
    session.model(
        "The diff stays inside the plan: drivers/can and its test. No CI configuration "
        "touched."
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=14000,
        tokens_out=3000,
        cost_cents="9.0000",
        task_kind="review",
    )
    session.stage("review", "succeeded")

    session.stage("checks-green", "active", attempt=gate_attempt)
    session.gate("build ✓ · test ✓ · review ✓ — all required checks passed")
    session.stage("checks-green", "succeeded", attempt=gate_attempt)

    session.stage("open-pr", "active")
    session.system(
        f"Opened a pull request from {session.branch}, squash auto-merge enabled."
    )
    session.work(20)
    session.system("Required checks passed and the pull request merged. Simulated run.")
    session.stage("open-pr", "succeeded")


def quote(steer: Steer) -> str:
    """Quote a steer back in a transcript entry, shortened.

    Args:
        steer: The steer.

    Returns:
        Its text in quotes, cut to :data:`STEER_QUOTE_LIMIT` characters.
    """
    text = " ".join(steer.text.split())
    if len(text) > STEER_QUOTE_LIMIT:
        text = text[: STEER_QUOTE_LIMIT - 1] + "…"
    return f"“{text}”"


def diff(lines: list[tuple[str, str]]) -> dict[str, object]:
    """A transcript payload for an ``edit_file`` entry.

    Args:
        lines: ``(kind, text)`` pairs, ``kind`` one of ``ctx``, ``del`` and ``add``.

    Returns:
        ``{"hunks": [{"kind", "text"}, …]}``, the shape V046 types.
    """
    return {"hunks": [{"kind": kind, "text": text} for kind, text in lines]}


def changed(
    path: str,
    status: FileStatus,
    additions: int,
    deletions: int,
    hunk: tuple[int, list[tuple[str, str]]] | None = None,
) -> IngestFile:
    """One file of a change-set.

    Args:
        path: Relative to the repository root.
        status: ``added``, ``modified``, ``deleted`` or ``renamed``.
        additions: Lines added against the base.
        deletions: Lines removed against the base.
        hunk: ``(new_start, [(kind, text), …])``, sent so the secrets check has content
            to scan. A change-set with no hunks is ``not_applicable`` for secrets.

    Returns:
        The file.
    """
    hunks = (
        None
        if hunk is None
        else [
            IngestHunk(
                new_start=hunk[0],
                lines=[IngestHunkLine(kind=kind, text=text) for kind, text in hunk[1]],
            )
        ]
    )
    return IngestFile(
        path=path,
        status=status,
        additions=additions,
        deletions=deletions,
        hunks=hunks,
    )


#: Attempt 1's edit to the telemetry buffer, as mockup 10's first diff draws it.
TELEMETRY_EDIT: list[tuple[str, str]] = [
    ("ctx", "/* telemetry frame path */"),
    ("del", "static struct k_fifo tel_fifo;"),
    ("del", "k_fifo_put(&tel_fifo, tx_frame);"),
    ("del", "rx = k_fifo_get(&tel_fifo, K_FOREVER);"),
    (
        "add",
        "K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);",
    ),
    ("add", "tx_frame->seq = atomic_inc(&tel_seq);"),
    ("add", "k_msgq_put(&tel_msgq, tx_frame, K_NO_WAIT);"),
    ("add", "k_msgq_get(&tel_msgq, &rx, K_FOREVER);"),
]

#: The new test the change adds.
TEST_ADDED: list[tuple[str, str]] = [
    ("add", "ZTEST(telemetry, test_frame_order_under_load)"),
    ("add", "{"),
    ("add", '\tzassert_true(frames_in_order(&capture), "frames reordered");'),
    ("add", "}"),
]
