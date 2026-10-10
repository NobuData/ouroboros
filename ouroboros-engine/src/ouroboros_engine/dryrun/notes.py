"""The card's note lines, composed — never written by a model (CD.2, #560).

Each result row of the dry-run card ends in a line like ``diff drafted +41 -9 (below) · 84k
tokens`` or ``both approve · 1 style nit`` (the card prints a true minus sign, :data:`MINUS`). Those lines are **functions of the stage's
outputs**: the same outputs compose the same text, every time, so a re-run that behaves the
same reads the same and a golden test can hold the wording.

Which line a model stage gets is decided by what it *did*, in this order — not by what it is
called:

1. it changed the simulated diff → ``diff drafted +A -R (below) · Nk tokens``
2. it gave a review verdict → ``approves`` / ``both approve`` / ``1 of 2 approve`` …
3. it gave plan steps → ``3 steps · would touch <file>``
4. it read files → ``mapped 4 files``
5. otherwise → ``completed · Nk tokens``

A skill the workspace has not defined yet (decision W7) adds a clause saying the stage ran
without it.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from ouroboros_engine.workflows.dsl import OpenPrAutomergeOptions, TermConfig

from .protocol import Nit, StageReport

#: The separator between a note's clauses — the mockup's middle dot.
SEPARATOR: Final = " · "

#: The minus sign the card prints before removed lines.
MINUS: Final = chr(0x2212)

#: The multiplication sign between a title and its count, as in a doubled review row.
TIMES: Final = chr(0xD7)

#: How many reviewers the word "both" stands for.
_BOTH: Final = 2


def tokens_label(tokens: int) -> str:
    """Print a token count the way the card does.

    Args:
        tokens: The count.

    Returns:
        ``840 tokens`` below a thousand, ``84k tokens`` from there, rounded half up.
    """
    if tokens < 1000:
        return f"{tokens} tokens"
    return f"{(tokens + 500) // 1000}k tokens"


def plural(count: int, noun: str) -> str:
    """Count a noun.

    Args:
        count: How many.
        noun: The singular.

    Returns:
        ``1 step``, ``3 steps``.
    """
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def diff_note(added: int, removed: int, tokens: int) -> str:
    """The note of a stage that changed the simulated diff.

    Args:
        added: Lines the stage added.
        removed: Lines it removed.
        tokens: Tokens it used.

    Returns:
        ``diff drafted +41 -9 (below) · 84k tokens``, with :data:`MINUS` for the hyphen.
    """
    return f"diff drafted +{added} {MINUS}{removed} (below){SEPARATOR}{tokens_label(tokens)}"


def review_note(reports: Sequence[StageReport]) -> str:
    """The note of one review stage, or of several sharing a row.

    Args:
        reports: Each reviewer's report, all carrying a verdict.

    Returns:
        ``approves`` or ``requests changes`` for one; ``both approve``, ``all 3 approve``,
        ``1 of 2 approve`` or ``none of 2 approve`` for several — followed by the nits,
        named by their kind when they all share one (``1 style nit``).
    """
    approvals = sum(report.verdict == "approve" for report in reports)
    total = len(reports)
    if total == 1:
        head = "approves" if approvals else "requests changes"
    elif approvals == total:
        head = "both approve" if total == _BOTH else f"all {total} approve"
    elif approvals == 0:
        head = f"none of {total} approve"
    else:
        head = f"{approvals} of {total} approve"

    nits: list[Nit] = [nit for report in reports for nit in report.nits]
    if not nits:
        return head
    kinds = {nit.kind for nit in nits}
    noun = f"{next(iter(kinds))} nit" if len(kinds) == 1 and "" not in kinds else "nit"
    return f"{head}{SEPARATOR}{plural(len(nits), noun)}"


def plan_note(report: StageReport) -> str:
    """The note of a stage that planned.

    Args:
        report: Its report, with at least one step.

    Returns:
        ``3 steps · would touch drivers/can/arbitration.c``, with ``+2 more`` after the
        first file when there are several, and no second clause when it named none.
    """
    head = plural(len(report.steps), "step")
    if not report.would_touch:
        return head
    more = len(report.would_touch) - 1
    files = report.would_touch[0] + (f" +{more} more" if more else "")
    return f"{head}{SEPARATOR}would touch {files}"


def llm_note(
    reports: Sequence[StageReport],
    *,
    added: int,
    removed: int,
    wrote: bool,
    files_read: int,
    tokens: int,
    missing_skills: Sequence[str] = (),
) -> str:
    """Compose a model stage's note from what it did.

    Args:
        reports: The report of each node the row stands for.
        added: Lines the row's stages added to the simulated diff.
        removed: Lines they removed.
        wrote: Whether they changed the simulated diff at all.
        files_read: Distinct files they read.
        tokens: Tokens they used.
        missing_skills: Skills the stages name that the workspace has not defined.

    Returns:
        The note line.
    """
    if wrote:
        note = diff_note(added, removed, tokens)
    elif reports and all(report.verdict is not None for report in reports):
        note = review_note(reports)
    elif len(reports) == 1 and reports[0].steps:
        note = plan_note(reports[0])
    elif files_read:
        note = f"mapped {plural(files_read, 'file')}"
    else:
        note = f"completed{SEPARATOR}{tokens_label(tokens)}"

    for skill in dict.fromkeys(missing_skills):
        note += f"{SEPARATOR}skill {skill} skipped (not defined yet)"
    return note


def terminal_note(config: TermConfig) -> str:
    """Say what a terminal would do, in the conditional — a dry run does none of it.

    Args:
        config: The terminal's config.

    Returns:
        The note of the row a dry run never reaches.
    """
    if isinstance(config.options, OpenPrAutomergeOptions):
        return (
            f"would open PR{SEPARATOR}would auto-merge ({config.options.merge_method})"
            f"{SEPARATOR}not performed"
        )
    if config.action == "back_to_queue":
        return f"would return the ticket to the queue{SEPARATOR}not performed"
    return f"would open DRAFT PR{SEPARATOR}not merged (policy)"


def budget_note(scope: str, unit: str, used: int, cap: int) -> str:
    """The note of the stage a cap stopped.

    Args:
        scope: ``stage`` or ``run``.
        unit: ``token`` or ``cost``.
        used: What had been used when it stopped — tokens, or cents.
        cap: The cap.

    Returns:
        ``stopped: stage token cap reached (104k of 100k tokens)`` or
        ``stopped: run cost cap reached ($0.52 of $0.50)``.
    """
    if unit == "token":
        spent = f"{tokens_label(used).removesuffix(' tokens')} of {tokens_label(cap)}"
    else:
        spent = f"${used / 100:.2f} of ${cap / 100:.2f}"
    return f"stopped: {scope} {unit} cap reached ({spent})"
