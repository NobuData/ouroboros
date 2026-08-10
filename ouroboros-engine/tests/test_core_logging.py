"""Logging configuration: the level from OURO_LOG_LEVEL, applied to the root logger."""

import logging
import typing

import pytest

from ouroboros_engine.core.logging import _LEVELS, configure_logging
from ouroboros_engine.settings import LogLevel


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


def test_a_record_is_rendered_with_its_level_and_logger_name() -> None:
    # Formatted rather than emitted: configure_logging replaces the root handlers, so
    # asserting on the handler it installed is what actually covers _FORMAT.
    configure_logging("info")
    handler = logging.getLogger().handlers[0]
    record = logging.LogRecord(
        name="ouroboros_engine.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="engine started",
        args=(),
        exc_info=None,
    )

    formatted = handler.format(record)

    assert "INFO" in formatted
    assert "ouroboros_engine.test" in formatted
    assert "engine started" in formatted
