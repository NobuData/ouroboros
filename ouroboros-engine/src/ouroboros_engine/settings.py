"""Configuration for ouroboros-engine, validated before the service accepts anything.

Every variable this module reads is documented in the repo-root ``.env.example`` with a
development default, and follows the two rules in ``docs/CONVENTIONS.md`` § 4: ``PORT``
is unprefixed because that is what container platforms set, and everything
Ouroboros-specific is prefixed ``OURO_``.

Configuration is read from the process environment only — there is no dotenv loading —
so what a container is started with is exactly what the service runs with.

Validation happens at import of :mod:`ouroboros_engine.main`, which builds the
application at module scope. A malformed value therefore stops the process before it
binds a port, and :func:`load_settings` turns pydantic's report into a message that
names the offending environment variables rather than the Python attributes behind them.
"""

from typing import Literal

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Verbosity values ``OURO_LOG_LEVEL`` accepts, lower-case as documented in
#: ``.env.example``. Anything else is a configuration error rather than a fallback to a
#: default, because a typo that silently downgrades logging is invisible in production.
LogLevel = Literal["debug", "info", "warning", "error"]


class SettingsError(RuntimeError):
    """A configuration value is missing or malformed.

    Carries a message that names each offending environment variable and what was wrong
    with it, ready to print to stderr before exiting non-zero.
    """


class Settings(BaseSettings):
    """The engine's runtime configuration.

    Each field declares the environment variable it reads as an explicit alias, so the
    variable name is visible next to the value it produces and renaming the attribute
    cannot silently change the deployment contract.

    Attributes:
        port: TCP port the service listens on. Read from ``PORT``; 8000 by convention.
        log_level: Verbosity applied by :func:`ouroboros_engine.core.logging`. Read from
            ``OURO_LOG_LEVEL``.
        shared_secret: Expected value of the ``X-Ouro-Internal-Key`` header on internal
            calls, read from ``OURO_ENGINE_SHARED_SECRET``. Mandatory: every route but
            liveness is behind
            :class:`ouroboros_engine.core.security.InternalKeyMiddleware`, so a process
            without a secret could serve nothing and refusing to start is the honest
            outcome.
    """

    model_config = SettingsConfigDict(
        # Unknown variables are ignored rather than rejected: the process environment of
        # a container carries plenty that has nothing to do with this service.
        extra="ignore",
        # Settings are read once and never mutated, so nothing can reconfigure the
        # service after it has started.
        frozen=True,
    )

    port: int = Field(default=8000, ge=1, le=65535, validation_alias="PORT")
    log_level: LogLevel = Field(default="info", validation_alias="OURO_LOG_LEVEL")
    # No default: an engine that starts without a secret would answer nothing but
    # /healthz, so the missing variable is named at boot rather than discovered as a
    # wall of 401s at the first request REST makes.
    shared_secret: str = Field(
        min_length=1,
        validation_alias="OURO_ENGINE_SHARED_SECRET",
    )


def load_settings() -> Settings:
    """Read and validate the environment.

    Returns:
        The validated :class:`Settings`.

    Raises:
        SettingsError: If any variable is missing or malformed. The message names every
            offending variable and the reason, one per line.
    """
    try:
        return Settings()
    except ValidationError as error:
        raise SettingsError(_describe(error)) from error


def _describe(error: ValidationError) -> str:
    """Render a pydantic validation failure as environment-variable advice.

    pydantic reports the alias it tried to populate — which, because every field above
    declares one, is the environment variable's own name. Reporting that instead of a
    stack trace is what makes a bad value a five-second fix.

    Args:
        error: The failure raised while constructing :class:`Settings`.

    Returns:
        A multi-line message: a summary, then one ``VARIABLE: reason`` line per problem.
        Values are never echoed — one of these variables is a secret.
    """
    count = error.error_count()
    noun = "problem" if count == 1 else "problems"
    lines = [f"ouroboros-engine: invalid configuration ({count} {noun})"]
    for detail in error.errors():
        location = detail["loc"]
        variable = str(location[0]) if location else "(unknown variable)"
        lines.append(f"  {variable}: {detail['msg']}")
    return "\n".join(lines)
