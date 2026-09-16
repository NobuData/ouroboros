"""The seam a planner plugs into, and the contract check every batch passes.

AL.1 (`#277 <https://github.com/NobuData/ouroboros/issues/277>`_). The contract beside this
module is the part that must not change; *this* is the part that is meant to. Two planners
are foreseen and one of them exists:

* the outline parser, AL.1 — installed today. Deterministic, reads a markdown outline,
  provenance ``outline-v0``; :mod:`ouroboros_engine.planning.outline_planner`.
* the LLM planner, AN.1 (`#289 <https://github.com/NobuData/ouroboros/issues/289>`_) — which
  decomposes a narrative properly once the invocation gateway AF.2
  (`#235 <https://github.com/NobuData/ouroboros/issues/235>`_) exists. It answers **this**
  contract, so the API, the UI, the sizing pipeline and the push path are unchanged by its
  arrival; what changes is one line in :func:`ouroboros_engine.main.create_app` and the
  value of :attr:`~ouroboros_engine.planning.contract.Plan.planner`.

That is roadmap decision **N2** made structural. The seam costs a dozen lines and is what
makes the difference between AN.1 being a new module and AN.1 being a rewrite of a route —
and, like the estimator's, it is what lets the two be *installed side by side*, which is
what a fallback path is for a planner whose model is unreachable.

**The batch is checked against the request, not trusted.** :func:`honours_context` is
decision **K5** applied to planning: a draft may only name a workflow tag the caller said
exists, and a batch may only use the key prefix the caller asked for. It runs on this side
of the boundary — the engine refusing its own answer — because a value that reached
``ouroboros-rest`` has already been logged and very nearly persisted by the time anyone
could reject it. The structural half of that check (unique keys, edges that resolve) is in
:class:`~ouroboros_engine.planning.contract.Plan` itself, so it holds for every planner
including one that never calls this function.
"""

import logging
from typing import Protocol, runtime_checkable

from ouroboros_engine.planning.contract import Plan, PlanningContext, PlanRequest

_logger = logging.getLogger(__name__)


class PlannerContractError(RuntimeError):
    """A planner answered outside the contract it was asked through.

    A bug in this service, never in the request: the caller's body validated, and what went
    wrong is downstream of it. It surfaces as the ``500`` every unexpected failure surfaces
    as — one constant sentence to the caller and the real diagnosis in the log — because a
    caller cannot act on it and an operator has to.
    """


@runtime_checkable
class Planner(Protocol):
    """What ``POST /v0/plan`` calls to get a batch.

    Runtime-checkable, so "is the thing on ``app.state`` a planner" is a question the suite
    can ask directly. It is a shallow check — a name and a callable, not their signatures —
    which is what a seam with one method can honestly offer.

    Synchronous, deliberately: the installed planner is a parser with nothing to wait for.
    AN.1's planner calls a model through the control plane and *will* have something to wait
    for, and the answer to that is the escalation already specified on ``POST /v0/estimate``
    — a change to the route, not to this protocol.

    Attributes:
        name: What goes in :attr:`~ouroboros_engine.planning.contract.Plan.planner`. Read by
            the route for its log line, so a request can be tied to what answered it without
            parsing the response body.
    """

    name: str

    def plan(self, request: PlanRequest) -> Plan:
        """Draft a batch of tickets.

        Args:
            request: The validated request — the narrative, the optional outline, and the
                vocabulary a batch may use.

        Returns:
            The plan. Every ``suggested_workflow`` must be one the request offered and every
            ``local_key`` must carry the requested prefix; :func:`honours_context` holds an
            implementation to that, and the route calls it on every answer.
        """
        ...


def honours_context(plan: Plan, context: PlanningContext) -> None:
    """Refuse a batch that names a vocabulary or a prefix the caller did not ask for.

    Decision **K5** made checkable, and the local-key prefix with it. A workflow tag is an
    opaque string to this service, which is exactly why it cannot tell a typo from a value:
    the only thing it can know is whether the caller said the value exists. So that is what
    it checks, on every answer, before one leaves the process.

    The prefix is checked for the same reason a tag is. A caller asked for ``OTA`` because
    that is what its rows, its page and its push will say; a planner that answered in
    ``TASK`` has produced a batch nobody asked for, and the keys are what every dependency
    in it is resolved by.

    Args:
        plan: What the planner produced.
        context: The vocabulary and the prefix the request offered.

    Raises:
        PlannerContractError: If a draft suggests a workflow tag the caller does not have,
            or carries a local key outside the caller's prefix. Both are logged with the
            offending value and the offer it was measured against, since the caller is told
            nothing but ``500``.
    """
    offered = set(context.workflow_tags)
    for draft in plan.drafts:
        if draft.suggested_workflow not in offered:
            _logger.error(
                "a planner suggested a workflow tag the caller does not have",
                extra={
                    "local_key": draft.local_key,
                    "suggested_workflow": draft.suggested_workflow,
                    "workflow_tags": list(context.workflow_tags),
                    "planner": plan.planner,
                },
            )
            message = (
                f"suggested_workflow {draft.suggested_workflow!r} on "
                f"{draft.local_key} is not one of the workflow tags the request offered"
            )
            raise PlannerContractError(message)

    prefix = f"{context.local_key_prefix}-"
    outside = [
        draft.local_key
        for draft in plan.drafts
        if not draft.local_key.startswith(prefix)
    ]
    if outside:
        _logger.error(
            "a planner drafted local keys outside the caller's prefix",
            extra={
                "local_keys": outside,
                "local_key_prefix": context.local_key_prefix,
                "planner": plan.planner,
            },
        )
        message = (
            f"local keys {outside} do not carry the requested prefix "
            f"{context.local_key_prefix!r}"
        )
        raise PlannerContractError(message)
