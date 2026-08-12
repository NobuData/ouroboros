"""Configuration is read from the environment, validated, and fails fast when wrong."""

import pathlib
import typing

import pytest
from pydantic import ValidationError

from ouroboros_engine import settings as settings_module
from ouroboros_engine.settings import LogLevel, Settings, SettingsError, load_settings

#: The real ``settings._ENV_FILES``, captured at import — which is before the autouse
#: ``clean_environment`` fixture replaces it with an empty tuple for the duration of
#: every test. The two tests that assert on which files the service *would* read need
#: the genuine value; everything else needs the isolation.
REAL_ENV_FILES = settings_module._ENV_FILES


def test_defaults_match_the_documented_development_values() -> None:
    settings = load_settings()

    assert settings.port == 8000, "the port map in docs/CONVENTIONS.md § 4 says 8000"
    assert settings.log_level == "info", ".env.example documents OURO_LOG_LEVEL=info"


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


def test_a_missing_shared_secret_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    # Mandatory since #51: with it unset, every route but /healthz would answer 401,
    # so a process that started anyway would be a service that serves nothing.
    monkeypatch.delenv("OURO_ENGINE_SHARED_SECRET")

    with pytest.raises(SettingsError) as failure:
        load_settings()

    message = str(failure.value)
    assert "OURO_ENGINE_SHARED_SECRET" in message
    assert "required" in message.lower()


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


def _use_env_files(monkeypatch: pytest.MonkeyPatch, *files: pathlib.Path) -> None:
    """Point :func:`load_settings` at the given files instead of the checkout's.

    Args:
        monkeypatch: The active patcher; the override is undone after the test.
        files: Paths in lowest-precedence-first order, as ``settings._ENV_FILES`` is.
    """
    monkeypatch.setattr(settings_module, "_ENV_FILES", files)


def test_a_value_is_read_from_an_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("OURO_LOG_LEVEL=debug\n", encoding="utf-8")
    _use_env_files(monkeypatch, env_file)

    assert load_settings().log_level == "debug"


def test_a_mandatory_variable_can_come_from_an_env_file_alone(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    # The point of the whole mechanism: writing the secret into ouroboros-engine/.env
    # is enough to start the service, with nothing exported.
    monkeypatch.delenv("OURO_ENGINE_SHARED_SECRET")
    env_file = tmp_path / ".env"
    env_file.write_text("OURO_ENGINE_SHARED_SECRET=from-the-file\n", encoding="utf-8")
    _use_env_files(monkeypatch, env_file)

    assert load_settings().shared_secret == "from-the-file"


def test_the_process_environment_beats_an_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    # What keeps a container configured by exactly what it was started with, and what
    # makes `OURO_LOG_LEVEL=debug uv run dev` work against a checkout that has a file.
    env_file = tmp_path / ".env"
    env_file.write_text("OURO_LOG_LEVEL=error\n", encoding="utf-8")
    _use_env_files(monkeypatch, env_file)
    monkeypatch.setenv("OURO_LOG_LEVEL", "debug")

    assert load_settings().log_level == "debug"


def test_the_module_env_file_beats_the_repo_root_one(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    # docs/CONVENTIONS.md § 4: the more specific file wins where both declare a variable.
    root = tmp_path / "root.env"
    root.write_text("OURO_LOG_LEVEL=error\nPORT=9001\n", encoding="utf-8")
    module = tmp_path / "module.env"
    module.write_text("OURO_LOG_LEVEL=debug\n", encoding="utf-8")
    _use_env_files(monkeypatch, root, module)

    settings = load_settings()

    assert settings.log_level == "debug", "the module's file is the more specific one"
    assert settings.port == 9001, "a variable only the root file declares is still read"


def test_a_missing_env_file_is_not_an_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    # A container has neither file and is configured from its environment alone.
    _use_env_files(monkeypatch, tmp_path / "does-not-exist.env")

    assert load_settings().log_level == "info"


def test_the_env_files_are_resolved_from_the_package_not_the_working_directory() -> (
    None
):
    # `uv run dev` is run from the module directory, `nest`-style tooling from the repo
    # root, and a reloader re-imports from wherever it likes.
    assert REAL_ENV_FILES, "an editable checkout resolves both files"
    assert all(path.is_absolute() for path in REAL_ENV_FILES)


def test_the_env_files_are_the_repo_root_and_module_templates_siblings() -> None:
    module_directory = pathlib.Path(settings_module.__file__).resolve().parents[2]
    root, module = REAL_ENV_FILES

    assert module == module_directory / ".env"
    assert root == module_directory.parent / ".env"
    assert (module_directory / ".env.example").is_file(), (
        "the module template is what a developer copies to the file read above"
    )
