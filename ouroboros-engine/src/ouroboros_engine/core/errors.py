"""The error envelope — one shape for every failure, on both sides of the gateway.

``docs/ARCHITECTURE.md`` § 5.3 asks for ``{code, message, details}`` from *both* services,
so that a failure crossing ``ouroboros-rest``'s gateway does not change form on the way
out. The REST layer decided that shape first (#31, ``src/modules/errors/``); this module
is the engine's half of the same agreement, and it deliberately mirrors that file's
decisions rather than inventing parallel ones:

* **``code`` is stable and machine-readable**, lower-case and underscore-separated, and is
  what a caller branches on. It is derived from the status
  (:func:`code_for_status`) rather than looked up per call site, so a status this service
  has never answered with still carries an honest code instead of ``unknown_error``.
* **``message`` is written for a person**, and a ``5xx`` never carries its own. The real
  diagnosis names a path, an exception type or a stack; that goes to the log, where only
  an operator inside the cluster reads it, and the caller gets
  :data:`INTERNAL_ERROR_MESSAGE`. It is the same rule the guard already applies to a
  rejection (:mod:`ouroboros_engine.core.security`) and the REST layer to a probe.
* **``details`` is always an object, never absent.** A caller reading
  ``details["task_kind"]`` should not have to check whether ``details`` exists first, and
  an optional field would let the two services disagree about the empty case.

Three handlers make the envelope true of *every* answer rather than only the ones a route
produced deliberately — a body pydantic refused, a path no router claims, a method a path
does not allow, and an exception nobody expected. Without them those four answer in three
different shapes (FastAPI's ``{"detail": …}``, a validation error's ``{"detail": [ … ]}``
and Starlette's plain-text ``Internal Server Error``), and the gateway on the other side
would need a parser per layer.

The one thing this module never does is *re-raise a message it did not write*. The engine
is internal, but its failures are read by a service that answers a browser, and every
string here is a constant in this repository or a validator's own description of a field.
"""

import logging
from collections.abc import Sequence
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

_logger = logging.getLogger(__name__)

#: The status at which a failure stops being the caller's and becomes the service's.
#: Above it, the message the caller reads is a constant — see the module docstring.
SERVER_ERROR_FLOOR = 500

#: What a caller is told when the service itself failed. Constant, deliberately: the real
#: message is in the log, and this is the same sentence ``ouroboros-rest`` sends for the
#: same case.
INTERNAL_ERROR_MESSAGE = (
    "The service failed to handle this request. The failure has been logged."
)

#: The code every request-validation failure carries. Documented on every operation that
#: can answer ``422``, and the same code the REST layer's own validation answers with.
VALIDATION_FAILED = "validation_failed"

#: What a person is told about a validation failure. The specifics are in ``details``,
#: one entry per field — again word for word what ``ouroboros-rest`` sends.
VALIDATION_MESSAGE = "The request is not valid. See `details` for each field."

#: Codes for the statuses this service can answer with. Only the ones it can actually
#: produce are listed; :func:`code_for_status` derives the rest rather than defaulting
#: them to a single catch-all, which is the hole a caller's ``match code`` falls through.
_GENERIC_CODES: dict[int, str] = {
    HTTPStatus.BAD_REQUEST: "bad_request",
    HTTPStatus.UNAUTHORIZED: "unauthenticated",
    HTTPStatus.FORBIDDEN: "forbidden",
    HTTPStatus.NOT_FOUND: "not_found",
    HTTPStatus.METHOD_NOT_ALLOWED: "method_not_allowed",
    HTTPStatus.NOT_ACCEPTABLE: "not_acceptable",
    HTTPStatus.UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    HTTPStatus.UNPROCESSABLE_ENTITY: "unprocessable_entity",
    HTTPStatus.INTERNAL_SERVER_ERROR: "internal_error",
}

#: The first element of a pydantic error's ``loc`` when the fault is in a whole request
#: part rather than in one of its fields. Dropped from the key a caller reads, so
#: ``("body", "task_kind")`` is reported as ``task_kind`` — the name the caller typed,
#: which is what ``ouroboros-rest``'s ``details`` carries for the same failure.
_REQUEST_PARTS = frozenset({"body", "query", "path", "header", "cookie"})


class ErrorEnvelope(BaseModel):
    """The body of every error response this service sends.

    Attributes:
        code: Stable, machine-readable, and the thing a caller branches on.
        message: Written for a person. Never an exception's text, never a stack.
        details: Whatever is specific to this failure — for a ``422``, one entry per
            field that was refused. Required rather than defaulted, deliberately: the
            contract is that it is *empty* when there is nothing to say rather than
            missing, and a default here would let a caller of :func:`envelope` produce a
            body the document says cannot exist.
    """

    code: str = Field(examples=["validation_failed"])
    message: str = Field(examples=[VALIDATION_MESSAGE])
    details: dict[str, Any] = Field(examples=[{}])


def code_for_status(status: int) -> str:
    """The stable code for a status this service is answering with.

    Args:
        status: The HTTP status of the failure.

    Returns:
        Its code from :data:`_GENERIC_CODES`, or one derived from which half of the
        status range it falls in — so a status nobody has written a code for is still
        reported as ``bad_request`` or ``internal_error`` rather than as nothing.
    """
    derived = "bad_request" if status < SERVER_ERROR_FLOOR else "internal_error"
    return _GENERIC_CODES.get(status, derived)


def envelope(code: str, message: str, details: dict[str, Any] | None = None) -> dict:
    """Build the body of an error response.

    Args:
        code: The stable code.
        message: What a person reads.
        details: Whatever is specific to this failure. Omitted, it is an empty object —
            never a missing key.

    Returns:
        The envelope as plain data, ready to be handed to a response. Built through
        :class:`ErrorEnvelope` rather than as a literal, so the one description of the
        shape is the model the specification is checked against.
    """
    return ErrorEnvelope(code=code, message=message, details=details or {}).model_dump()


def field_messages(errors: Sequence[Any]) -> dict[str, list[str]]:
    """Turn pydantic's report into ``details``: what was wrong, keyed by field.

    Nested objects and list elements are addressed the way a caller would write them —
    ``payload.items.0`` — so the offending input can be pointed at without walking a
    tree. That is the same addressing ``ouroboros-rest`` uses, because the two services
    answer the same client through one gateway.

    Args:
        errors: What :meth:`fastapi.exceptions.RequestValidationError.errors` reported.
            Typed loosely because pydantic's ``ErrorDetails`` is a ``TypedDict`` whose
            shape varies with the error, and this reads two of its keys.

    Returns:
        Field path to every message about it. A field with two complaints gets two
        entries in its list rather than the last one winning.
    """
    fields: dict[str, list[str]] = {}

    for error in errors:
        location = tuple(error.get("loc", ()))
        # `("body", "task_kind")` is the caller's `task_kind`; a bare `("body",)` —
        # which is what a body that is not an object at all reports — keeps the part's
        # own name, because there is no field to blame and "" would be no key at all.
        if location and location[0] in _REQUEST_PARTS:
            part, *rest = location
            location = tuple(rest) or (part,)

        path = ".".join(str(part) for part in location) or "request"
        fields.setdefault(path, []).append(str(error.get("msg", "is not valid")))

    return fields


async def handle_validation_error(
    _request: Request, error: RequestValidationError
) -> JSONResponse:
    """Answer a request pydantic refused with the envelope rather than FastAPI's shape.

    FastAPI's own handler answers ``422 {"detail": [ … ]}``, where ``detail`` is a list
    of objects carrying the rejected input back to the caller. Both halves are wrong
    here: the shape is not the envelope, and echoing the input means a value that was
    refused is written into whatever logs the gateway's response.

    Args:
        _request: The request that failed. Unread — what the caller gets says nothing
            about which path it was, matching the guard's own silence.
        error: What pydantic reported.

    Returns:
        A ``422`` carrying :data:`VALIDATION_FAILED` and one ``details`` entry per
        invalid field.
    """
    details = field_messages(error.errors())

    return JSONResponse(
        envelope(VALIDATION_FAILED, VALIDATION_MESSAGE, details),
        status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
    )


async def handle_http_exception(
    _request: Request, error: HTTPException
) -> JSONResponse:
    """Answer a deliberate HTTP failure — a routing miss, a method a path refuses.

    Args:
        _request: The request that failed. Unread, as above.
        error: The exception Starlette or a route raised.

    Returns:
        The status it names, carrying the envelope. A ``4xx`` keeps the exception's own
        detail, which for the ones this service can raise is a status phrase written by
        the framework rather than anything about the inside of the process; a ``5xx``
        gets :data:`INTERNAL_ERROR_MESSAGE` instead, because a status somebody chose
        deliberately does not make the message beside it fit to publish. Any headers the
        exception carried are kept — a ``405`` without its ``Allow`` is a worse answer
        than no ``405`` at all.
    """
    server_error = error.status_code >= SERVER_ERROR_FLOOR
    if server_error:
        _logger.error(
            "a request failed",
            extra={"status": error.status_code, "detail": str(error.detail)},
        )

    message = INTERNAL_ERROR_MESSAGE if server_error else str(error.detail)

    return JSONResponse(
        envelope(code_for_status(error.status_code), message),
        status_code=error.status_code,
        headers=error.headers,
    )


async def handle_unexpected_error(_request: Request, error: Exception) -> JSONResponse:
    """Answer a failure nobody expected, without saying what it was.

    Starlette's own answer to an unhandled exception is the plain text ``Internal Server
    Error`` — not JSON at all, and so not something the gateway can parse as an envelope.

    Args:
        _request: The request that failed. Unread, as above.
        error: Whatever was raised.

    Returns:
        A ``500`` carrying :data:`INTERNAL_ERROR_MESSAGE`. The exception is logged with
        its traceback first: this is the only record of what actually happened, because
        the caller is told nothing.
    """
    _logger.exception("an unhandled exception ended a request", exc_info=error)

    return JSONResponse(
        envelope(
            code_for_status(HTTPStatus.INTERNAL_SERVER_ERROR), INTERNAL_ERROR_MESSAGE
        ),
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
    )


def register_error_handlers(app: FastAPI) -> None:
    """Make the envelope the shape of every failure this application can answer with.

    Called by :func:`ouroboros_engine.main.create_app` for every application it builds,
    including the ones a test builds, so no suite exercises a service whose errors are
    shaped differently from the deployed one.

    Args:
        app: The application to register the three handlers on.
    """
    # Registered against Starlette's HTTPException rather than FastAPI's subclass of it:
    # the ones this service does not raise itself — the 404 for an unclaimed path, the
    # 405 for a method a path does not allow — come from the router as Starlette's, and
    # a handler registered against the subclass would never see them.
    app.add_exception_handler(HTTPException, handle_http_exception)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
