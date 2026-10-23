"""Trusting a private certificate authority for git over ``https://`` (DI.6, #1321).

The engine clones (:mod:`ouroboros_engine.code.clones`) and pushes
(:mod:`ouroboros_engine.execution.publisher`) over ``https://`` only, and that rule stays. A
self-hosted git server is often signed by an organization's own certificate authority, which
the system's trust store does not hold; ``OURO_ENGINE_GIT_CA_FILE`` names that authority's PEM
bundle, and every git connection the engine opens verifies against it. It never turns
verification off — there is no setting that does.

dulwich reads the bundle from a git configuration's ``http.sslCAInfo``, so this module builds
that one-key configuration and nothing else.
"""

from pathlib import Path

from dulwich.config import ConfigDict


def git_tls_config(ca_file: Path | None) -> ConfigDict | None:
    """The git configuration that makes dulwich verify against a CA bundle.

    Args:
        ca_file: ``OURO_ENGINE_GIT_CA_FILE``, or ``None`` for the system trust store.

    Returns:
        A configuration carrying ``http.sslCAInfo``, or ``None`` when no bundle is named — the
        dulwich default, which is the system's trust store.
    """
    if ca_file is None:
        return None

    config = ConfigDict()
    config.set((b"http",), b"sslCAInfo", str(ca_file).encode())
    return config
