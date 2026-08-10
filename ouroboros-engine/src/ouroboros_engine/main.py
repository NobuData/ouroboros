"""Application factory and the module-scope instance uvicorn is pointed at.

Two entry points, one code path:

* ``create_app`` builds a fresh application, optionally from settings handed to it,
  which is what tests use to exercise a configuration without touching the environment.
* ``app`` is built at import from the process environment, and is what
  ``ouroboros_engine.main:app`` resolves to for uvicorn — in development through
  :mod:`ouroboros_engine.dev`, in a container (#53) through uvicorn directly.

Because ``app`` is built at import, a malformed environment stops the process while it
is still starting rather than on the first request. That is the fail-fast rule from
``docs/CONVENTIONS.md`` § 4.
"""

from fastapi import FastAPI

from ouroboros_engine import __version__
from ouroboros_engine.api import root
from ouroboros_engine.core.logging import configure_logging
from ouroboros_engine.settings import Settings, load_settings

#: Shown on the generated OpenAPI document, which is the engine's own reference. The
#: contract REST codes against is the versioned one under ``/v0`` (#52).
_DESCRIPTION = (
    "Internal backend for Ouroboros. Reachable only from ouroboros-rest; "
    "never from a browser."
)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application.

    Args:
        settings: Configuration to run with. Omitted, the environment is read and
            validated by :func:`ouroboros_engine.settings.load_settings`.

    Returns:
        A configured :class:`fastapi.FastAPI` whose ``state.settings`` holds the
        settings it was built with, so a route or a middleware can reach them without
        re-reading the environment.

    Raises:
        ouroboros_engine.settings.SettingsError: If ``settings`` was omitted and the
            environment is missing or malformed.
    """
    resolved = load_settings() if settings is None else settings
    configure_logging(resolved.log_level)

    app = FastAPI(
        title="ouroboros-engine",
        description=_DESCRIPTION,
        version=__version__,
    )
    app.state.settings = resolved
    app.include_router(root.router)
    return app


#: The instance uvicorn serves. Built at import — see the module docstring.
app = create_app()
