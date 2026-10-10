"""``/v0/dry-runs`` — run a deep dry run, streaming its progress (CD.2, #560).

``POST /v0/dry-runs`` walks a draft for a ticket and answers ``application/x-ndjson``: one
JSON event per line as each stage starts and finishes, a line whenever the tool boundary
refuses a call, and exactly one ``done`` last carrying the whole result — stage rows,
artifacts, guard audit and totals, in the shape ``ouroboros-rest`` stores them.

The request is held open for the length of the run, as a copilot turn is: the caller is the
dry-run orchestrator (CD.4, #562), which relays progress and persists the result. **This
service writes nothing and dispatches nothing.**

The log line names the dry run, its repository and how it ended — never the ticket's text,
a prompt, or the repository token.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.dryrun.contract import DryRunDone, DryRunRequest
from ouroboros_engine.dryrun.harness import DryRunHarness

#: Where the operation lives under the versioned prefix.
DRY_RUNS_ROUTE = "/dry-runs"

#: How the answer is framed — one JSON event per line.
NDJSON_MEDIA_TYPE = "application/x-ndjson"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


def _harness(request: Request) -> DryRunHarness:
    """The harness installed on the application.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.dry_runs`` — a test installs its own over a recorded model.
    """
    return request.app.state.dry_runs


def _lines(harness: DryRunHarness, payload: DryRunRequest) -> Iterator[str]:
    """Run the dry run and frame each event as one line.

    Args:
        harness: The installed harness.
        payload: The validated dry run.

    Yields:
        One JSON line per event.
    """
    for event in harness.run(payload):
        yield event.model_dump_json() + "\n"
        if isinstance(event, DryRunDone):
            _logger.info(
                "dry run",
                extra={
                    "dry_run": payload.dry_run,
                    "repository": payload.repository.slug,
                    "status": event.result.status,
                    "stages": len(event.result.stages),
                    "guards_clean": event.result.guards_clean,
                },
            )


@router.post(
    DRY_RUNS_ROUTE,
    summary="Run a deep dry run of a workflow draft, streaming its progress",
    response_class=StreamingResponse,
)
async def dry_run(request: Request, payload: DryRunRequest) -> StreamingResponse:
    """Run one dry run and stream it back.

    Args:
        request: The incoming request, read for the installed harness.
        payload: The validated dry run — a body that does not validate is the ``422``
            envelope before anything is read or invoked.

    Returns:
        A ``200`` streaming ``application/x-ndjson``: ``stage_started``, ``stage_finished``
        and ``guard_blocked`` events as they happen, then exactly one ``done``.
    """
    return StreamingResponse(
        _lines(_harness(request), payload), media_type=NDJSON_MEDIA_TYPE
    )
