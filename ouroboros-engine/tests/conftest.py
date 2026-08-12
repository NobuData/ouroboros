"""Shared fixtures.

Every test runs against a known environment: the autouse fixture below replaces the
variables this service reads with the suite's own, so a developer who exports
``OURO_LOG_LEVEL=debug`` in their shell — or writes it into an ``.env`` — gets the same
results as CI.

Two clients are offered because the engine now has two kinds of caller. ``client``
carries the internal key on every request and is what a test of a route uses;
``anonymous_client`` carries nothing and is what a test of the boundary uses. Neither
is a default the other has to opt out of — a test says which side of the boundary it is
standing on by which fixture it asks for.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine import settings as settings_module
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.settings import Settings

#: Every environment variable ouroboros_engine.settings declares an alias for. This is
#: the one list the tests work from, so a setting added without being isolated here
#: fails an exhaustiveness check rather than quietly reading a developer's shell
#: (tests/test_settings.py::test_every_field_is_isolated_by_the_fixture).
_ENGINE_VARIABLES = ("PORT", "OURO_LOG_LEVEL", "OURO_ENGINE_SHARED_SECRET")

#: The shared secret the suite runs with. Not a credential and never deployed — the
#: engine's real one is generated per environment — but it is long enough that a test
#: asserting a *wrong* key is rejected cannot pass by accidentally matching it.
INTERNAL_KEY = "test-internal-key-1f3c9a"

# Importing ouroboros_engine.main builds the application at module scope, which reads
# and validates the environment (the fail-fast rule), and the shared secret is
# mandatory. So it has to be present before the first test module is imported, which is
# earlier than any fixture can run — hence a process-level default set here at import.
# `setdefault`, so a developer with the variable already exported keeps their value.
#
# Nothing else depends on it: `clean_environment` below removes it for the duration of
# every test, and each test that needs a configured application builds one from the
# `settings` fixture rather than from the environment.
os.environ.setdefault("OURO_ENGINE_SHARED_SECRET", INTERNAL_KEY)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Put every test on the same environment: no ``.env``, no engine variables, secret set.

    The ``.env`` files go first, and they matter more than they look: a developer's
    checkout normally *has* one, holding a real generated secret, so a suite that let
    :func:`~ouroboros_engine.settings.load_settings` read it would find every mandatory
    variable already satisfied. ``test_a_missing_shared_secret_is_rejected`` would pass
    on that file rather than on the behaviour it names, and would keep passing if the
    variable stopped being mandatory at all.

    The shared secret is the one variable that is set rather than removed, because it
    is mandatory — with it absent, every test that reads the environment would fail on
    the same missing variable instead of on what it was written to check. A test *about*
    the secret being absent removes it itself, which is the same thing said out loud.
    """
    monkeypatch.setattr(settings_module, "_ENV_FILES", ())
    for name in _ENGINE_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", INTERNAL_KEY)


@pytest.fixture
def engine_variables() -> tuple[str, ...]:
    """The environment variables :func:`clean_environment` isolates.

    Returns:
        Every variable name the engine's settings read.
    """
    return _ENGINE_VARIABLES


@pytest.fixture
def internal_key() -> str:
    """The value :fixture:`client` sends on ``X-Ouro-Internal-Key``.

    Returns:
        The shared secret the applications built by these fixtures expect.
    """
    return INTERNAL_KEY


@pytest.fixture
def settings() -> Settings:
    """Settings for an application under test: defaults, plus the shared secret.

    Returns:
        A :class:`ouroboros_engine.settings.Settings` built without reading the
        environment, so a test's application is configured by this file and nothing
        else.
    """
    return Settings(OURO_ENGINE_SHARED_SECRET=INTERNAL_KEY)


def _serve(settings: Settings, headers: dict[str, str] | None) -> Iterator[TestClient]:
    """Build an application and yield a client bound to it.

    Entering the context manager runs the application's startup, so the client
    exercises the same lifespan a served process does.

    Args:
        settings: Configuration the application under test is built from.
        headers: Headers sent on every request, or ``None`` for a bare client.

    Yields:
        A :class:`fastapi.testclient.TestClient` for a freshly built application.
    """
    # Imported here rather than at module scope: importing main builds an application
    # from the environment, and doing that while collecting tests would run it before
    # the default above could be seen to matter.
    from ouroboros_engine.main import create_app

    with TestClient(create_app(settings), headers=headers) as test_client:
        yield test_client


@pytest.fixture
def anonymous_client(settings: Settings) -> Iterator[TestClient]:
    """An HTTP client that sends no internal key — an unauthenticated caller.

    Args:
        settings: Configuration the application under test is built from.

    Yields:
        A :class:`fastapi.testclient.TestClient` for a freshly built application.
    """
    yield from _serve(settings, headers=None)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """An HTTP client that authenticates the way ouroboros-rest does.

    Its own application, not the anonymous client's with a header bolted on, so a test
    that asks for both is exercising two independent callers.

    Args:
        settings: Configuration the application under test is built from.

    Yields:
        A :class:`fastapi.testclient.TestClient` sending the internal key on every
        request.
    """
    yield from _serve(settings, headers={INTERNAL_KEY_HEADER: INTERNAL_KEY})
