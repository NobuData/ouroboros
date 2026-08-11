"""Logging: the level from OURO_LOG_LEVEL, and one JSON object per record."""

import json
import logging
import sys
import typing
from collections.abc import Iterator

import pytest

from ouroboros_engine.core.logging import _LEVELS, JsonFormatter, configure_logging
from ouroboros_engine.settings import LogLevel

#: The loggers uvicorn owns and :func:`configure_logging` adopts.
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


@pytest.fixture(autouse=True)
def restored_uvicorn_loggers() -> Iterator[None]:
    """Put uvicorn's loggers back the way the test found them.

    They are process-wide, and the tests below both clear their handlers and change
    their levels; leaving that behind would make an unrelated test's output depend on
    which of these ran first.

    Yields:
        Nothing — the value is the restoration that happens afterwards.
    """
    saved = [
        (logger, list(logger.handlers), logger.propagate, logger.level)
        for logger in map(logging.getLogger, _UVICORN_LOGGERS)
    ]
    yield
    for logger, handlers, propagate, level in saved:
        logger.handlers[:] = handlers
        logger.propagate = propagate
        logger.setLevel(level)


def _record(**overrides: object) -> logging.LogRecord:
    """Build a log record to format.

    Args:
        **overrides: Attributes to set on the record after construction, standing in
            for what a call site passes as ``extra``.

    Returns:
        An INFO record from a named logger, carrying the overrides.
    """
    record = logging.LogRecord(
        name="ouroboros_engine.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="engine started",
        args=(),
        exc_info=None,
    )
    for key, value in overrides.items():
        setattr(record, key, value)
    return record


def _formatted(**overrides: object) -> dict:
    """Format a record and parse the result.

    Args:
        **overrides: Passed to :func:`_record`.

    Returns:
        The rendered record, decoded from JSON.
    """
    return json.loads(JsonFormatter().format(_record(**overrides)))


def test_every_accepted_level_has_a_mapping() -> None:
    assert set(_LEVELS) == set(typing.get_args(LogLevel)), (
        "a level Settings accepts but this module cannot map would be a KeyError "
        "while the application is being built"
    )


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        ("debug", logging.DEBUG),
        ("info", logging.INFO),
        ("warning", logging.WARNING),
        ("error", logging.ERROR),
    ],
)
def test_the_root_logger_is_set_to_the_requested_level(
    level: LogLevel, expected: int
) -> None:
    configure_logging(level)

    assert logging.getLogger().level == expected


def test_configuring_twice_does_not_accumulate_handlers() -> None:
    configure_logging("info")
    after_first = len(logging.getLogger().handlers)

    configure_logging("debug")

    assert len(logging.getLogger().handlers) == after_first, (
        "every application build calls this, and duplicated handlers duplicate lines"
    )


def test_the_last_call_wins() -> None:
    configure_logging("error")
    configure_logging("debug")

    assert logging.getLogger().level == logging.DEBUG


def test_the_installed_handler_writes_json() -> None:
    # Formatted rather than emitted: configure_logging replaces the root handlers, so
    # asserting on the handler it installed is what actually covers the wiring.
    configure_logging("info")
    handler = logging.getLogger().handlers[0]

    payload = json.loads(handler.format(_record()))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "ouroboros_engine.test"
    assert payload["message"] == "engine started"


def test_a_record_is_one_line() -> None:
    # A record split over several lines is several records to whatever collects them.
    rendered = JsonFormatter().format(_record(msg="first\nsecond"))

    assert "\n" not in rendered
    assert json.loads(rendered)["message"] == "first\nsecond"


def test_the_timestamp_is_iso_8601_in_utc() -> None:
    payload = _formatted()

    assert payload["timestamp"].endswith("+00:00"), (
        "a timestamp without an offset is ambiguous wherever the container runs"
    )


def test_the_message_is_rendered_with_its_arguments() -> None:
    record = logging.LogRecord(
        name="ouroboros_engine.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="served %s in %d ms",
        args=("/v0/status", 3),
        exc_info=None,
    )

    payload = json.loads(JsonFormatter().format(record))

    assert payload["message"] == "served /v0/status in 3 ms"


def test_extra_fields_become_top_level_keys() -> None:
    payload = _formatted(path="/v0/status", method="GET", key_present=False)

    assert payload["path"] == "/v0/status"
    assert payload["method"] == "GET"
    assert payload["key_present"] is False


def test_the_standard_record_attributes_are_not_dumped() -> None:
    payload = _formatted()

    for noise in ("args", "msg", "pathname", "lineno", "levelno", "relativeCreated"):
        assert noise not in payload, (
            "a record carries a lot the stdlib put there; only the call site's own "
            "fields are worth indexing"
        )


def test_uvicorns_ansi_coloured_duplicate_of_the_message_is_dropped() -> None:
    # uvicorn attaches `color_message` to its own records for the handler it would have
    # installed; escape codes in a log index are noise.
    payload = _formatted(color_message="Started server process [\x1b[36m%d\x1b[0m]")

    assert "color_message" not in payload
    assert "\x1b" not in json.dumps(payload)


def test_an_extra_field_cannot_overwrite_a_base_field() -> None:
    payload = _formatted(level="TRACE", logger="somewhere-else")

    assert payload["level"] == "INFO", "the record's own level survives"
    assert payload["logger"] == "ouroboros_engine.test"
    assert payload["level_"] == "TRACE", "and what the call site passed is still there"
    assert payload["logger_"] == "somewhere-else"


def test_a_value_that_is_not_json_serialisable_is_rendered_rather_than_raising() -> (
    None
):
    payload = _formatted(settings=object())

    assert payload["settings"].startswith("<object object"), (
        "a logging call must not be able to fail the request it was describing"
    )


def test_an_exception_is_rendered_with_its_traceback() -> None:
    try:
        raise ValueError("no")
    except ValueError:
        record = _record()
        record.exc_info = sys.exc_info()

    payload = json.loads(JsonFormatter().format(record))

    assert "ValueError: no" in payload["exception"]
    assert "\n" not in JsonFormatter().format(record), "still one line"


def test_uvicorns_records_are_routed_through_the_same_handler() -> None:
    # uvicorn installs handlers of its own with propagate off, so without this a served
    # process writes two formats: JSON from the application, plain text from the server.
    uvicorn_logger = logging.getLogger("uvicorn.access")
    uvicorn_logger.addHandler(logging.StreamHandler())
    uvicorn_logger.propagate = False

    configure_logging("info")

    assert uvicorn_logger.handlers == []
    assert uvicorn_logger.propagate is True


def test_uvicorns_levels_are_left_alone() -> None:
    # uvicorn sets them from --log-level, which dev.py already passes OURO_LOG_LEVEL to.
    logging.getLogger("uvicorn.error").setLevel(logging.CRITICAL)

    configure_logging("info")

    assert logging.getLogger("uvicorn.error").level == logging.CRITICAL
