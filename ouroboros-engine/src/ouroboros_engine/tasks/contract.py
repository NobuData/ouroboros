"""The shapes ``POST /v0/tasks`` and ``GET /v0/tasks/{task_id}`` speak (#54).

Kept apart from the router for the same reason the estimate shapes are: the queue behind the
routes is expected to be replaced — by an external queue, if the graduation triggers in
``docs/DECISION_TASK_QUEUE.md`` are ever met — and the contract it answers through is not
allowed to move when it is.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

#: Longest ``task_kind`` this service accepts. A kind is an identifier chosen by whoever
#: registers a task, not free text, so the bound is generous for a name and far below
#: anything that could be a payload smuggled through the wrong field.
MAX_TASK_KIND_LENGTH = 64

#: What a ``task_kind`` may be: lower-case, starting with a letter, with single ``.``,
#: ``_`` or ``-`` separators between runs of letters and digits. Narrow deliberately —
#: this is the field the registry looks a handler up by, so it has to survive being
#: a dictionary key, a log field and a metric label without quoting.
TASK_KIND_PATTERN = r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"

#: Where a task is in its life. ``queued`` and ``running`` are the only states that change;
#: the other three are final, and a final task never changes again.
TaskStatus = Literal["queued", "running", "done", "failed", "cancelled"]

#: The states a task never leaves.
FINAL_STATUSES: frozenset[str] = frozenset({"done", "failed", "cancelled"})

#: ``details`` / record code for a ``task_kind`` no handler is registered under.
TASK_KIND_UNKNOWN = "task_kind_unknown"

#: Envelope code for an id this process holds no record of — never submitted here, evicted
#: from the finished history, or submitted to a process that has since restarted.
TASK_NOT_FOUND = "task_not_found"

#: Envelope code for a submission refused because the queue is at its bound.
TASK_QUEUE_FULL = "task_queue_full"

#: Record error code for a handler that raised something other than :class:`TaskFailedError`.
TASK_CRASHED = "task_crashed"

#: Record error code for a running task the engine stopped because it was shutting down.
ENGINE_SHUTDOWN = "engine_shutdown"


class TaskFailedError(Exception):
    """Raised by a handler to fail its task with a code and a message a person may read.

    Anything else a handler raises is recorded as :data:`TASK_CRASHED` with a generic
    message, because an exception's own text is not written for the caller.
    """

    def __init__(self, code: str, message: str) -> None:
        """Name the failure.

        Args:
            code: Stable, machine-readable; what a caller branches on.
            message: Written for a person.
        """
        super().__init__(message)
        self.code = code
        self.message = message


class TaskSubmitRequest(BaseModel):
    """The body of a ``POST /v0/tasks`` request.

    Attributes:
        task_kind: Which registered handler runs the task. Same pattern and bound as the
            echo exemplar's; a well-formed kind nothing is registered under is refused
            ``422 task_kind_unknown``.
        payload: The task's arguments, validated against the kind's own payload model
            before the task is queued — a payload the handler could not run is a ``422``
            now, not a ``failed`` task later.
    """

    model_config = ConfigDict(extra="forbid")

    task_kind: str = Field(
        min_length=1,
        max_length=MAX_TASK_KIND_LENGTH,
        pattern=TASK_KIND_PATTERN,
        examples=["sleep"],
    )
    payload: dict[str, Any] = Field(default_factory=dict, examples=[{"seconds": 0.5}])


class TaskError(BaseModel):
    """Why a task ended ``failed`` or ``cancelled`` by the engine.

    Attributes:
        code: Stable, machine-readable.
        message: Written for a person.
    """

    code: str = Field(examples=[TASK_CRASHED])
    message: str = Field(examples=["The task's handler failed unexpectedly."])


class TaskRecord(BaseModel):
    """One task as this process knows it — what every task route answers with.

    Attributes:
        task_id: The id the queue assigned at submission.
        task_kind: The registered kind that runs it.
        status: Where it is; see :data:`TaskStatus`.
        payload: The payload as validated, so a caller sees what will actually run.
        result: The handler's answer once ``done``; ``null`` before and otherwise.
        error: Why it ended, when it ended ``failed`` (or was stopped at shutdown);
            ``null`` otherwise.
        created_at: When it was accepted.
        started_at: When a worker picked it up; ``null`` while queued, or if it was
            cancelled before any worker did.
        finished_at: When it reached a final status; ``null`` until then.
    """

    task_id: str = Field(examples=["5f0c6a52-6a1c-4e3b-9a55-1c2f0f9d6a10"])
    task_kind: str = Field(examples=["sleep"])
    status: TaskStatus = Field(examples=["done"])
    payload: dict[str, Any] = Field(examples=[{"seconds": 0.5}])
    result: dict[str, Any] | None = Field(examples=[{"slept_seconds": 0.5}])
    error: TaskError | None = Field(examples=[None])
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
