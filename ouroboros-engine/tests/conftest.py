"""Shared fixtures.

Every test runs against a known environment: the autouse fixture below removes the
variables this service reads, so a developer who exports ``OURO_LOG_LEVEL=debug`` in
their shell gets the same results as CI.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine.main import create_app
from ouroboros_engine.settings import Settings

#: Every environment variable ouroboros_engine.settings declares an alias for. This is
#: the one list the tests work from, so a setting added without being isolated here
#: fails an exhaustiveness check rather than quietly reading a developer's shell
#: (tests/test_settings.py::test_every_field_is_isolated_by_the_fixture).
_ENGINE_VARIABLES = ("PORT", "OURO_LOG_LEVEL", "OURO_ENGINE_SHARED_SECRET")


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the engine's variables from the environment for the duration of a test."""
    for name in _ENGINE_VARIABLES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def engine_variables() -> tuple[str, ...]:
    """The environment variables :func:`clean_environment` isolates.

    Returns:
        Every variable name the engine's settings read.
    """
    return _ENGINE_VARIABLES


@pytest.fixture
def client() -> Iterator[TestClient]:
    """An HTTP client bound to an application built from default settings.

    Entering the context manager runs the application's startup, so the client
    exercises the same lifespan a served process does.

    Yields:
        A :class:`fastapi.testclient.TestClient` for a freshly built application.
    """
    with TestClient(create_app(Settings())) as test_client:
        yield test_client
