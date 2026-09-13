"""One evaluator for every predicate the DSL has — a trigger's conditions, a fork's test, an edge's.

P.2 made the predicate grammar flat and shared precisely so that R.2's simulator would need one
evaluator (`#133 <https://github.com/NobuData/ouroboros/issues/133>`_); this is it. The trigger's
conditions are evaluated by rewriting each into the predicate it means — ``effort_lte`` is an
``effort`` predicate with ``op: "lte"``, ``labels`` is ``labels`` with ``op: "all"``, ``source``
is ``source`` with ``op: "in"`` — so the two readings cannot drift apart.

What an evaluation reads is the :class:`~ouroboros_engine.workflows.contract.DryRunTicket` and
nothing else. Three rules follow from that, and each is stated where a caller can see it:

* **Efforts are ordered the way the vocabulary lists them**, ``xs`` < ``s`` < ``m`` < ``l`` <
  ``xl``, derived from :data:`~ouroboros_engine.workflows.dsl.Effort` rather than typed twice.
  A ticket with no estimate satisfies no effort comparison — *unsized* is not smaller than
  ``xs``, it is unknown.
* **Labels compare exactly**, as the tracker spells them. Case-folding would be this service
  inventing a normalisation no tracker promises.
* **A ``checks`` predicate cannot be evaluated**, because check results are produced by a run
  and a dry run does not run anything. The simulator assumes the green path — every check
  passes, so ``all_passed`` holds and ``any_failed`` does not — and says so: the evaluation is
  marked :attr:`Evaluation.assumed`, and its explanation names the assumption.

This module performs no I/O and imports nothing that could. ``tests/test_workflows_simulate.py``
asserts that of the whole package.
"""

from __future__ import annotations

import operator
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final, get_args

from pydantic import BaseModel

from .contract import DryRunTicket, PredicateEvaluation
from .dsl import (
    AlwaysPredicate,
    ChecksPredicate,
    Effort,
    EffortPredicate,
    LabelsPredicate,
    SourcePredicate,
    Trigger,
)

#: Every effort, smallest first — the order the vocabulary lists them in.
EFFORT_ORDER: Final[tuple[str, ...]] = get_args(Effort)

#: How each effort comparison reads, as the mockup's ``≤ M`` chip writes it.
EFFORT_SYMBOLS: Final[dict[str, str]] = {
    "lt": "<",
    "lte": "≤",
    "eq": "=",
    "gte": "≥",
    "gt": ">",
}

#: What each effort comparison computes, over positions in :data:`EFFORT_ORDER`.
_EFFORT_OPERATORS: Final[dict[str, Callable[[int, int], bool]]] = {
    "lt": operator.lt,
    "lte": operator.le,
    "eq": operator.eq,
    "gte": operator.ge,
    "gt": operator.gt,
}

#: The sentence every assumed check result starts from.
_NO_CHECK_RESULTS: Final = "a dry run has no check results"


@dataclass(frozen=True, slots=True)
class Evaluation:
    """One predicate's result, and the clause that explains it."""

    #: Whether the predicate holds.
    holds: bool
    #: Whether :attr:`holds` is the simulator's assumption rather than a fact about the ticket.
    assumed: bool
    #: Why, as a clause with no capital and no full stop — so a caller can embed it.
    clause: str

    def sentence(self) -> str:
        """Render the clause as a sentence.

        Returns:
            The clause, capitalised, ending in a full stop.
        """
        return f"{self.clause[:1].upper()}{self.clause[1:]}."

    def as_model(self) -> PredicateEvaluation:
        """Render the evaluation as the wire model.

        Returns:
            The :class:`~ouroboros_engine.workflows.contract.PredicateEvaluation`.
        """
        return PredicateEvaluation(
            holds=self.holds, assumed=self.assumed, explanation=self.sentence()
        )


def _names(values: Sequence[str]) -> str:
    """Quote a list of names the way every explanation here does.

    Args:
        values: The names, in the order the document gives them.

    Returns:
        The names in backticks, comma-separated.
    """
    return ", ".join(f"`{value}`" for value in values)


def _effort(predicate: EffortPredicate, ticket: DryRunTicket) -> Evaluation:
    """Compare the ticket's estimated effort against a predicate's.

    Args:
        predicate: The effort predicate.
        ticket: The ticket.

    Returns:
        The evaluation. A ticket with no estimate never satisfies a comparison.
    """
    symbol = EFFORT_SYMBOLS[predicate.op]
    wanted = predicate.value.upper()
    key = ticket.external_key

    if ticket.estimate is None:
        return Evaluation(
            holds=False,
            assumed=False,
            clause=f"{key} has no estimate, so effort {symbol} {wanted} cannot hold",
        )

    actual = ticket.estimate.effort
    compare = _EFFORT_OPERATORS[predicate.op]
    holds = compare(EFFORT_ORDER.index(actual), EFFORT_ORDER.index(predicate.value))
    shown = actual.upper()
    relation = f"{symbol} {wanted}" if holds else f"is not {symbol} {wanted}"
    return Evaluation(
        holds=holds,
        assumed=False,
        clause=f"{key} is effort {shown}, and {shown} {relation}",
    )


def _labels(predicate: LabelsPredicate, ticket: DryRunTicket) -> Evaluation:
    """Test the ticket's labels against a predicate's.

    Args:
        predicate: The labels predicate.
        ticket: The ticket.

    Returns:
        The evaluation, naming the labels that decided it.
    """
    key = ticket.external_key
    wanted = _names(predicate.values)
    carried = [value for value in predicate.values if value in ticket.labels]
    missing = [value for value in predicate.values if value not in ticket.labels]

    if predicate.op == "any":
        if carried:
            clause = f"{key} carries {_names(carried)}, and any of {wanted} will do"
        else:
            clause = f"{key} carries none of {wanted}"
        return Evaluation(holds=bool(carried), assumed=False, clause=clause)

    if predicate.op == "all":
        if missing:
            clause = (
                f"{key} lacks {_names(missing)}, and every one of {wanted} is required"
            )
        else:
            clause = f"{key} carries every one of {wanted}"
        return Evaluation(holds=not missing, assumed=False, clause=clause)

    if carried:
        clause = f"{key} carries {_names(carried)}, and none of {wanted} may be present"
    else:
        clause = f"{key} carries none of {wanted}"
    return Evaluation(holds=not carried, assumed=False, clause=clause)


def _source(predicate: SourcePredicate, ticket: DryRunTicket) -> Evaluation:
    """Test which tracker the ticket came from against a predicate.

    Args:
        predicate: The source predicate.
        ticket: The ticket.

    Returns:
        The evaluation.
    """
    key = ticket.external_key
    origin = f"{key} comes from `{ticket.source}`"
    inside = ticket.source in predicate.values
    wanted = _names(predicate.values)

    if predicate.op == "in":
        if inside:
            return Evaluation(holds=True, assumed=False, clause=origin)
        return Evaluation(
            holds=False, assumed=False, clause=f"{origin}, not one of {wanted}"
        )

    if inside:
        return Evaluation(
            holds=False, assumed=False, clause=f"{origin}, which is excluded"
        )
    return Evaluation(holds=True, assumed=False, clause=f"{origin}, none of {wanted}")


def _checks(predicate: ChecksPredicate) -> Evaluation:
    """State the green-path assumption for a predicate over check results.

    Args:
        predicate: The checks predicate.

    Returns:
        An evaluation marked assumed: ``all_passed`` holds and ``any_failed`` does not.
    """
    names = predicate.names

    if predicate.op == "all_passed":
        scope = "every check passes" if names is None else f"{_names(names)} all pass"
        return Evaluation(
            holds=True,
            assumed=True,
            clause=f"{_NO_CHECK_RESULTS}, so it assumes {scope}",
        )

    scope = "no check fails" if names is None else f"none of {_names(names)} fails"
    return Evaluation(
        holds=False,
        assumed=True,
        clause=f"{_NO_CHECK_RESULTS}, so it assumes {scope}",
    )


def evaluate_predicate(predicate: BaseModel, ticket: DryRunTicket) -> Evaluation:
    """Test one predicate against a ticket.

    Args:
        predicate: A parsed predicate — one of the models in
            :data:`~ouroboros_engine.workflows.dsl.PREDICATE_MODELS`.
        ticket: The ticket.

    Returns:
        The evaluation.

    Raises:
        TypeError: If ``predicate`` is not a model the DSL defines. A document that validated
            cannot produce one, so this is a caller's bug rather than an answer.
    """
    match predicate:
        case AlwaysPredicate():
            return Evaluation(
                holds=True, assumed=False, clause="the condition always holds"
            )
        case EffortPredicate():
            return _effort(predicate, ticket)
        case LabelsPredicate():
            return _labels(predicate, ticket)
        case SourcePredicate():
            return _source(predicate, ticket)
        case ChecksPredicate():
            return _checks(predicate)
        case _:
            message = f"{type(predicate).__name__} is not a workflow predicate"
            raise TypeError(message)


def evaluate_trigger(trigger: Trigger, ticket: DryRunTicket) -> Evaluation:
    """Test a document's trigger against a ticket — every present condition, ANDed.

    The event is not tested: ``ticket_queued`` is the only event there is, and a dry run is the
    question *what if this ticket were queued*.

    Args:
        trigger: The document's root ``trigger``.
        ticket: The ticket.

    Returns:
        The evaluation. When it does not hold, the clause names only the conditions that failed.
    """
    conditions = trigger.conditions
    parts: list[Evaluation] = []

    if conditions.effort_lte is not None:
        parts.append(
            _effort(
                EffortPredicate(kind="effort", op="lte", value=conditions.effort_lte),
                ticket,
            )
        )
    if conditions.labels is not None:
        parts.append(
            _labels(
                LabelsPredicate(kind="labels", op="all", values=conditions.labels),
                ticket,
            )
        )
    if conditions.source is not None:
        parts.append(
            _source(
                SourcePredicate(kind="source", op="in", values=[conditions.source]),
                ticket,
            )
        )

    key = ticket.external_key
    if not parts:
        return Evaluation(
            holds=True,
            assumed=False,
            clause=f"the trigger has no conditions, so it fires for {key} as for every queued ticket",
        )

    failed = [part for part in parts if not part.holds]
    if failed:
        reasons = "; ".join(part.clause for part in failed)
        return Evaluation(
            holds=False,
            assumed=False,
            clause=f"the trigger does not fire for {key}: {reasons}",
        )

    reasons = "; ".join(part.clause for part in parts)
    return Evaluation(
        holds=True, assumed=False, clause=f"the trigger fires for {key}: {reasons}"
    )


def describe_predicate(predicate: BaseModel) -> str:
    """Say what a predicate requires, without testing it — a gate's requirements, a fork's test.

    Args:
        predicate: A parsed predicate.

    Returns:
        A noun phrase — ``effort ≤ M``, ``every check passing``.

    Raises:
        TypeError: If ``predicate`` is not a model the DSL defines.
    """
    match predicate:
        case AlwaysPredicate():
            return "nothing — the condition always holds"
        case EffortPredicate():
            return f"effort {EFFORT_SYMBOLS[predicate.op]} {predicate.value.upper()}"
        case LabelsPredicate():
            return f"{predicate.op} of the labels {_names(predicate.values)}"
        case SourcePredicate():
            among = "among" if predicate.op == "in" else "other than"
            return f"a source {among} {_names(predicate.values)}"
        case ChecksPredicate():
            names = predicate.names
            if predicate.op == "all_passed":
                return (
                    "every check passing"
                    if names is None
                    else f"the checks {_names(names)} all passing"
                )
            return (
                "a failing check"
                if names is None
                else f"a failure among the checks {_names(names)}"
            )
        case _:
            message = f"{type(predicate).__name__} is not a workflow predicate"
            raise TypeError(message)


def describe_trigger(trigger: Trigger) -> str:
    """Say when a trigger starts a run — the canvas's ``effort ≤ M`` chip, as a sentence.

    Args:
        trigger: The document's root ``trigger``.

    Returns:
        One sentence.
    """
    conditions = trigger.conditions
    parts: list[str] = []
    if conditions.effort_lte is not None:
        parts.append(f"effort ≤ {conditions.effort_lte.upper()}")
    if conditions.labels is not None:
        parts.append(f"all of the labels {_names(conditions.labels)}")
    if conditions.source is not None:
        parts.append(f"source `{conditions.source}`")

    if not parts:
        return "Starts a run whenever a ticket is queued."
    return f"Starts a run when a ticket is queued with {', '.join(parts)}."
