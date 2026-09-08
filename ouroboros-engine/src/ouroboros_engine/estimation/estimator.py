"""The seam an estimator plugs into, and the contract check every answer passes.

The contract beside this module is the part that must not change; *this* is the part that
is meant to. Two estimators are foreseen and one of them exists:

* the heuristic, L.2 (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_) —
  installed today. Rules over labels, title verbs and body shape, provenance
  ``heuristic-v0``; :mod:`ouroboros_engine.estimation.heuristic`.
* the LLM estimator, O.2 (`#123 <https://github.com/NobuData/ouroboros/issues/123>`_) —
  which replaces the heuristic without touching ``ouroboros-rest``, because the thing
  ``ouroboros-rest`` is written against is :class:`~ouroboros_engine.estimation.contract.Estimate`
  and not whatever produced it. The heuristic is *retained* when it lands, as the fallback
  path for an issue the model estimator cannot size or a control plane that is down.

**Why a seam at all.** The alternative is a route that computes an answer inline, and the
cost of that is paid twice: O.2 would arrive as a rewrite of a route rather than as a new
module, and the route's own concerns — validating the caller's request, holding the answer
to the caller's vocabularies, naming the version that answered — would get mixed into
whichever estimator was written last. A :class:`Protocol` with one method costs a dozen
lines and makes each of those a separate change. It is also what lets L.2 and O.2 be
*installed side by side*, which is what a fallback path is.

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
    Estimate,
    EstimateRequest,
    EstimationContext,
)

_logger = logging.getLogger(__name__)


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

    One method, and a name for the trace. Synchronous, deliberately: the installed
    estimator is a rule engine with nothing to wait for, and an ``async def`` that never
    awaits would be a promise about the route's shape that nothing yet needs. The
    escalation path for an estimator that *does* wait is the ``202`` documented on the
    operation (:mod:`ouroboros_engine.api.estimate`), which changes the route rather than
    this protocol.

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
