"""Configuration is read from the environment, validated, and fails fast when wrong."""

import typing

import pytest
from pydantic import ValidationError

from ouroboros_engine.settings import LogLevel, Settings, SettingsError, load_settings


def test_defaults_match_the_documented_development_values() -> None:
    settings = load_settings()

    assert settings.port == 8000, "the port map in docs/CONVENTIONS.md § 4 says 8000"
    assert settings.log_level == "info", ".env.example documents OURO_LOG_LEVEL=info"
    assert settings.shared_secret is None, "no route requires the key until #51"


def test_every_field_is_isolated_by_the_fixture(
    engine_variables: tuple[str, ...],
) -> None:
    aliases = {field.validation_alias for field in Settings.model_fields.values()}

    assert aliases == set(engine_variables), (
        "a new setting must be added to conftest.ENGINE_VARIABLES, or a developer's "
        "shell leaks into the test run"
    )


@pytest.mark.parametrize("value", ["1", "8000", "65535"])
def test_port_is_read_from_the_unprefixed_variable(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("PORT", value)

    assert load_settings().port == int(value)


@pytest.mark.parametrize("value", ["0", "65536", "-1", "eight thousand", ""])
def test_a_port_outside_the_valid_range_is_rejected(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("PORT", value)

    with pytest.raises(SettingsError) as failure:
        load_settings()

    assert "PORT" in str(failure.value)


@pytest.mark.parametrize("value", typing.get_args(LogLevel))
def test_every_documented_log_level_is_accepted(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", value)

    assert load_settings().log_level == value


@pytest.mark.parametrize("value", ["INFO", "verbose", "trace", ""])
def test_an_unknown_log_level_is_rejected_rather_than_defaulted(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", value)

    with pytest.raises(SettingsError) as failure:
        load_settings()

    message = str(failure.value)
    assert "OURO_LOG_LEVEL" in message
    for level in typing.get_args(LogLevel):
        assert level in message, "the message should say what is accepted"


def test_the_shared_secret_is_read_when_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The development placeholder .env.example documents — not a credential.
    placeholder = "dev-engine-shared-secret-change-me"
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", placeholder)

    assert load_settings().shared_secret == placeholder


def test_an_empty_shared_secret_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", "")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    assert "OURO_ENGINE_SHARED_SECRET" in str(failure.value)


def test_a_secret_is_never_echoed_by_a_failure_elsewhere(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The message is printed and logged, so a report that dumps the whole input would
    # put the shared secret in a log file for a mistake in an unrelated variable.
    monkeypatch.setenv("PORT", "not-a-port")
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", "hunter2")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    assert "hunter2" not in str(failure.value)


def test_all_problems_are_reported_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", "0")
    monkeypatch.setenv("OURO_LOG_LEVEL", "chatty")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    message = str(failure.value)
    assert "2 problems" in message, "fixing one variable at a time is a slow loop"
    assert "PORT" in message
    assert "OURO_LOG_LEVEL" in message


def test_a_single_problem_is_reported_in_the_singular(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PORT", "0")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    assert "1 problem)" in str(failure.value)


def test_unrelated_environment_variables_are_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A container inherits plenty that has nothing to do with this service — including
    # OURO_* variables that belong to another module.
    monkeypatch.setenv("OURO_DATABASE_URL", "postgresql://localhost/ouroboros")
    monkeypatch.setenv("SOME_PLATFORM_VARIABLE", "1")

    assert load_settings().port == 8000


def test_settings_cannot_be_changed_after_they_are_read() -> None:
    settings = load_settings()

    with pytest.raises(ValidationError):
        settings.port = 9999


def test_the_underlying_pydantic_error_is_kept_as_the_cause(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PORT", "0")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    assert isinstance(failure.value.__cause__, ValidationError)
