"""``POST /v0/tasks/echo`` — the contract exemplar the rest of ``/v0`` is written to.

The engine has no real work to do yet: the task registry, the queue and the worker model
are #54. What it does need, before any of that, is *one working round trip* that settles
the questions every later operation would otherwise settle again — how a request body is
described, how it is validated, what a refusal looks like, and where the version of the
answering build is reported. That is what this route is, and why it is deliberately the
dullest thing in the service: it accepts a task, accepts nothing it was not asked for,
and hands the task straight back.

Three decisions here are the contract rather than this route's own taste, and #35's typed
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

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine import __version__
from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG

#: Where the task routes live under the versioned prefix. ``/tasks`` plural, and the verb
#: after it: the shape #54's ``POST /v0/tasks`` and ``GET /v0/tasks/{id}`` grow into.
TASKS_ROUTE = "/tasks"

#: Longest ``task_kind`` this service accepts. A kind is an identifier chosen by whoever
#: registers a task, not free text, so the bound is generous for a name and far below
#: anything that could be a payload smuggled through the wrong field.
MAX_TASK_KIND_LENGTH = 64

#: What a ``task_kind`` may be: lower-case, starting with a letter, with single ``.``,
#: ``_`` or ``-`` separators between runs of letters and digits. Narrow deliberately —
#: this is the field a future registry looks a handler up by, so it has to survive being
#: a dictionary key, a log field and a metric label without quoting.
TASK_KIND_PATTERN = r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"

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
            ``false``. A task kind that can be *refused* while being well-formed is #54's
            problem, and will be a different field on a different route.
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
