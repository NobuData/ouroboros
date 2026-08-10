"""`uv run dev` — what it serves, on which interface, and how it fails."""

from pathlib import Path
from typing import Any

import pytest

from ouroboros_engine import dev


@pytest.fixture
def recorded_run(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace ``uvicorn.run`` with a recorder so the server is never started.

    Returns:
        A dictionary that receives the keyword arguments ``dev.main`` passes, plus the
        positional import string under ``"app"``.
    """
    recorded: dict[str, Any] = {}

    def fake_run(app: str, **kwargs: Any) -> None:
        recorded["app"] = app
        recorded.update(kwargs)

    monkeypatch.setattr(dev.uvicorn, "run", fake_run)
    return recorded


def test_it_serves_the_application_by_import_string(
    recorded_run: dict[str, Any],
) -> None:
    dev.main()

    assert recorded_run["app"] == "ouroboros_engine.main:app", (
        "the reloader has to re-import the application, so it cannot be the object"
    )
    assert recorded_run["reload"] is True


def test_it_binds_the_loopback_interface_only(recorded_run: dict[str, Any]) -> None:
    dev.main()

    assert recorded_run["host"] == "127.0.0.1", (
        "the engine is internal; a development server on every interface is reachable "
        "from whatever network the developer is on"
    )


def test_it_serves_the_conventional_port_by_default(
    recorded_run: dict[str, Any],
) -> None:
    dev.main()

    assert recorded_run["port"] == 8000


def test_it_honours_the_port_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, recorded_run: dict[str, Any]
) -> None:
    monkeypatch.setenv("PORT", "8123")

    dev.main()

    assert recorded_run["port"] == 8123


def test_it_passes_the_configured_log_level_to_uvicorn(
    monkeypatch: pytest.MonkeyPatch, recorded_run: dict[str, Any]
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", "debug")

    dev.main()

    assert recorded_run["log_level"] == "debug"


def test_it_watches_the_sources_only(recorded_run: dict[str, Any]) -> None:
    dev.main()

    watched = recorded_run["reload_dirs"]

    assert watched is not None, "the suite runs against an editable install"
    assert [Path(directory).name for directory in watched] == ["src"], (
        "watching the module directory would mean watching .venv"
    )
    assert (Path(watched[0]) / "ouroboros_engine").is_dir(), (
        "resolved from the module's own path, so it holds wherever dev is invoked from"
    )


@pytest.mark.usefixtures("recorded_run")
def test_it_returns_zero_when_the_server_stops() -> None:
    assert dev.main() == 0


def test_a_bad_environment_exits_non_zero_without_starting_a_server(
    monkeypatch: pytest.MonkeyPatch,
    recorded_run: dict[str, Any],
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("OURO_LOG_LEVEL", "chatty")

    exit_code = dev.main()

    assert exit_code == 2
    assert recorded_run == {}, "nothing should bind a port on a bad configuration"

    captured = capsys.readouterr()
    assert "OURO_LOG_LEVEL" in captured.err, "the message must name the variable"
    assert captured.out == "", "diagnostics belong on stderr"
