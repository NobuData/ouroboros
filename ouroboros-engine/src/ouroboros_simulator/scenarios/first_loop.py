"""``first-loop``: the wizard's first run — a docs-only typo sweep on ``quick-fixes`` v1.

Every other scenario is scripted on ``standard-fix`` v14's node ids. The Get Started
wizard's first loop (`#395 <https://github.com/NobuData/ouroboros/issues/395>`_, BC.6)
pins the **``quick-fixes`` v1 template** instead — the one V068 ships as *recommended
first workflow* — and the control plane refuses a stage key the pinned document lacks
(``stageNotInPin``). So this script uses exactly that template's seven nodes, along its
one path::

    issue-queued → analyze → plan → code → build → test → open-pr

No ``effort-recheck``, no ``split``, no ``review`` and no ``checks-green``: the template
has none of them, and a transition naming one would be refused. The run has to be opened
pinned to ``quick-fixes`` v1 (``--workflow quick-fixes --workflow-version 1``); the
:class:`~ouroboros_simulator.session.Target` default is ``standard-fix``.

The work is mockup 13's. The first issue the wizard picks is a typo sweep over the
operator documents, so the change-set is two ``modified`` Markdown files under ``docs/``
and nothing else — no source, no CI file, no protected path — and every guardrail passes.
The hunks put right the five misspellings the sandbox tracker's ``helios-bootloader``
fixture spells (``tests/e2e/fixtures/tracker-stub/repos/acme-robotics/helios-bootloader/
docs/``), so the transcript and the repository the wizard scanned tell one story.

The terminal is *Open PR & auto-merge*, but the wizard's **dry-run** policy keeps the
pull request a draft: the last lines say *draft*, and never *merged*.

Scripted durations total about two and a half minutes — mockup 13's "about 4 minutes"
ballpark — and are divided by the clock's speed as every scenario's are.
"""

from ouroboros_simulator.scenarios.common import (
    PROVIDER,
    Outcome,
    Scenario,
    changed,
    diff,
)
from ouroboros_simulator.session import RunSession

#: The two documents the sweep edits, as the fixture repository lays them out.
MANUAL = "docs/operator-manual.md"
GUIDE = "docs/pairing-guide.md"

#: The manual's *Recovery mode* section with its three misspellings put right — one hunk,
#: starting at the heading.
MANUAL_EDIT: list[tuple[str, str]] = [
    ("ctx", "## Recovery mode"),
    ("ctx", ""),
    ("del", "Hold the pairing button while power is applied to recieve a recovery"),
    ("add", "Hold the pairing button while power is applied to receive a recovery"),
    ("ctx", "image over the serial console. The bootloader answers"),
    ("ctx", "`helios-recovery>` at 115200 baud and takes the image in 512-byte"),
    ("del", "chunks. Keep recovery images in a seperate directory from release"),
    ("add", "chunks. Keep recovery images in a separate directory from release"),
    ("ctx", "images, so a field update cannot pick up the wrong one. If a failure"),
    ("del", "has occured three times in a row the unit stays in recovery mode"),
    ("add", "has occurred three times in a row the unit stays in recovery mode"),
    ("ctx", "until a person clears it."),
]

#: The guide's two, which sit close enough to share one hunk across the *Pairing* heading.
GUIDE_EDIT: list[tuple[str, str]] = [
    ("ctx", "LED means the bootloader is still verifying the image and will not"),
    ("del", "answer a pairing request, so do not start untill it has gone out."),
    ("add", "answer a pairing request, so do not start until it has gone out."),
    ("ctx", ""),
    ("ctx", "## Pairing"),
    ("ctx", ""),
    ("ctx", "1. On the console, choose *Pair a unit*, type the serial number and"),
    ("del", "   confirm the Bluetooth adress it shows matches the label."),
    ("add", "   confirm the Bluetooth address it shows matches the label."),
    ("ctx", "2. Press the pairing button on the unit once. The green LED blinks"),
]


def run(session: RunSession) -> Outcome:
    """Walk ``quick-fixes`` v1 once, from the queue to a draft pull request.

    Args:
        session: The open run, pinned to ``quick-fixes`` v1.

    Returns:
        ``completed``.
    """
    session.stage("issue-queued", "active")
    session.system(
        "Picked up from the queue. Simulated run: nothing here was said by a model."
    )
    session.work(4)
    session.stage("issue-queued", "succeeded")

    session.stage("analyze", "active")
    session.tool("read_file", MANUAL)
    session.tool("read_file", GUIDE)
    session.work(18)
    session.model(
        "The issue is a typo sweep over the operator documents. Five misspellings in two "
        "files: recieve, seperate and occured in docs/operator-manual.md; untill and "
        "adress in docs/pairing-guide.md. Prose only — no source file, build file or "
        "protected path is involved."
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=9000,
        tokens_out=1500,
        cost_cents="5.0000",
        task_kind="analyze",
    )
    session.work(10)
    session.stage("analyze", "succeeded")

    session.stage("plan", "active")
    session.work(12)
    session.plan(
        "Fix the five misspellings in place, in one commit, and change nothing else: "
        "wording, line breaks and headings stay as they are, so the diff reads as "
        "spelling only."
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=11000,
        tokens_out=2000,
        cost_cents="7.0000",
        task_kind="plan",
    )
    session.work(8)
    session.stage("plan", "succeeded")

    session.stage("code", "active")
    session.work(20)
    session.model(
        "Three fixes in the manual's Recovery mode section and two in the pairing guide's "
        "first steps. Every edited line keeps within the documents' wrap, so nothing "
        "reflows."
    )
    session.tool("edit_file", MANUAL, diff(MANUAL_EDIT))
    session.tool("edit_file", GUIDE, diff(GUIDE_EDIT))
    session.work(15)
    session.files(
        [
            changed(MANUAL, "modified", 3, 3, (16, MANUAL_EDIT)),
            changed(GUIDE, "modified", 2, 2, (11, GUIDE_EDIT)),
        ]
    )
    session.commit("d19e4b7", "docs: fix typos in operator manual and pairing guide")
    session.spend(
        provider=PROVIDER,
        tokens_in=16000,
        tokens_out=4000,
        cost_cents="12.0000",
        task_kind="implement",
    )
    session.stage("code", "succeeded")

    session.stage("build", "active")
    session.tool(
        "build", "west build -b native_sim", {"result": "build ok · 0 warnings"}
    )
    session.work(30)
    session.stage("build", "succeeded")

    session.stage("test", "active")
    session.tool("run_tests", "twister -T tests/image_verify")
    session.work(25)
    session.tool(
        "run_tests", "twister -T tests/image_verify", {"result": "4 passed, 0 failed"}
    )
    session.stage("test", "succeeded")

    session.stage("open-pr", "active")
    session.system(
        f"Opened a draft pull request from {session.branch} — dry-run leaves it a draft."
    )
    session.work(10)
    session.system(
        "Required checks passed. Dry-run keeps the pull request a draft for a person to "
        "merge. Simulated run."
    )
    session.stage("open-pr", "succeeded")
    return "completed"


SCENARIO = Scenario(
    name="first-loop",
    summary="The Get Started wizard's first run, on quick-fixes v1: a docs-only typo "
    "sweep of two Markdown files, clean guardrails, a draft PR under dry-run.",
    branch="loop/typo-sweep-docs",
    script=run,
)
