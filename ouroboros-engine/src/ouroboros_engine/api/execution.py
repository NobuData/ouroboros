"""``/v0/runs/{run_id}/execute`` and ``/v0/execution/claims`` — the execution bridge (#160).

``ouroboros-rest``'s run supervisor is the caller:

* ``POST /v0/runs/{run_id}/execute`` → ``202 {accepted, reason}``. A stale live run is
  submitted again here and whichever engine takes it starts it under a new epoch. Refused
  (``accepted: false``) with ``no_executor`` when this process registered no stage
  executor, and ``already_running`` when it is already executing the run.
* ``POST /v0/execution/claims`` ``{workspace}`` → ``200 {claimed, run_id, reason}``. Leases
  the workspace's queue head, opens its run and executes it. Nothing claimed answers
  ``claimed: false`` with ``no_executor``, ``nothing_queued``, or the control plane's own
  refusal code.

Both answer at once; the run is executed in the background and reports to
``ouroboros-rest``'s internal run surface, never through these responses. See
:mod:`ouroboros_engine.execution.worker`.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.execution.worker import ExecutionWorker

#: Submit a run for execution.
EXECUTE_ROUTE = "/runs/{run_id}/execute"

#: Claim and execute a workspace's queue head.
CLAIMS_ROUTE = "/execution/claims"

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


class ExecutionAccepted(BaseModel):
    """The body of a ``POST /v0/runs/{run_id}/execute`` response.

    Attributes:
        accepted: Whether execution started.
        reason: ``no_executor`` or ``already_running`` when it did not; else ``None``.
    """

    accepted: bool = Field(examples=[True])
    reason: str | None = Field(examples=[None])


class ClaimRequest(BaseModel):
    """The body of a ``POST /v0/execution/claims`` request.

    Attributes:
        workspace: ``organization.id`` or its slug.
    """

    model_config = ConfigDict(extra="forbid")

    workspace: str = Field(min_length=1, max_length=128, examples=["acme-robotics"])


class ClaimAnswer(BaseModel):
    """The body of a ``POST /v0/execution/claims`` response.

    Attributes:
        claimed: Whether a run was opened and is executing.
        run_id: That run, when one was.
        reason: Why nothing was claimed, when nothing was.
    """

    claimed: bool = Field(examples=[False])
    run_id: str | None = Field(examples=[None])
    reason: str | None = Field(examples=["nothing_queued"])


def _worker(request: Request) -> ExecutionWorker:
    """The execution worker installed on the application.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.execution`` — a test installs its own.
    """
    return request.app.state.execution


@router.post(
    EXECUTE_ROUTE,
    summary="Execute a live run in the background",
    status_code=202,
    response_model=ExecutionAccepted,
)
def execute_run(request: Request, run_id: str) -> ExecutionAccepted:
    """Submit a run for execution and answer at once.

    Args:
        request: The incoming request, read for the installed worker.
        run_id: ``runs.id``.

    Returns:
        Whether execution started, and why not.
    """
    submitted = _worker(request).submit(run_id)
    return ExecutionAccepted(accepted=submitted.accepted, reason=submitted.reason)


@router.post(
    CLAIMS_ROUTE,
    summary="Claim a workspace's queue head and execute its run",
    response_model=ClaimAnswer,
)
def claim_work(request: Request, payload: ClaimRequest) -> ClaimAnswer:
    """Claim, open and execute — or say why nothing was.

    A plain ``def``: the claim and the open are blocking calls to the control plane, so
    FastAPI runs this on its thread pool.

    Args:
        request: The incoming request, read for the installed worker.
        payload: The workspace.

    Returns:
        The run executing, or the reason nothing is.
    """
    claimed = _worker(request).claim(payload.workspace)
    return ClaimAnswer(
        claimed=claimed.claimed, run_id=claimed.run_id, reason=claimed.reason
    )
