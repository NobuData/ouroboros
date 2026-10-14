"""``/v0/tasks`` — the task queue (#54) and the contract exemplar it grew from.

``POST /v0/tasks`` submits a task to the in-process queue
(:mod:`ouroboros_engine.tasks.queue`) and answers ``202`` with its record;
``GET /v0/tasks/{task_id}`` polls it; ``POST /v0/tasks/{task_id}/cancel`` cancels it. The
record is in this process's memory only — after a restart an id answers ``404
task_not_found`` and ``ouroboros-rest`` resubmits (the queue module states the restart
behaviour in full).

``POST /v0/tasks/echo`` came first: *one working round trip* that settled the questions
every later operation would otherwise settle again — how a request body is described, how
it is validated, what a refusal looks like, and where the version of the answering build is
reported. It accepts a task, accepts nothing it was not asked for, and hands the task
straight back.

Three decisions there are the contract rather than that route's own taste, and #35's typed
client mirrors each of them:

* **The request is closed.** :class:`EchoRequest` forbids a field it does not declare, so
  a caller that misspells ``payload`` is told so instead of having it silently dropped.
  ``ouroboros-rest``'s validation pipe is configured the same way, for the same reason —
  a request that half-worked is worse than one that was refused.
* **The echo is the request model itself.** :attr:`EchoResponse.echo` is an
  :class:`EchoRequest`, not a loose object, so a caller that can build a request can read
  the echo with the same type, and a change to one is a change to both.
* **The answering build names itself.** ``engine_version`` is in the response body rather
  than only in ``GET /v0/status``, because the gateway logs a round trip it made and the
  version that served it belongs in that line without a second call.

A validation failure answers ``422`` in the error envelope — ``{code, message, details}``
with one ``details`` entry per field — which is :mod:`ouroboros_engine.core.errors`, not
this module: the shape belongs to the service, and a route that formatted its own errors
would be the first of several that disagreed.
"""

from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ouroboros_engine import __version__
from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.core.errors import (
    VALIDATION_FAILED,
    VALIDATION_MESSAGE,
    envelope,
    field_messages,
)
from ouroboros_engine.tasks.contract import (
    MAX_TASK_KIND_LENGTH,
    TASK_KIND_PATTERN,
    TASK_KIND_UNKNOWN,
    TASK_NOT_FOUND,
    TASK_QUEUE_FULL,
    TaskRecord,
    TaskSubmitRequest,
)
from ouroboros_engine.tasks.queue import QueueFullError, QueueNotRunningError, TaskQueue
from ouroboros_engine.tasks.registry import UnknownTaskKindError

#: Where the task routes live under the versioned prefix.
TASKS_ROUTE = "/tasks"

router = APIRouter(prefix=f"{V0_PREFIX}{TASKS_ROUTE}", tags=[V0_TAG])


class EchoRequest(BaseModel):
    """The body of a ``POST /v0/tasks/echo`` request.

    Attributes:
        task_kind: Which kind of task this is, as a registry would name it. Validated
            against :data:`TASK_KIND_PATTERN`; the echo stub accepts any kind that
            matches, and refuses one that does not rather than inventing a default.
        payload: The task's own arguments. An open object, because what a task takes is
            the task's business and not the contract's — the contract's business is that
            it is an object rather than a string somebody has to parse twice.
    """

    # Closed: a property this model does not declare is refused rather than dropped. See
    # the module docstring — it is the same decision as ouroboros-rest's whitelist.
    model_config = ConfigDict(extra="forbid")

    task_kind: str = Field(
        min_length=1,
        max_length=MAX_TASK_KIND_LENGTH,
        pattern=TASK_KIND_PATTERN,
        examples=["echo"],
    )
    payload: dict[str, Any] = Field(examples=[{"note": "hello from ouroboros-rest"}])


class EchoResponse(BaseModel):
    """The body of a ``POST /v0/tasks/echo`` response.

    Attributes:
        accepted: Always ``True``. Typed as the literal rather than as a ``bool``
            because this route has exactly one success: a request that validates is
            accepted, and one that does not is a ``422`` rather than a ``200`` carrying
            ``false``. A task kind that can be *refused* while being well-formed is
            ``POST /v0/tasks``'s concern, answered there as ``task_kind_unknown``.
        echo: The request, as it was received and after validation — so a caller sees
            what the engine actually parsed rather than what it believes it sent.
        engine_version: The installed version of the build that answered, the same string
            ``GET /v0/status`` and ``GET /`` report.
    """

    accepted: Literal[True] = Field(examples=[True])
    echo: EchoRequest
    engine_version: str = Field(examples=["0.3.0"])


@router.post(
    "/echo",
    summary="Echo a task back",
    response_model=EchoResponse,
)
async def echo_task(task: EchoRequest) -> EchoResponse:
    """Accept a task and hand it straight back.

    Args:
        task: The validated request body. A body that does not validate never reaches
            this function — FastAPI raises before it is called, and
            :mod:`ouroboros_engine.core.errors` turns that into the ``422`` envelope.

    Returns:
        An :class:`EchoResponse` carrying the task as parsed and the version of the build
        that parsed it.
    """
    return EchoResponse(accepted=True, echo=task, engine_version=__version__)


def _queue(request: Request) -> TaskQueue:
    """The application's task queue.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.tasks``.
    """
    return request.app.state.tasks


def _not_found(task_id: str) -> JSONResponse:
    """The ``404`` for an id this process holds no record of.

    Args:
        task_id: The id asked for.

    Returns:
        The envelope response.
    """
    return JSONResponse(
        status_code=404,
        content=envelope(
            TASK_NOT_FOUND,
            "This engine process holds no task with that id. It may have restarted; "
            "submit the task again.",
            {"task_id": task_id},
        ),
    )


@router.post(
    "",
    summary="Submit a task to the queue",
    status_code=202,
    response_model=TaskRecord,
)
async def submit_task(
    request: Request, task: TaskSubmitRequest
) -> TaskRecord | JSONResponse:
    """Validate a task against its kind and queue it.

    Args:
        request: The incoming request, read for the installed queue.
        task: The validated body.

    Returns:
        ``202`` with the ``queued`` record; ``422 task_kind_unknown`` or
        ``422 validation_failed`` (payload fields under ``details`` as ``payload.<field>``);
        or ``503 task_queue_full``.
    """
    queue = _queue(request)
    try:
        return queue.submit(task.task_kind, task.payload)
    except UnknownTaskKindError:
        return JSONResponse(
            status_code=422,
            content=envelope(
                TASK_KIND_UNKNOWN,
                f"No task kind {task.task_kind!r} is registered on this engine.",
                {"task_kind": task.task_kind, "registered": queue.registry.names()},
            ),
        )
    except ValidationError as invalid:
        # A payload that is wrong as a whole (not one field) is reported as "request";
        # under this route it is the payload that is wrong, so it is named that.
        details = {
            "payload" if field == "request" else f"payload.{field}": messages
            for field, messages in field_messages(invalid.errors()).items()
        }
        return JSONResponse(
            status_code=422,
            content=envelope(VALIDATION_FAILED, VALIDATION_MESSAGE, details),
        )
    except (QueueFullError, QueueNotRunningError):
        return JSONResponse(
            status_code=503,
            content=envelope(
                TASK_QUEUE_FULL,
                "The task queue is not accepting work right now. Submit it again in a "
                "moment.",
            ),
        )


@router.get(
    "/{task_id}",
    summary="Read a task's status",
    response_model=TaskRecord,
)
async def get_task(request: Request, task_id: str) -> TaskRecord | JSONResponse:
    """Poll a task.

    Args:
        request: The incoming request, read for the installed queue.
        task_id: The id ``POST /v0/tasks`` issued.

    Returns:
        ``200`` with the record, or ``404 task_not_found``.
    """
    record = _queue(request).get(task_id)
    return _not_found(task_id) if record is None else record


@router.post(
    "/{task_id}/cancel",
    summary="Cancel a task",
    response_model=TaskRecord,
)
async def cancel_task(request: Request, task_id: str) -> TaskRecord | JSONResponse:
    """Cancel a queued or running task; a finished one is answered unchanged.

    Args:
        request: The incoming request, read for the installed queue.
        task_id: The id ``POST /v0/tasks`` issued.

    Returns:
        ``200`` with the record after the call — ``cancelled`` unless it had already
        finished — or ``404 task_not_found``.
    """
    record = _queue(request).cancel(task_id)
    return _not_found(task_id) if record is None else record
