"""``POST /v0/workflows/validate`` and ``POST /v0/workflows/dry-run`` — the engine reading a DSL.

R.2 (`#144 <https://github.com/NobuData/ouroboros/issues/144>`_). Both operations are thin on
purpose: what they accept and answer is :mod:`ouroboros_engine.workflows.contract`, the verdict
is :mod:`ouroboros_engine.workflows.validate`, and the walk is
:mod:`ouroboros_engine.workflows.simulate`. This module is the path, and one log line each.

**Validate is the publish gate's second opinion.** ``ouroboros-rest`` validates with zod first
and asks here only about a document zod accepted (P.3's ``publish.gate.ts``), so the question
this route answers is *does the component that will execute this definition read it the same
way?* ``tests/test_api_workflows.py`` holds its findings to the golden verdicts both validators
share, over HTTP.

**A definition that is not valid is a ``200``, not a ``422``.** The request was well-formed —
it carried a definition — and the findings are the answer. A ``422`` is reserved for a request
that is not one: no ``definition``, an undeclared property, a ticket whose effort is not an
effort.

**The dry run spends nothing.** No model, no provider, no estimator: the route reads the
definition and the ticket it was sent and nothing else. That is asserted by
``tests/test_api_workflows.py`` against spies, not by this sentence.

The log lines carry counts and the ticket's display key, never the definition: a workflow's
prompt templates are a workspace's content, and they do not belong in this service's logs.
"""

import logging

from fastapi import APIRouter

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.workflows.contract import (
    WorkflowDryRun,
    WorkflowDryRunRequest,
    WorkflowValidateRequest,
    WorkflowValidation,
    findings_from,
)
from ouroboros_engine.workflows.simulate import dry_run
from ouroboros_engine.workflows.validate import validate_workflow_document

#: Where the workflow operations live under the versioned prefix. Plural, because a definition
#: is a workflow's and both operations are questions about one.
WORKFLOWS_ROUTE = "/workflows"

#: The operation the publish gate calls.
VALIDATE_ROUTE = "/validate"

#: The operation the studio's *Dry run with issue #485* calls.
DRY_RUN_ROUTE = "/dry-run"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=f"{V0_PREFIX}{WORKFLOWS_ROUTE}", tags=[V0_TAG])


@router.post(
    VALIDATE_ROUTE,
    summary="Validate a workflow definition",
    response_model=WorkflowValidation,
)
async def validate_workflow(payload: WorkflowValidateRequest) -> WorkflowValidation:
    """Judge one definition with the engine's validator.

    Args:
        payload: The validated request body. A body with no ``definition`` never reaches this
            function — FastAPI answers the ``422`` envelope first.

    Returns:
        The findings, empty when the definition is valid.
    """
    findings = findings_from(validate_workflow_document(payload.definition))
    _logger.info("validated a workflow definition", extra={"findings": len(findings)})
    return WorkflowValidation(findings=findings)


@router.post(
    DRY_RUN_ROUTE,
    summary="Simulate a workflow for one ticket",
    response_model=WorkflowDryRun,
)
async def dry_run_workflow(payload: WorkflowDryRunRequest) -> WorkflowDryRun:
    """Walk one definition for one ticket, without running anything.

    Args:
        payload: The validated request body — the definition, and the ticket to walk it for.

    Returns:
        The findings when the definition is not valid, and otherwise the ordered walk, a
        verdict per stage and the edges to highlight.
    """
    simulation = dry_run(payload.definition, payload.ticket)
    _logger.info(
        "simulated a workflow",
        extra={
            "ticket": payload.ticket.external_key,
            "findings": len(simulation.findings),
            "steps": len(simulation.steps),
        },
    )
    return simulation
