"""Where live runs execute inside this process — and how queue work becomes one.

#160. ``ouroboros-rest``'s run supervisor calls two engine routes, and this is what answers
them:

* :meth:`ExecutionWorker.submit` (``POST /v0/runs/{run_id}/execute``) starts
  :meth:`~ouroboros_engine.execution.interpreter.Interpreter.execute` on a background thread
  and returns at once — ``no_executor`` when nothing is registered, ``already_running`` when
  this process already holds the run. A submit is how a stale run is resumed: whichever
  worker takes it starts it under a new epoch.
* :meth:`ExecutionWorker.claim` (``POST /v0/execution/claims``) leases a workspace's queue
  head with the executor kinds registered here, opens its run with the lease, the pin, the
  model and the ticket, and submits it.

Like the investigation runner, nothing here is durable: threads are daemon threads, and the
control plane resubmits what a dead process held.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.execution import NO_EXECUTOR
from ouroboros_engine.control_plane.ingest import OpenRunRequest, WorkflowPin
from ouroboros_engine.control_plane.transport import TransportError
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.reporter import RunControl

_log = logging.getLogger(__name__)

#: Already executing in this process.
ALREADY_RUNNING = "already_running"

#: The queue had nothing this worker may claim.
NOTHING_QUEUED = "nothing_queued"

#: The claimed item names no mirrored ticket, so no run can be opened for it.
TICKET_MISSING = "ticket_missing"

#: The claimed item has no pinned workflow version.
WORKFLOW_VERSION_MISSING = "workflow_version_missing"

#: The control plane's claim answer carried no model.
MODEL_MISSING = "model_missing"

#: The control plane could not be reached.
CONTROL_PLANE_UNREACHABLE = "control_plane_unreachable"


@dataclass(frozen=True)
class Submitted:
    """The answer to an execute request.

    Attributes:
        accepted: Whether execution was started.
        reason: Why not, when it was not.
    """

    accepted: bool
    reason: str | None = None


@dataclass(frozen=True)
class Claimed:
    """The answer to a claim request.

    Attributes:
        claimed: Whether a run was opened and submitted.
        run_id: The run, when one was.
        reason: Why not, when nothing was.
    """

    claimed: bool
    run_id: str | None = None
    reason: str | None = None


class ExecutionWorker:
    """Runs executions on background threads and turns queue items into runs."""

    def __init__(
        self,
        control: RunControl,
        registry: ExecutorRegistry,
        execute: Callable[[str], Coroutine[Any, Any, None]],
        *,
        worker: str,
    ) -> None:
        """Hold the collaborators.

        Args:
            control: The control plane — for claims and opens.
            registry: The executors registered here; empty means claim and run nothing.
            execute: Executes one run — :meth:`Interpreter.execute`.
            worker: This worker's name, sent on claims.
        """
        self._control = control
        self._registry = registry
        self._execute = execute
        self._worker = worker
        self._lock = threading.Lock()
        self._held: dict[str, threading.Thread] = {}

    def submit(self, run_id: str) -> Submitted:
        """Start executing a run, unless this process cannot or already does.

        Args:
            run_id: ``runs.id``.

        Returns:
            ``accepted``, or the refusal's reason.
        """
        if not self._registry.kinds():
            return Submitted(accepted=False, reason=NO_EXECUTOR)
        key = run_id.lower()
        with self._lock:
            if key in self._held:
                return Submitted(accepted=False, reason=ALREADY_RUNNING)
            thread = threading.Thread(
                target=self._work, args=(key, run_id), name=f"run-{key}", daemon=True
            )
            self._held[key] = thread
            thread.start()
        return Submitted(accepted=True)

    def holds(self, run_id: str) -> bool:
        """Whether this process is executing a run.

        Args:
            run_id: ``runs.id``.

        Returns:
            ``True`` while its thread runs.
        """
        with self._lock:
            return run_id.lower() in self._held

    def wait(self, run_id: str, timeout: float | None = None) -> bool:
        """Wait for an execution to end. For tests and shutdown.

        Args:
            run_id: ``runs.id``.
            timeout: Seconds to wait; ``None`` waits until it ends.

        Returns:
            ``True`` when it is no longer running here.
        """
        with self._lock:
            held = self._held.get(run_id.lower())
        if held is None:
            return True
        held.join(timeout)
        return not held.is_alive()

    def claim(self, workspace: str) -> Claimed:
        """Lease a workspace's queue head, open its run, and execute it.

        An item that cannot be opened — no ticket, no version, no model — is left alone:
        its lease lapses and the queue offers it again.

        Args:
            workspace: ``organization.id`` or its slug.

        Returns:
            ``claimed`` with the run, or the reason nothing was.
        """
        kinds = self._registry.kinds()
        if not kinds:
            return Claimed(claimed=False, reason=NO_EXECUTOR)
        try:
            item = self._control.claim(workspace, self._worker, executors=kinds)
            if item is None:
                return Claimed(claimed=False, reason=NOTHING_QUEUED)
            if item.ticket is None:
                return Claimed(claimed=False, reason=TICKET_MISSING)
            if item.workflow.version is None:
                return Claimed(claimed=False, reason=WORKFLOW_VERSION_MISSING)
            if not item.model:
                return Claimed(claimed=False, reason=MODEL_MISSING)
            run = self._control.open_run(
                OpenRunRequest(
                    idempotency_key=self._control.key("run.create"),
                    ticket=item.ticket.reference(),
                    repository=item.repository,
                    workflow=WorkflowPin(
                        tag=item.workflow.tag, version=item.workflow.version
                    ),
                    model=item.model,
                    queue_item=item.lease(),
                )
            )
        except ControlPlaneError as refused:
            return Claimed(claimed=False, reason=refused.code)
        except TransportError:
            return Claimed(claimed=False, reason=CONTROL_PLANE_UNREACHABLE)
        self.submit(run.id)
        return Claimed(claimed=True, run_id=run.id)

    def _work(self, key: str, run_id: str) -> None:
        """Execute one run on this thread's own event loop, and let go of it.

        Args:
            key: The run id, lower-cased.
            run_id: The run id as submitted.
        """
        try:
            asyncio.run(self._execute(run_id))
        except Exception:
            # The interpreter reports its own failures; this is the last line of defence.
            _log.exception("execution thread error", extra={"run": key})
        finally:
            with self._lock:
                self._held.pop(key, None)
