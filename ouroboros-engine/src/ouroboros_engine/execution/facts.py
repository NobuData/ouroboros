"""What an executing run can honestly say about a predicate — and what it cannot.

#160. The dry run (R.2) evaluates predicates against a ticket it was *given* and assumes the
green path for what it cannot know (:mod:`ouroboros_engine.workflows.predicates`). A live
run must not assume: a gate that lets a change through on an assumption is a gate that does
not hold. So the interpreter judges each predicate with what it actually has:

* ``always`` holds.
* ``paths`` is tested for real against the run's change-set — the working tree's diff
  against its base commit (DI.1).
* ``source`` is tested against the run's repository, which is a GitHub one: the execution
  brief carries no other tracker.
* ``labels`` is tested against the ticket's labels, and ``effort`` against its size, both
  from the execution brief (``POST …/start``), by the dry run's own rules
  (:func:`~ouroboros_engine.workflows.predicates.evaluate_predicate`). A ticket nobody sized
  has an **unknown** effort.
* ``checks`` is tested against this loop round's check results — a build stage's real exit
  code on the farm, a model stage that succeeded (AJ.3, #265,
  :mod:`~ouroboros_engine.execution.checks`). A named check with no result is **unknown**.

An unknown judgement is never read as a pass. A decision does not take a branch it cannot
judge, and a gate it cannot judge fails the run, naming why.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from pydantic import BaseModel

from ouroboros_engine.execution.checks import CheckFailure, CheckResult, judge_checks
from ouroboros_engine.execution.glob import first_match
from ouroboros_engine.workflows.contract import DryRunTicket, TicketEstimate
from ouroboros_engine.workflows.dsl import (
    AlwaysPredicate,
    ChecksPredicate,
    EffortPredicate,
    LabelsPredicate,
    PathsPredicate,
    SourcePredicate,
)
from ouroboros_engine.workflows.predicates import evaluate_predicate

#: The tracker every executing run's ticket comes from today.
RUN_SOURCE = "github"


@dataclass(frozen=True, slots=True)
class TicketFacts:
    """What the execution brief says about the ticket.

    Attributes:
        labels: Its labels, as the tracker spells them.
        effort: Its size (``xs`` … ``xl``), or ``None`` when nobody sized it.
    """

    labels: tuple[str, ...] = ()
    effort: str | None = None

    def ticket(self) -> DryRunTicket:
        """The ticket as the shared predicate evaluator reads it.

        Returns:
            An unvalidated :class:`DryRunTicket` — only its labels and estimate are read.
        """
        estimate = (
            None
            if self.effort is None
            else TicketEstimate.model_construct(effort=self.effort)
        )
        return DryRunTicket.model_construct(
            external_key="#run",
            source=RUN_SOURCE,
            labels=list(self.labels),
            estimate=estimate,
        )


@dataclass(frozen=True, slots=True)
class Judgement:
    """One predicate, judged.

    Attributes:
        holds: Whether it holds, or ``None`` when the run cannot know.
        clause: Why, as a lower-case clause with no full stop.
        failure: For a ``checks`` predicate, the first failed check's return reason.
    """

    holds: bool | None
    clause: str
    failure: CheckFailure | None = None


def _paths(predicate: PathsPredicate, changed: Sequence[str]) -> Judgement:
    """Test a paths predicate against the change-set.

    Args:
        predicate: The predicate.
        changed: Every changed path, tree-relative.

    Returns:
        ``any`` holds when a changed path matches a glob; ``none`` when none does.
    """
    hit = next((path for path in changed if first_match(path, predicate.globs)), None)
    if hit is None:
        clause = "no changed path matches " + ", ".join(predicate.globs)
    else:
        clause = f"the change touches {hit}"
    return Judgement(holds=(hit is not None) == (predicate.op == "any"), clause=clause)


def judge(
    predicate: BaseModel,
    changed: Sequence[str],
    facts: TicketFacts | None = None,
    checks: Mapping[str, CheckResult] | None = None,
) -> Judgement:
    """Judge one predicate with what an executing run knows.

    Args:
        predicate: A parsed DSL predicate.
        changed: The run's changed paths, tree-relative.
        facts: The ticket's labels and effort; ``None`` is no labels and no size.
        checks: This loop round's check results; ``None`` is none.

    Returns:
        The judgement; ``holds`` is ``None`` for a fact the run does not have.

    Raises:
        TypeError: If the predicate is not one the DSL defines.
    """
    match predicate:
        case AlwaysPredicate():
            return Judgement(holds=True, clause="the condition always holds")
        case PathsPredicate():
            return _paths(predicate, changed)
        case SourcePredicate():
            inside = RUN_SOURCE in predicate.values
            return Judgement(
                holds=inside == (predicate.op == "in"),
                clause=f"the ticket comes from {RUN_SOURCE}",
            )
        case EffortPredicate() if (facts or TicketFacts()).effort is None:
            return Judgement(holds=None, clause="nobody has sized the ticket")
        case EffortPredicate() | LabelsPredicate():
            evaluation = evaluate_predicate(
                predicate, (facts or TicketFacts()).ticket()
            )
            return Judgement(holds=evaluation.holds, clause=evaluation.clause)
        case ChecksPredicate():
            verdict = judge_checks(predicate.op, predicate.names, checks or {})
            return Judgement(
                holds=verdict.holds, clause=verdict.clause, failure=verdict.failure
            )
        case _:
            raise TypeError(f"{type(predicate).__name__} is not a workflow predicate")
