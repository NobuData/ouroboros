"""What the driver needs to reach the control plane: an address and the simulator's secret.

Both variables already exist in the repo-root ``.env.example``. ``ouroboros-rest`` reads
them too: ``OURO_REST_URL`` is its own origin, and ``OURO_RUN_SIMULATOR_SECRET`` is the
second value ``X-Ouro-Internal-Key`` may carry. The driver reads them from the same
``.env`` files the engine reads, so ``yarn dev`` and the CLI agree with the running stack
without anything being exported.
"""

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from ouroboros_engine import settings as engine_settings


class SimulatorConfigurationError(RuntimeError):
    """The driver cannot run: a variable is missing, or it would open *real* runs."""


class SimulatorSettings(BaseSettings):
    """The driver's configuration.

    Attributes:
        rest_url: Where ``ouroboros-rest`` is, from wherever the driver runs. Read from
            ``OURO_REST_URL``; ``http://localhost:4000`` is the development stack's, and
            compose publishes REST there too.
        simulator_secret: ``OURO_RUN_SIMULATOR_SECRET``. Required: without it the driver
            has no principal to present, and presenting the executor's would open real
            runs.
        engine_secret: ``OURO_ENGINE_SHARED_SECRET``, read only to refuse a configuration
            in which the two are equal (see :func:`load_simulator_settings`).
    """

    model_config = SettingsConfigDict(
        extra="ignore", frozen=True, env_file_encoding="utf-8"
    )

    rest_url: str = Field(
        default="http://localhost:4000", min_length=1, validation_alias="OURO_REST_URL"
    )
    simulator_secret: str = Field(
        min_length=1, validation_alias="OURO_RUN_SIMULATOR_SECRET"
    )
    engine_secret: str | None = Field(
        default=None, validation_alias="OURO_ENGINE_SHARED_SECRET"
    )


def load_simulator_settings() -> SimulatorSettings:
    """Read and check the driver's configuration.

    Returns:
        The validated settings.

    Raises:
        SimulatorConfigurationError: If ``OURO_RUN_SIMULATOR_SECRET`` is unset, or equals
            ``OURO_ENGINE_SHARED_SECRET``. ``ouroboros-rest`` refuses to boot with the two
            equal, and the driver refuses too: with one value the control plane cannot tell
            the principals apart, so the runs it opened would not be marked simulated.
    """
    try:
        # The engine's own list of `.env` files, read at call time so the suite can
        # empty it (tests/conftest.py).
        settings = SimulatorSettings(_env_file=engine_settings._ENV_FILES)
    except ValidationError as error:
        raise SimulatorConfigurationError(
            "ouroboros-simulator: OURO_RUN_SIMULATOR_SECRET is not set. The driver "
            "presents it so that every run it opens is marked simulated."
        ) from error

    check_principal(settings)
    return settings


def check_principal(settings: SimulatorSettings) -> None:
    """Refuse a simulator secret that is also the executor's.

    Args:
        settings: The configuration to check.

    Raises:
        SimulatorConfigurationError: If the two secrets are equal.
    """
    if settings.engine_secret is not None and (
        settings.simulator_secret == settings.engine_secret
    ):
        raise SimulatorConfigurationError(
            "ouroboros-simulator: OURO_RUN_SIMULATOR_SECRET equals "
            "OURO_ENGINE_SHARED_SECRET. With one value the control plane cannot tell the "
            "simulator from an executor, so its runs would not be marked simulated."
        )
