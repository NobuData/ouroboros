"""``POST /v0/estimate`` — size one issue, and the escalation path for when that is slow.

L.1 (`#105 <https://github.com/NobuData/ouroboros/issues/105>`_), the first operation under
``/v0`` that does something rather than demonstrating something. What it accepts and what it
answers are :mod:`ouroboros_engine.estimation.contract`; *which* estimator answers is
:mod:`ouroboros_engine.estimation.estimator`, installed on the application by
:func:`ouroboros_engine.main.create_app`. This module is only the three things in between:
the path, the answer's agreement with the request, and the version that answered.

**The route is the contract; the estimator is not.** L.2 replaces what computes the answer
and O.2 replaces it again, and neither is allowed to change a field name here. That is why
the estimator is reached through ``app.state`` rather than imported: a swap is a line in the
factory, and a test installs its own without patching a module.

**Every answer is checked against the request it answered.** The caller sends the workflow
tags and the models that exist (decisions **K5**, **K6**); an estimate naming anything else
is a ``500`` and a log line rather than a value that reaches a row. See
:func:`~ouroboros_engine.estimation.estimator.honours_context` for why the check lives on
this side of the gateway.

Async escalation — specified now, deliberately
==============================================

**v0 answers synchronously, and always will.** A rule engine has nothing to wait for, so
the route computes an estimate and returns it. But O.2's estimator calls a model through the
control plane, and a model call is not something to hold a gateway's socket open for. The
shape of that escalation is written down *now*, because the alternative is rewriting the
contract when O.2 arrives and rippling that through L.3, M.1 and N.3:

* the operation may answer :data:`ESCALATION_STATUS` instead of ``200``, carrying
  ``{estimation_id, status: "accepted"}`` and a :data:`ESCALATION_RETRY_AFTER_HEADER`
  header saying how long to wait;
* the caller then polls :data:`ESCALATION_POLL_ROUTE`, which answers ``202`` again while the
  estimate is in flight and **the same** :class:`~ouroboros_engine.estimation.contract.Estimate`
  body, unchanged, when it is done;
* an estimate that fails is the error envelope on the poll route, not a ``200`` carrying a
  half-answer.

Three consequences worth stating, since they are what the specification's
``x-async-escalation`` block is for. A caller written against ``/v0/estimate`` today must
treat ``202`` as *possible* rather than as *impossible*, which is a change L.3 can make
before there is anything to poll. The escalation adds a route and a status to ``/v0`` and
takes nothing away, so it is compatible with the rule in :mod:`ouroboros_engine.api.v0`
rather than a ``/v1``. And the estimate's *shape* does not change at all — which is the
whole point of specifying the escalation before the estimator that needs it.

The route stays ``async def`` while the estimator is synchronous, because v0's estimator is
arithmetic over a bounded body and the event loop is not held for measurably long. The first
estimator that performs I/O is also the first one that needs the escalation above, and both
of those are the same change.
"""

import logging

from fastapi import APIRouter, Request

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.estimation.contract import Estimate, EstimateRequest
from ouroboros_engine.estimation.estimator import Estimator, honours_context

#: Where the operation lives under the versioned prefix. Singular: it sizes *one* issue,
#: and a batch — the mockup's "Re-estimate all" — is L.4's loop over this route rather than
#: a second body shape here.
ESTIMATE_ROUTE = "/estimate"

#: The status O.2's escalation answers with when an estimate will not be ready in time.
#: Named here rather than written into the specification alone, so the two can be checked
#: against each other (``tests/test_api_estimate.py``).
ESCALATION_STATUS = 202

#: Where a caller polls for an escalated estimate. Under this operation's own path, so the
#: escalation is an extension of it rather than a second surface.
ESCALATION_POLL_ROUTE = f"{V0_PREFIX}{ESTIMATE_ROUTE}/{{estimation_id}}"

#: The header a ``202`` carries to say how long to wait before polling. The standard one:
#: an escalation is exactly what it was defined for, and a bespoke field would be a second
#: thing every client had to learn.
ESCALATION_RETRY_AFTER_HEADER = "Retry-After"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


@router.post(
    ESTIMATE_ROUTE,
    summary="Estimate the work in one issue",
    response_model=Estimate,
)
async def estimate_issue(request: Request, payload: EstimateRequest) -> Estimate:
    """Size one issue with whichever estimator is installed.

    Args:
        request: The incoming request, read for the application's own state — the
            estimator lives there rather than in a module global, so the factory decides
            which one is installed and a test can install another.
        payload: The validated request body. A body that does not validate never reaches
            this function: FastAPI raises first, and
            :mod:`ouroboros_engine.core.errors` turns that into the ``422`` envelope with
            one ``details`` entry per field.

    Returns:
        The :class:`~ouroboros_engine.estimation.contract.Estimate` — one version of K.2's
        row, ready for L.3 to persist without translating it.

    Raises:
        ouroboros_engine.estimation.estimator.EstimatorContractError: If the estimator
            named a workflow tag or a model the caller did not offer. It surfaces as the
            ``500`` every unexpected failure does — a constant sentence to the caller, the
            real diagnosis in the log — because it is this service's bug and not the
            caller's.
    """
    estimator: Estimator = request.app.state.estimator
    estimate = estimator.estimate(payload)

    # Checked before it is logged and before it is returned: an answer outside the
    # caller's vocabularies is not an estimate, so nothing downstream of here should see
    # one — including this service's own log, where it would read as a value that existed.
    honours_context(estimate, payload.context)

    # One line per sizing, at info: this is the operation the pipeline runs on every new
    # issue, and "which estimator sized #485, and how sure was it" is the question a
    # re-estimation argument starts from. The issue's title and body are deliberately not
    # in it — mirrored GitHub content does not belong in this service's logs.
    _logger.info(
        "sized an issue",
        extra={
            "repo": payload.issue.repo,
            "number": payload.issue.number,
            "estimator": estimate.trace.estimator,
            "effort": estimate.effort,
            "confidence": estimate.confidence,
        },
    )

    return estimate
