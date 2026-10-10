"""``/v0/investigate`` — run an investigation in the background (CM.1, #620).

``POST /v0/investigate`` accepts an investigation (or its resumption) and answers ``202`` at
once. The work, and everything it writes, happens after the answer: the loop reports to
``ouroboros-rest``'s internal research surface, never back through this response.

**Submitting is idempotent, and that is how a run resumes.** A process already working on the
investigation answers ``already_running`` and starts nothing; one that is not — a restarted
engine — starts an attempt that continues from the stored checkpoint. So the control plane
simply submits a ``running`` investigation again when its checkpoint has stopped moving.

Refusals answer in the error envelope: ``422 investigation_playbook_unsupported`` when the
playbook names a synthesis template or deliverable this build lacks (refused before any work
starts), and ``503 investigation_capacity`` when every worker is busy.

The log line carries the investigation, its kind and depth — never the question.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.core.errors import envelope
from ouroboros_engine.investigation.contract import (
    AT_CAPACITY,
    PLAYBOOK_UNSUPPORTED,
    InvestigateRequest,
    InvestigationAccepted,
)
from ouroboros_engine.investigation.playbooks import (
    UnsupportedPlaybookError,
    template_for,
)
from ouroboros_engine.investigation.runner import AtCapacityError, InvestigationRunner

#: Where the operation lives under the versioned prefix.
INVESTIGATE_ROUTE = "/investigate"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


def _runner(request: Request) -> InvestigationRunner:
    """The runner installed on the application.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.investigations`` — a test installs its own.
    """
    return request.app.state.investigations


@router.post(
    INVESTIGATE_ROUTE,
    summary="Run or resume an investigation in the background",
    status_code=202,
    response_model=InvestigationAccepted,
)
def investigate(
    request: Request, payload: InvestigateRequest
) -> InvestigationAccepted | JSONResponse:
    """Accept an investigation.

    Args:
        request: The incoming request, read for the installed runner.
        payload: The validated investigation — a body that does not validate is the
            ``422`` envelope before anything starts.

    Returns:
        ``202`` with the engine task; or the refusal's envelope.
    """
    try:
        template_for(payload.kind.playbook)
    except UnsupportedPlaybookError as unsupported:
        return JSONResponse(
            status_code=422,
            content=envelope(
                PLAYBOOK_UNSUPPORTED,
                str(unsupported),
                {"synthesis_template": payload.kind.playbook.synthesis_template},
            ),
        )

    try:
        accepted = _runner(request).submit(payload)
    except AtCapacityError:
        return JSONResponse(
            status_code=503,
            content=envelope(
                AT_CAPACITY,
                "Every investigation worker is busy. Submit it again in a moment.",
            ),
        )

    _logger.info(
        "investigation submitted",
        extra={
            "investigation": payload.investigation,
            "kind": payload.kind.slug,
            "depth": payload.depth,
            "state": accepted.state,
        },
    )
    return accepted
