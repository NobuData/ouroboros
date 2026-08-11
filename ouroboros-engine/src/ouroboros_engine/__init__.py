"""Ouroboros backend — the internal service that executes the work REST brokers.

The package is deliberately thin at this point: an application factory
(:mod:`ouroboros_engine.main`), validated configuration
(:mod:`ouroboros_engine.settings`), the routers under :mod:`ouroboros_engine.api`, and
the process-wide concerns under :mod:`ouroboros_engine.core` — among them the guard that
puts every route but liveness behind the internal shared secret, and the error envelope
every failure is answered in. The versioned contract ``ouroboros-rest`` calls is ``/v0``
(:mod:`ouroboros_engine.api.v0`); the work it will eventually broker — a task registry,
a queue and a worker model — is #54.

Attributes:
    __version__: The installed distribution's version, taken from package metadata so
        there is exactly one place — ``pyproject.toml`` — where it is written down.
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("ouroboros-engine")
except PackageNotFoundError as error:  # pragma: no cover - requires a broken install
    # The version is read from installed metadata rather than duplicated in the source,
    # so importing the package out of a tree that was never installed is a packaging
    # mistake worth naming. `uv sync` installs it; so must any image that copies src/.
    message = (
        "ouroboros-engine is not installed in this environment. "
        "Run `uv sync` (or install the project into the image) before importing it."
    )
    raise RuntimeError(message) from error

__all__ = ["__version__"]
