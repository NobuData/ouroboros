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

The estimation fixtures at the bottom are here rather than in one of the suites because
three of them read the same two values: the route's tests, the contract's tests and the
estimator's. Both are the mockup's own issue and the mockup's own estimate — ``#485`` and
the *AI Work Breakdown* panel beside it (``docs/mockups/03-issues.html``) — so a test that
fails prints a body a reader can compare against the design it came from.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine import settings as settings_module
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.estimation.contract import (
    Breakdown,
    Estimate,
    EstimateRequest,
    EstimationContext,
    IssueContext,
    Trace,
)
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


# ---------------------------------------------------------------------------
# Estimation — the mockup's issue, and the mockup's estimate
# ---------------------------------------------------------------------------


@pytest.fixture
def estimation_context() -> EstimationContext:
    """The vocabularies a caller offers: the roadmap's four workflow tags and two models.

    Returns:
        An :class:`ouroboros_engine.estimation.contract.EstimationContext` holding the
        tags L.2's label map produces and a model per class of work. The first entry of
        each is what the placeholder estimator answers with, so a test can assert an
        answer came from the offer rather than from a constant in this service.
    """
    return EstimationContext(
        workflow_tags=["standard-fix", "docs-loop", "feature-loop", "deps-refresh"],
        model_defaults={"default": "claude-fable-5", "docs": "claude-haiku-4-5"},
    )


@pytest.fixture
def estimate_request(estimation_context: EstimationContext) -> EstimateRequest:
    """A request to size the mockup's ``#485``.

    Args:
        estimation_context: The vocabularies to offer.

    Returns:
        A valid :class:`ouroboros_engine.estimation.contract.EstimateRequest`.
    """
    return EstimateRequest(
        issue=IssueContext(
            number=485,
            title="I2C bus lockup after IMU sleep/wake cycle",
            body=(
                "After entering low-power sleep and waking the BMI270, the I2C bus "
                "intermittently locks up. Recovery requires a full bus reset."
            ),
            labels=["bug", "i2c", "watchdog"],
            repo="acme-robotics/helios-firmware",
        ),
        context=estimation_context,
    )


@pytest.fixture
def estimate_body(estimate_request: EstimateRequest) -> dict:
    """The same request as the JSON a caller sends.

    Built from the model rather than typed a second time, so a field renamed in the
    contract cannot leave a stale literal behind in the suite. A test that needs an
    invalid body edits a copy of this one, which is what makes it a test of *one* refused
    field rather than of whatever else the literal happened to get wrong.

    Args:
        estimate_request: The request to serialise.

    Returns:
        The body, ready to hand to :meth:`TestClient.post` as ``json``.
    """
    return estimate_request.model_dump(mode="json")


@pytest.fixture
def mockup_estimate() -> Estimate:
    """The estimate the mockup's *AI Work Breakdown* panel shows, as the response model.

    Every number is the panel's: three files, ~180k tokens, a 12-18 minute cycle beside
    23 estimated minutes, effort M at 92%, low risk with its sentence, and the trace's own
    two lines. So a test asserting the contract can carry the design is asserting it
    against the design rather than against a shape invented to fit the model.

    Returns:
        A complete :class:`ouroboros_engine.estimation.contract.Estimate`.
    """
    return Estimate(
        effort="m",
        confidence=92,
        suggested_workflow="standard-fix",
        routed_model="claude-fable-5",
        breakdown=Breakdown(
            files=[
                "drivers/i2c_recovery.c",
                "drivers/imu_bmi270.c",
                "tests/unit/test_i2c_lockup.c",
            ],
            est_tokens=180_000,
            cycle_min=12,
            cycle_max=18,
            est_minutes=23,
        ),
        risk="low",
        risk_note=(
            "Isolated to the I²C driver path; full HIL coverage exists for bus recovery."
        ),
        trace=Trace(
            estimator="heuristic-v0",
            tokens_used=41_000,
            signals=["3 similar closed issues", "driver map", "HIL test index"],
        ),
    )
