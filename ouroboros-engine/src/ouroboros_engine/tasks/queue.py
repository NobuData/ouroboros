"""The in-process task queue and its worker pool (#54).

``submit`` validates a task against the :class:`~.registry.TaskRegistry`, records it
``queued`` and puts it on an :class:`asyncio.Queue`; a fixed pool of worker coroutines takes
tasks off it and runs each handler as a child :class:`asyncio.Task`, so cancelling one task
never stops the worker that was running it. ``get`` and ``cancel`` read and change the
in-memory record.

Everything runs on the application's event loop: :meth:`TaskQueue.start` and
:meth:`TaskQueue.stop` are called from the FastAPI lifespan, and every route that touches
the queue is ``async``, so no lock is needed.

**Restart behaviour — nothing here is durable, on purpose.** Records live in this process's
memory only:

* On a **graceful shutdown** :meth:`TaskQueue.stop` cancels every running handler and marks
  it ``cancelled`` with :data:`~.contract.ENGINE_SHUTDOWN`; queued tasks never start.
* After **any restart** (graceful or not) every id the previous process issued answers
  ``404 task_not_found``. The caller — ``ouroboros-rest``, which owns every durable row —
  treats that as "lost" and resubmits, which is the supervision model
  ``docs/DECISION_EXECUTION_ENGINE.md`` settles. A handler must therefore be safe to run
  again from the start.

When an external queue is worth its cost is ``docs/DECISION_TASK_QUEUE.md``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from .contract import (
    ENGINE_SHUTDOWN,
    FINAL_STATUSES,
    TASK_CRASHED,
    TaskError,
    TaskFailedError,
    TaskRecord,
    TaskStatus,
)
from .registry import TaskKind, TaskRegistry

#: Workers in the pool: how many tasks one engine process runs at once.
DEFAULT_WORKERS = 4

#: Most tasks that may wait in the queue. Past it a submission is refused rather than
#: queued behind work that will not start for a long time.
DEFAULT_MAX_PENDING = 1000

#: Finished tasks kept for polling; the oldest is forgotten first. Bounds memory on a
#: long-lived process, at the price of a very old id answering ``404``.
DEFAULT_RETAIN_FINISHED = 1000

_logger = logging.getLogger(__name__)


class QueueFullError(RuntimeError):
    """The queue already holds :attr:`TaskQueue.max_pending` waiting tasks."""


class QueueNotRunningError(RuntimeError):
    """A task was submitted while the worker pool is not running."""


def _now() -> datetime:
    """The current time, in UTC.

    Returns:
        An aware :class:`datetime`.
    """
    return datetime.now(UTC)


@dataclass
class _Entry:
    """The mutable record behind one :class:`TaskRecord`."""

    task_id: str
    kind: TaskKind
    payload: BaseModel
    status: TaskStatus = "queued"
    result: dict[str, Any] | None = None
    error: TaskError | None = None
    created_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    def snapshot(self) -> TaskRecord:
        """Copy the entry into the wire model.

        Returns:
            The record as it stands now.
        """
        return TaskRecord(
            task_id=self.task_id,
            task_kind=self.kind.name,
            status=self.status,
            payload=self.payload.model_dump(),
            result=self.result,
            error=self.error,
            created_at=self.created_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
        )


class TaskQueue:
    """A registry-backed asyncio queue with a fixed worker pool."""

    def __init__(
        self,
        registry: TaskRegistry,
        *,
        workers: int = DEFAULT_WORKERS,
        max_pending: int = DEFAULT_MAX_PENDING,
        retain_finished: int = DEFAULT_RETAIN_FINISHED,
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        """Configure the queue; nothing runs until :meth:`start`.

        Args:
            registry: Where kinds are looked up.
            workers: Pool size; at least 1.
            max_pending: Most tasks waiting at once; at least 1.
            retain_finished: Finished records kept for polling; at least 1.
            id_factory: Issues task ids. A test passes a fixed sequence.

        Raises:
            ValueError: If a bound is below 1.
        """
        if min(workers, max_pending, retain_finished) < 1:
            raise ValueError("workers, max_pending and retain_finished must be >= 1")
        self.registry = registry
        self.workers = workers
        self.max_pending = max_pending
        self._retain = retain_finished
        self._new_id = id_factory
        self._entries: dict[str, _Entry] = {}
        self._finished: deque[str] = deque()
        self._running: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._queue: asyncio.Queue[str] | None = None
        self._pool: list[asyncio.Task[None]] = []

    @property
    def started(self) -> bool:
        """Whether the worker pool is running."""
        return bool(self._pool)

    async def start(self) -> None:
        """Start the worker pool on the running loop. Calling it twice does nothing."""
        if self._pool:
            return
        self._queue = asyncio.Queue(maxsize=self.max_pending)
        self._pool = [
            asyncio.create_task(self._work(self._queue), name=f"task-worker-{index}")
            for index in range(self.workers)
        ]

    async def stop(self) -> None:
        """Stop the pool: cancel running handlers, then the workers.

        Running tasks end ``cancelled`` with :data:`~.contract.ENGINE_SHUTDOWN`; queued tasks
        stay ``queued`` — they are lost with the process either way (see the module
        docstring).
        """
        for task_id, handler in list(self._running.items()):
            self._finish(
                self._entries[task_id],
                "cancelled",
                error=TaskError(
                    code=ENGINE_SHUTDOWN,
                    message="The engine shut down while the task was running.",
                ),
            )
            handler.cancel()
        for worker in self._pool:
            worker.cancel()
        await asyncio.gather(*self._pool, return_exceptions=True)
        self._pool = []
        self._queue = None

    def submit(self, task_kind: str, payload: dict[str, Any]) -> TaskRecord:
        """Validate a task and queue it.

        Args:
            task_kind: The registered kind.
            payload: Its arguments, validated against the kind's payload model.

        Returns:
            The new record, ``queued``.

        Raises:
            UnknownTaskKindError: If no kind is registered under ``task_kind``.
            pydantic.ValidationError: If the payload does not validate.
            QueueNotRunningError: If :meth:`start` has not run.
            QueueFullError: If :attr:`max_pending` tasks are already waiting.
        """
        kind = self.registry.get(task_kind)
        validated = kind.payload_model.model_validate(payload)
        if self._queue is None:
            raise QueueNotRunningError("the task worker pool is not running")
        if self._queue.full():
            raise QueueFullError(f"{self.max_pending} tasks are already waiting")

        entry = _Entry(task_id=self._new_id(), kind=kind, payload=validated)
        self._entries[entry.task_id] = entry
        self._queue.put_nowait(entry.task_id)
        _logger.info(
            "task queued", extra={"task_id": entry.task_id, "task_kind": kind.name}
        )
        return entry.snapshot()

    def get(self, task_id: str) -> TaskRecord | None:
        """Read a task.

        Args:
            task_id: The id :meth:`submit` issued.

        Returns:
            The record, or ``None`` if this process holds none under that id.
        """
        entry = self._entries.get(task_id)
        return None if entry is None else entry.snapshot()

    def cancel(self, task_id: str) -> TaskRecord | None:
        """Cancel a task that has not finished. A finished task is left as it is.

        A queued task is marked ``cancelled`` at once and skipped when a worker reaches it.
        A running task's handler is cancelled and the record marked ``cancelled`` at once,
        so the answer to this call is already final.

        Args:
            task_id: The id :meth:`submit` issued.

        Returns:
            The record after the call, or ``None`` if this process holds none under that id.
        """
        entry = self._entries.get(task_id)
        if entry is None:
            return None
        if entry.status not in FINAL_STATUSES:
            handler = self._running.get(task_id)
            self._finish(entry, "cancelled")
            if handler is not None:
                handler.cancel()
        return entry.snapshot()

    async def _work(self, queue: asyncio.Queue[str]) -> None:
        """One worker: take the next task, run it, repeat until cancelled.

        Args:
            queue: The queue :meth:`start` made.
        """
        while True:
            task_id = await queue.get()
            try:
                await self._run(task_id)
            finally:
                queue.task_done()

    async def _run(self, task_id: str) -> None:
        """Run one task's handler and record how it ended.

        Args:
            task_id: The task to run. Skipped if it was cancelled while queued.
        """
        entry = self._entries.get(task_id)
        if entry is None or entry.status != "queued":
            return
        entry.status = "running"
        entry.started_at = _now()
        handler = asyncio.create_task(
            entry.kind.handler(entry.payload), name=f"task-{task_id}"
        )
        self._running[task_id] = handler
        try:
            result = await handler
        except asyncio.CancelledError:
            # The worker itself is being cancelled (`stop`): make sure the handler is
            # stopped too, then let the worker end. Otherwise `cancel` cancelled only the
            # handler and already recorded it, and this worker carries on.
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                handler.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await handler
                raise
            self._finish(entry, "cancelled")
        except TaskFailedError as failure:
            self._finish(
                entry,
                "failed",
                error=TaskError(code=failure.code, message=failure.message),
            )
        except Exception:
            _logger.exception(
                "task crashed", extra={"task_id": task_id, "task_kind": entry.kind.name}
            )
            self._finish(
                entry,
                "failed",
                error=TaskError(
                    code=TASK_CRASHED, message="The task's handler failed unexpectedly."
                ),
            )
        else:
            self._finish(entry, "done", result=result)
        finally:
            self._running.pop(task_id, None)

    def _finish(
        self,
        entry: _Entry,
        status: TaskStatus,
        *,
        result: dict[str, Any] | None = None,
        error: TaskError | None = None,
    ) -> None:
        """Move an entry to a final status, once, and age out the oldest finished one.

        Args:
            entry: The entry.
            status: A final status.
            result: The handler's answer, for ``done``.
            error: Why, for ``failed`` or a shutdown.
        """
        if entry.status in FINAL_STATUSES:
            return
        entry.status = status
        entry.result = result
        entry.error = error
        entry.finished_at = _now()
        _logger.info(
            "task finished",
            extra={
                "task_id": entry.task_id,
                "task_kind": entry.kind.name,
                "status": status,
            },
        )
        self._finished.append(entry.task_id)
        while len(self._finished) > self._retain:
            self._entries.pop(self._finished.popleft(), None)
