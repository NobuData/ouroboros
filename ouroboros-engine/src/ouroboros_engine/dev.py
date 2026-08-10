"""The ``uv run dev`` entry point — a reloading server for local development only.

Production runs uvicorn against ``ouroboros_engine.main:app`` itself, with no reloader
and a host of its own choosing; the container that does so is #53. Nothing here is
imported by the application.
"""

import sys
from pathlib import Path

import uvicorn

from ouroboros_engine.settings import SettingsError, load_settings

#: Development binds the loopback interface only. A service that answers on every
#: interface of a developer's machine is reachable from the network it is on, and this
#: one is internal by design (``docs/ARCHITECTURE.md`` § 2.3). The container sets its
#: own host, where binding all interfaces is what the platform needs.
_DEV_HOST = "127.0.0.1"

#: The ``src`` directory holding this package, resolved from the module's own path
#: rather than from the working directory, so ``uv run dev`` watches the sources wherever
#: it is invoked from. It is ``None`` when the package was installed as a copy rather
#: than in editable mode — there are no sources to watch then, and pointing the reloader
#: at ``site-packages`` would be worse than leaving it on uvicorn's default.
_SOURCE_ROOT = Path(__file__).resolve().parent.parent
_RELOAD_DIRS = [str(_SOURCE_ROOT)] if _SOURCE_ROOT.name == "src" else None


def main() -> int:
    """Serve the application with reload enabled.

    Validates the environment before starting so a configuration mistake is a named
    variable on stderr rather than a traceback from inside the reloader's child process.

    Returns:
        The process exit code: ``0`` after the server is stopped, ``2`` if the
        environment did not validate.
    """
    try:
        settings = load_settings()
    except SettingsError as error:
        print(error, file=sys.stderr)
        return 2

    uvicorn.run(
        # An import string, not the object: the reloader has to be able to re-import
        # the application in a fresh process after a file changes.
        "ouroboros_engine.main:app",
        host=_DEV_HOST,
        port=settings.port,
        log_level=settings.log_level,
        reload=True,
        reload_dirs=_RELOAD_DIRS,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as `python -m`, not by tests
    raise SystemExit(main())
