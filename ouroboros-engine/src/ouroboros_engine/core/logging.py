"""Logging configuration, applied once while the application is being built.

This is the plain-text form: a level from ``OURO_LOG_LEVEL`` and a line format that
names the logger. Structured JSON records — the form something can parse — are part of
#51, and land here rather than anywhere else.
"""

import logging

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

#: One line per record, naming the logger so engine output is distinguishable from
#: uvicorn's own once both are running under the same process.
_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


def configure_logging(level: LogLevel) -> None:
    """Configure the root logger for the whole process.

    Safe to call more than once — ``force=True`` replaces any handlers already attached,
    which is what makes the result the same whether the application is built by uvicorn,
    by a test, or by an import in a REPL.

    Args:
        level: Verbosity to apply, as validated by
            :class:`ouroboros_engine.settings.Settings`.
    """
    logging.basicConfig(level=_LEVELS[level], format=_FORMAT, force=True)
