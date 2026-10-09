"""``POST /v0/copilot-workflow`` — one turn of the Workflow Copilot, streamed.

CD.1 (`#559 <https://github.com/NobuData/ouroboros/issues/559>`_). The shapes are
:mod:`ouroboros_engine.copilot.contract`; the turn is :mod:`ouroboros_engine.copilot.turn`,
installed on the application by :func:`ouroboros_engine.main.create_app` with the gateway that
reaches ``ouroboros-rest``. This module is the path, the framing and one log line.

The answer is ``application/x-ndjson`` written as the model writes, because the UI's
*watch-it-build* moment is the stream: reply text and the operations it carries arrive in the
order the model produced them, and ``ouroboros-rest`` applies each operation as it arrives.

The log line carries the session and counts, never the transcript — a workflow conversation is
a workspace's own words.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.copilot.contract import CopilotTurnRequest
from ouroboros_engine.copilot.turn import CopilotTurnRunner

#: Where the operation lives under the versioned prefix.
COPILOT_ROUTE = "/copilot-workflow"

#: How the answer is framed — one JSON event per line.
NDJSON_MEDIA_TYPE = "application/x-ndjson"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


def _runner(request: Request) -> CopilotTurnRunner:
    """The runner installed on the application.

    Args:
        request: The incoming request.

    Returns:
        The runner — read from ``app.state`` so a test installs its own gateway.
    """
    return request.app.state.copilot


def _lines(runner: CopilotTurnRunner, payload: CopilotTurnRequest) -> Iterator[str]:
    """Run the turn and frame each event as one line.

    Args:
        runner: The installed runner.
        payload: The validated turn.

    Yields:
        One JSON line per event.
    """
    events = 0
    for event in runner.run(payload):
        events += 1
        yield event.model_dump_json() + "\n"
    _logger.info(
        "copilot turn",
        extra={
            "session": payload.session,
            "alias": payload.alias,
            "transcript": len(payload.transcript),
            "events": events,
        },
    )


@router.post(
    COPILOT_ROUTE,
    summary="Run one turn of the Workflow Copilot, streaming the reply",
    response_class=StreamingResponse,
)
async def copilot_workflow(
    request: Request, payload: CopilotTurnRequest
) -> StreamingResponse:
    """Make one model turn and stream it back.

    Args:
        request: The incoming request, read for the installed runner.
        payload: The validated turn — a body that does not validate is the ``422`` envelope
            before anything is invoked.

    Returns:
        A ``200`` streaming ``application/x-ndjson``: ``delta``, ``tool_call`` and ``usage``
        events as they happen, then exactly one ``error`` or ``done``.
    """
    return StreamingResponse(
        _lines(_runner(request), payload), media_type=NDJSON_MEDIA_TYPE
    )
