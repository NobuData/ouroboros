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
from ouroboros_engine.api import health, root, status
from ouroboros_engine.core.logging import configure_logging
from ouroboros_engine.core.security import InternalKeyMiddleware
from ouroboros_engine.core.uptime import Uptime
from ouroboros_engine.settings import Settings, load_settings

#: Shown on the generated OpenAPI document, which is the engine's own reference. The
#: contract REST codes against is the versioned one under ``/v0`` (#52).
_DESCRIPTION = (
    "Internal backend for Ouroboros. Reachable only from ouroboros-rest; "
    "never from a browser. Every path but /healthz requires the shared secret on the "
    "X-Ouro-Internal-Key header."
)

#: The paths served without the internal key. Liveness only, and it is the route module
#: that says so — see :mod:`ouroboros_engine.api.health`. The generated OpenAPI document
#: is deliberately not in here: it is a map of the internal surface, and a misrouted
#: port should not hand one out.
_PUBLIC_PATHS = (health.HEALTH_PATH,)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application.

    Args:
        settings: Configuration to run with. Omitted, the environment is read and
            validated by :func:`ouroboros_engine.settings.load_settings`.

    Returns:
        A configured :class:`fastapi.FastAPI` whose ``state.settings`` holds the
        settings it was built with, so a route or a middleware can reach them without
        re-reading the environment, and whose ``state.uptime`` is the stopwatch
        ``/v0/status`` reports from.

    Raises:
        ouroboros_engine.settings.SettingsError: If ``settings`` was omitted and the
            environment is missing or malformed — which now includes
            ``OURO_ENGINE_SHARED_SECRET`` being unset, because without it every route
            but liveness would be unreachable.
    """
    resolved = load_settings() if settings is None else settings
    configure_logging(resolved.log_level)

    app = FastAPI(
        title="ouroboros-engine",
        description=_DESCRIPTION,
        version=__version__,
    )
    app.state.settings = resolved
    app.state.uptime = Uptime()

    # Added before any route is registered, and the only middleware there is, so it is
    # the outermost thing a request meets: the guard cannot be bypassed by a path that
    # is added later, and an unauthenticated request never reaches routing at all.
    app.add_middleware(
        InternalKeyMiddleware,
        secret=resolved.shared_secret,
        public_paths=_PUBLIC_PATHS,
    )

    app.include_router(health.router)
    app.include_router(root.router)
    app.include_router(status.router)
    return app


#: The instance uvicorn serves. Built at import — see the module docstring.
app = create_app()
