"""``POST /v0/plan`` — draft a batch of tickets from an outcome and an outline.

AL.1 (`#277 <https://github.com/NobuData/ouroboros/issues/277>`_), and the second operation
under ``/v0`` whose implementation is expected to be swapped out from under it. What it
accepts and what it answers are :mod:`ouroboros_engine.planning.contract`; *which* planner
answers is :mod:`ouroboros_engine.planning.planner`, installed on the application by
:func:`ouroboros_engine.main.create_app`. This module is only the three things in between:
the path, the batch's agreement with the request, and the line an operator reads afterwards.

**The route is the contract; the planner is not.** AN.1
(`#289 <https://github.com/NobuData/ouroboros/issues/289>`_) replaces what produces the
answer — a real decomposition, behind the invocation gateway — and is not allowed to change
a field name here. That is why the planner is reached through ``app.state`` rather than
imported: the swap is a line in the factory, and a test installs its own without patching a
module.

**Every batch is checked against the request it answered.** The caller sends the workflow
tags that exist and the prefix its keys must carry (decision **K5**); a batch naming
anything else is a ``500`` and a log line rather than drafts that reach a row. See
:func:`~ouroboros_engine.planning.planner.honours_context`.

**A request with no outline is not an error.** It is the case the whole staging exists for:
the planner answers with one draft and a note recommending an outline, this route returns it
as a ``200``, and AM.2 (`#284 <https://github.com/NobuData/ouroboros/issues/284>`_) renders
the note as designed guidance. A ``422`` is reserved for a request that is not one — no
narrative, a prefix that is not a prefix, a property the operation does not declare.

**Nothing here is sized.** Decision **N3**: drafts go through the same estimation pipeline
every other ticket does, which is L.3's orchestrator calling ``POST /v0/estimate``, not a
second sizer hidden behind this route. A caller that wants the mockup's ``✓ all sized`` asks
for estimates after this answers.

The log line carries counts and provenance, never the narrative or the outline: both are the
customer's own description of their product, and they do not belong in this service's logs
any more than a mirrored issue body does.
"""

import logging

from fastapi import APIRouter, Request

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.planning.contract import Plan, PlanRequest
from ouroboros_engine.planning.planner import Planner, honours_context

#: Where the operation lives under the versioned prefix. Singular: it drafts *one* batch,
#: and regenerating is the caller asking again rather than a second body shape here.
PLAN_ROUTE = "/plan"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


@router.post(
    PLAN_ROUTE,
    summary="Draft a batch of tickets from an outcome",
    response_model=Plan,
)
async def plan_work(request: Request, payload: PlanRequest) -> Plan:
    """Draft a batch with whichever planner is installed.

    Args:
        request: The incoming request, read for the application's own state — the planner
            lives there rather than in a module global, so the factory decides which one is
            installed and a test can install another.
        payload: The validated request body. A body that does not validate never reaches
            this function: FastAPI raises first, and :mod:`ouroboros_engine.core.errors`
            turns that into the ``422`` envelope with one ``details`` entry per field.

    Returns:
        The :class:`~ouroboros_engine.planning.contract.Plan` — the drafts, what produced
        them, and whatever the planner could not honestly do, ready for AL.4 to persist as a
        batch without translating it.

    Raises:
        ouroboros_engine.planning.planner.PlannerContractError: If the planner named a
            workflow tag the caller does not have, or keyed the batch outside the caller's
            prefix. It surfaces as the ``500`` every unexpected failure does — a constant
            sentence to the caller, the real diagnosis in the log — because it is this
            service's bug and not the caller's.
    """
    planner: Planner = request.app.state.planner
    plan = planner.plan(payload)

    # Checked before it is logged and before it is returned: a batch outside the caller's
    # vocabulary is not a plan, so nothing downstream of here should see one — including
    # this service's own log, where it would read as a batch that existed.
    honours_context(plan, payload.context)

    # One line per batch, at info. "What drafted this, how many tickets did it make, and did
    # it have to explain itself" is the question a regenerate argument starts from, and the
    # answer should not need a second request. The narrative, the outline and the drafts'
    # own titles are deliberately not in it — that is the customer's product description.
    _logger.info(
        "drafted a batch of tickets",
        extra={
            "planner": plan.planner,
            "drafts": len(plan.drafts),
            "dependencies": sum(len(draft.dependencies) for draft in plan.drafts),
            "notes": len(plan.notes),
            "outlined": payload.outline is not None,
            "local_key_prefix": payload.context.local_key_prefix,
        },
    )

    return plan
