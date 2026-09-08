"""The seam an estimator plugs into, and the one that is installed until L.2 lands.

The contract beside this module is the part that must not change; *this* is the part that
is meant to. Three estimators are foreseen and two of them do not exist yet:

* :class:`ContractStub` — installed today. It produces a well-formed estimate that says,
  in every field a reader looks at, that nothing estimated it.
* the heuristic, L.2 (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_) — rules
  over labels, title verbs and body shape, provenance ``heuristic-v0``.
* the LLM estimator, O.2 (`#123 <https://github.com/NobuData/ouroboros/issues/123>`_) —
  which replaces the heuristic without touching ``ouroboros-rest``, because the thing
  ``ouroboros-rest`` is written against is :class:`~ouroboros_engine.estimation.contract.Estimate`
  and not whatever produced it.

**Why a seam at all, for one implementation.** The alternative is a route that computes an
answer inline, and the cost of that is paid twice: L.2 arrives as a rewrite of a route
rather than as a new module, and the route's own concerns — validating the caller's
request, holding the answer to the caller's vocabularies, naming the version that answered
— get mixed into whichever estimator was written last. A :class:`Protocol` with one method
costs a dozen lines and makes each of those a separate change.

**The answer is checked against the request, not trusted.** :func:`honours_context` is the
enforcement of decisions **K5** and **K6**: an estimate may only name a workflow tag and a
model the caller said exist. It is deliberately *this* side of the boundary — the engine
refusing its own answer — rather than a validation ``ouroboros-rest`` performs on what
comes back, because a value that reached the gateway has already been logged, measured and
very nearly persisted by the time anyone could reject it.
"""

import logging
from typing import Protocol, runtime_checkable

from ouroboros_engine.estimation.contract import (
    Breakdown,
    Estimate,
    EstimateRequest,
    EstimationContext,
    Trace,
)

_logger = logging.getLogger(__name__)

#: What the stub writes into ``trace.estimator``. Decision **K10** says an estimate names
#: what produced it, and "nothing did" is a thing that has to be sayable: this string is
#: what L.3 and an operator read to tell a placeholder from a heuristic, and it is
#: deliberately not ``heuristic-v0`` — a stub borrowing the estimator's name is exactly the
#: masquerade K10 exists to prevent.
CONTRACT_STUB = "contract-stub-v0"

#: The one signal the stub reports. A rule name, like the heuristic's will be, so a reader
#: of a trace sees the same kind of line whichever estimator produced it.
NO_ESTIMATOR_SIGNAL = "no-estimator-installed"

#: What the stub says under the risk meter. It is the only field in the answer that can
#: explain the other seven, so it says what happened rather than hedging.
NO_ESTIMATOR_NOTE = (
    "No estimator is installed yet, so this is not an estimate: the contract's shape "
    "with none of its judgement. Confidence is 0 and the risk is reported "
    "conservatively. #106 replaces it."
)

#: The effort the stub reports. Every value in the vocabulary is a claim and this one has
#: no basis for any of them, so it reports the middle and sets confidence to 0 — the field
#: is required and closed, and omitting it is not an option the contract offers.
STUB_EFFORT = "m"

#: The risk the stub reports. Unsized work is not low-risk work, and there is no
#: ``unknown`` in K.2's vocabulary; the note beside it says which of those two this is.
STUB_RISK = "high"


class EstimatorContractError(RuntimeError):
    """An estimator answered outside the contract it was asked through.

    A bug in this service, never in the request: the caller's body validated, and what
    went wrong is downstream of it. It surfaces as the ``500`` every unexpected failure
    surfaces as (:func:`ouroboros_engine.core.errors.handle_unexpected_error`) — one
    constant sentence to the caller and the real diagnosis in the log — because a caller
    cannot act on it and an operator has to.
    """


@runtime_checkable
class Estimator(Protocol):
    """What ``POST /v0/estimate`` calls to get an answer.

    Runtime-checkable, so "is the thing on ``app.state`` an estimator" is a question the
    suite can ask directly. It is a shallow check — the presence of a name and a callable,
    not their signatures — which is exactly what a seam with one method needs and no more
    than a :class:`Protocol` can honestly offer.

    One method, and a name for the trace. Synchronous, deliberately: v0's estimator is a
    rule engine with nothing to wait for, and an ``async def`` that never awaits would be
    a promise about the route's shape that nothing yet needs. The escalation path for an
    estimator that *does* wait is the ``202`` documented on the operation
    (:mod:`ouroboros_engine.api.estimate`), which changes the route rather than this
    protocol.

    Attributes:
        name: What goes in :attr:`~ouroboros_engine.estimation.contract.Trace.estimator`.
            Read by the route for its log line, so a request can be tied to what answered
            it without parsing the response body.
    """

    name: str

    def estimate(self, request: EstimateRequest) -> Estimate:
        """Size one issue.

        Args:
            request: The validated request — the issue, and the vocabularies an answer
                may use.

        Returns:
            The estimate. Its ``suggested_workflow`` and ``routed_model`` must be ones
            the request offered; :func:`honours_context` is what holds an implementation
            to that, and the route calls it on every answer.
        """
        ...


class ContractStub:
    """The estimator installed until L.2 lands: the shape, and no judgement.

    It exists so ``POST /v0/estimate`` is a working round trip from the day the contract
    is committed — which is what makes the gateway leg, the specification and L.3's
    persistence something that can be built and tested before any estimator does. What it
    must not be is *plausible*: an answer that looked like an estimate would be persisted
    as one, rendered as one, and re-estimated only when someone noticed. So every field a
    reader checks says the same thing —

    * ``confidence`` is ``0``, which is below any floor L.3 could set, so an issue sized
      by this estimator becomes ``needs_human`` rather than ``sized``.
    * ``trace.estimator`` is :data:`CONTRACT_STUB`, not ``heuristic-v0``.
    * the breakdown is zeros and no files, rather than a range somebody could plan with.
    * ``risk_note`` says outright that nothing estimated this.

    Attributes:
        name: :data:`CONTRACT_STUB`.
    """

    name = CONTRACT_STUB

    def estimate(self, request: EstimateRequest) -> Estimate:
        """Answer with the contract's shape and none of its content.

        The workflow tag and the model are taken from the caller's own lists — the first
        of each, in the order they were offered. That is not a choice about which is
        right; it is the only way to fill a required field whose vocabulary belongs to
        the caller (decisions **K5**, **K6**), and it is why the caller has to offer at
        least one of each.

        Args:
            request: The validated request.

        Returns:
            A well-formed :class:`~ouroboros_engine.estimation.contract.Estimate` that
            reports, in every field, that no estimator produced it.
        """
        context = request.context

        return Estimate(
            effort=STUB_EFFORT,
            confidence=0,
            suggested_workflow=context.workflow_tags[0],
            # `next(iter(...))` rather than `list(...)[0]`: the caller's insertion order
            # is preserved through JSON parsing, so this is the first default they wrote.
            routed_model=next(iter(context.model_defaults.values())),
            breakdown=Breakdown(
                files=[], est_tokens=0, cycle_min=0, cycle_max=0, est_minutes=0
            ),
            risk=STUB_RISK,
            risk_note=NO_ESTIMATOR_NOTE,
            trace=Trace(
                estimator=self.name, tokens_used=0, signals=[NO_ESTIMATOR_SIGNAL]
            ),
        )


def honours_context(estimate: Estimate, context: EstimationContext) -> None:
    """Refuse an answer that names a vocabulary the caller did not offer.

    Decisions **K5** and **K6** made checkable. The tag and the model are opaque strings
    to this service, which is exactly why it cannot tell a typo from a value: the only
    thing it can know is whether the caller said the value exists. So that is what it
    checks, on every answer, before one leaves the process.

    Args:
        estimate: What the estimator produced.
        context: The vocabularies the request offered.

    Raises:
        EstimatorContractError: If ``suggested_workflow`` is not one of the offered tags,
            or ``routed_model`` is not one of the offered defaults' values. Both are
            logged with the offending value and the offer it was measured against, since
            the caller is told nothing but ``500``.
    """
    if estimate.suggested_workflow not in context.workflow_tags:
        _logger.error(
            "an estimator suggested a workflow tag the caller does not have",
            extra={
                "suggested_workflow": estimate.suggested_workflow,
                "workflow_tags": list(context.workflow_tags),
                "estimator": estimate.trace.estimator,
            },
        )
        message = (
            f"suggested_workflow {estimate.suggested_workflow!r} is not one of the "
            "workflow tags the request offered"
        )
        raise EstimatorContractError(message)

    if estimate.routed_model not in context.model_defaults.values():
        _logger.error(
            "an estimator routed to a model the caller does not have",
            extra={
                "routed_model": estimate.routed_model,
                "model_defaults": sorted(set(context.model_defaults.values())),
                "estimator": estimate.trace.estimator,
            },
        )
        message = (
            f"routed_model {estimate.routed_model!r} is not one of the model defaults "
            "the request offered"
        )
        raise EstimatorContractError(message)
