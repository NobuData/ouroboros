"""The application factory, and the module-scope instance uvicorn is pointed at."""

import importlib
import logging

import pytest
from fastapi import FastAPI

from ouroboros_engine import __version__, main
from ouroboros_engine.settings import Settings, SettingsError


def test_the_factory_returns_a_configured_application() -> None:
    app = main.create_app(Settings())

    assert isinstance(app, FastAPI)
    assert app.title == "ouroboros-engine"
    assert app.version == __version__


def test_the_settings_it_was_built_with_are_reachable_from_the_application() -> None:
    settings = Settings(PORT=9001)

    app = main.create_app(settings)

    assert app.state.settings is settings, (
        "middleware and routes read configuration from app.state rather than "
        "re-reading the environment"
    )


def test_omitting_settings_reads_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PORT", "9001")

    app = main.create_app()

    assert app.state.settings.port == 9001


def test_a_malformed_environment_stops_the_application_being_built(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", "chatty")

    with pytest.raises(SettingsError) as failure:
        main.create_app()

    assert "OURO_LOG_LEVEL" in str(failure.value)


def test_building_the_application_applies_the_log_level(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", "error")

    main.create_app()

    assert logging.getLogger().level == logging.ERROR


def test_each_call_builds_a_separate_application() -> None:
    first = main.create_app(Settings())
    second = main.create_app(Settings())

    assert first is not second, "a test must be able to build an app of its own"


def test_the_module_scope_instance_is_the_one_uvicorn_serves() -> None:
    # `ouroboros_engine.main:app` is the import string in dev.py and in the container
    # (#53). Importing this module validates the environment — the fail-fast rule.
    reloaded = importlib.reload(main)

    assert isinstance(reloaded.app, FastAPI)
    assert reloaded.app.state.settings.port == 8000
