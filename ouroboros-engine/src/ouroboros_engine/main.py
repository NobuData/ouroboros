"""Application factory and the module-scope instance uvicorn is pointed at.

Two entry points, one code path:

* ``create_app`` builds a fresh application, optionally from settings handed to it,
  which is what tests use to exercise a configuration without touching the environment.
* ``app`` is built at import from the process environment, and is what
  ``ouroboros_engine.main:app`` resolves to for uvicorn — in development through
  :mod:`ouroboros_engine.dev`, in a container (#53) through uvicorn directly.

Because ``app`` is built at import, a malformed environment stops the process while it
is still starting rather than on the first request. That is the fail-fast rule from
``docs/CONVENTIONS.md`` § 4 — and it now covers the API specification too, which is a
committed file this module loads rather than a document FastAPI derives from the routes
(:mod:`ouroboros_engine.openapi`).
"""

from fastapi import FastAPI

from ouroboros_engine.api import health, root, status, tasks
from ouroboros_engine.core.errors import register_error_handlers
from ouroboros_engine.core.logging import configure_logging
from ouroboros_engine.core.security import InternalKeyMiddleware
from ouroboros_engine.core.uptime import Uptime
from ouroboros_engine.openapi import document
from ouroboros_engine.settings import Settings, load_settings

#: The paths served without the internal key. Liveness only, and it is the route module
#: that says so — see :mod:`ouroboros_engine.api.health`. The OpenAPI document is
#: deliberately not in here: it is a map of the internal surface, and a misrouted port
#: should not hand one out. ``openapi.yaml`` says the same thing in its own terms — every
#: operation but this one carries the ``InternalKey`` requirement — and
#: ``tests/test_openapi.py`` asserts the two agree.
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
        ouroboros_engine.openapi.SpecificationError: If the committed API specification
            is missing or malformed. It is what this application serves at
            ``/openapi.json``, so an image built without it is broken at build time
            rather than at the first request for the document.
    """
    resolved = load_settings() if settings is None else settings
    configure_logging(resolved.log_level)

    # The specification is the source, and the application is described by it rather
    # than the other way around: title, version and description are read off the
    # document instead of being written a second time here, where they could disagree
    # with it.
    specification = document()
    info = specification["info"]

    app = FastAPI(
        title=info["title"],
        description=info["description"],
        version=info["version"],
    )

    def committed_document() -> dict:
        """Answer with the specification instead of one derived from the routes.

        Returns:
            The document :func:`ouroboros_engine.openapi.document` loaded, which is what
            ``/openapi.json`` and ``/docs`` serve.
        """
        return specification

    # Replacing the method rather than filling in `app.openapi_schema`: FastAPI caches a
    # generated document there but re-generates it whenever the route set changes, so a
    # schema assigned here would not survive the `include_router` calls below. Overriding
    # the producer leaves nothing that can regenerate — what a caller gets is the
    # committed file, unchanged, and no route can quietly rewrite the contract by
    # acquiring a docstring. What keeps the code honest to the document is the test suite
    # (tests/test_openapi.py), not the framework.
    app.openapi = committed_document

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

    # Every failure answers in one shape, including the ones no route produced: a body
    # pydantic refused, a path no router claims, an exception nobody expected. See
    # `ouroboros_engine.core.errors` — the envelope is the same one ouroboros-rest sends,
    # so a failure crossing the gateway does not change form on the way out.
    register_error_handlers(app)

    app.include_router(health.router)
    app.include_router(root.router)
    app.include_router(status.router)
    app.include_router(tasks.router)
    return app


#: The instance uvicorn serves. Built at import — see the module docstring.
app = create_app()
