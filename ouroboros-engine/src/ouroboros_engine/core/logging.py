"""Logging configuration, applied once while the application is being built.

Records are emitted as **one JSON object per line**. The engine runs in a container
whose output is collected by something that indexes it, and a line like ``rejected an
internal request without a valid key`` is worth little next to the same event carrying
``path`` and ``method`` as fields something can filter on. A human reading ``docker
logs`` still gets one line per record with the message in it.

Two rules hold for what is written:

* **A record is a flat object.** ``timestamp``, ``level``, ``logger``, ``message``,
  then whatever the call site passed as ``extra``. Nested structure would have to be
  flattened again by whatever reads it.
* **Nothing is logged that was not passed.** No environment, no headers, no request
  bodies. The engine holds a shared secret, and a logger that helpfully dumps context
  is how a credential ends up in a log index.

uvicorn's own records are routed through the same handler
(:func:`_adopt_uvicorn_loggers`), so a served process emits one format rather than
JSON from the application and plain text from the server underneath it.
"""

import json
import logging
from datetime import UTC, datetime

from ouroboros_engine.settings import LogLevel

#: Maps the lower-case values ``OURO_LOG_LEVEL`` accepts onto the stdlib's constants.
#: The keys are exhaustive over :data:`ouroboros_engine.settings.LogLevel`; a value that
#: is not one of them cannot reach here, because settings validation rejects it first.
_LEVELS: dict[LogLevel, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}

#: Attribute names the stdlib puts on every record. Anything on a record that is *not*
#: one of these was passed by the call site as ``extra`` and belongs in the output.
#: Derived from a throwaway record rather than typed out, so a field the standard
#: library adds in a future Python is excluded without this file being edited — and the
#: two the formatter itself computes are added by hand, because they only exist after
#: :meth:`logging.Formatter.format` has run.
_STANDARD_RECORD_FIELDS = (
    frozenset(logging.LogRecord("", logging.NOTSET, "", 0, "", (), None).__dict__)
    | {"message", "asctime"}
    # uvicorn attaches the same message a second time with ANSI colour codes in it,
    # for the handler it would have installed. Terminal escapes in a log index are
    # noise, and it is the only field a library adds behind the engine's back.
    | {"color_message"}
)

#: The keys every record carries, in the order they are written. Named so a call site
#: that passes ``extra={"level": ...}`` can be caught rather than silently overwriting
#: the record's own level (see :meth:`JsonFormatter.format`).
_BASE_FIELDS = ("timestamp", "level", "logger", "message")


class JsonFormatter(logging.Formatter):
    """Render a log record as a single-line JSON object.

    Whatever a call site passed as ``extra`` becomes a top-level key, so
    ``_logger.warning("rejected", extra={"path": "/v0/status"})`` is queryable as
    ``path`` rather than as a substring of a sentence.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Serialise one record.

        Args:
            record: The record to render.

        Returns:
            A JSON object on one line: the four base fields, then any ``extra`` the
            call site attached, then ``exception`` when the record carries a traceback.
            A value that is not JSON-serialisable is rendered with :func:`str` rather
            than raising — a logging call must not be able to fail the request it was
            describing.
        """
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # A base field is never overwritten: a caller who passes extra={"message": ...}
        # gets it alongside the record's own under a suffixed key, because losing the
        # real level or logger of a record is worse than an ugly key.
        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_FIELDS:
                continue
            payload[f"{key}_" if key in _BASE_FIELDS else key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        return json.dumps(payload, default=str)


def configure_logging(level: LogLevel) -> None:
    """Configure the root logger for the whole process.

    Safe to call more than once — ``force=True`` replaces any handlers already attached,
    which is what makes the result the same whether the application is built by uvicorn,
    by a test, or by an import in a REPL.

    Args:
        level: Verbosity to apply, as validated by
            :class:`ouroboros_engine.settings.Settings`.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=_LEVELS[level], handlers=[handler], force=True)
    _adopt_uvicorn_loggers()


def _adopt_uvicorn_loggers() -> None:
    """Make uvicorn's records come out of this process's handler, in this format.

    uvicorn installs handlers of its own with ``propagate`` turned off, so by default a
    served process writes two formats: JSON from the application and uvicorn's own
    plain text for startup and access lines. Clearing those handlers and letting the
    records propagate puts every line through the formatter above.

    Their *levels* are left alone. uvicorn sets them from ``--log-level``, which
    :mod:`ouroboros_engine.dev` already passes ``OURO_LOG_LEVEL`` to, so the two agree
    without this function reaching into a library's configuration any further than it
    has to.
    """
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
