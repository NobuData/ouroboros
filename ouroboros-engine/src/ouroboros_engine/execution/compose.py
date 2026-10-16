"""The composition root for stage executors — the one core module that names an adapter.

DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_). Core engine code reaches
an executor through :class:`~ouroboros_engine.execution.registry.ExecutorRegistry`, never by
importing one (ruff ``TID251``). Something has to put the adapters *into* the registry, and
this module is that something: ``pyproject.toml`` exempts it, and only it, from the banned-api
rule. :mod:`ouroboros_engine.main` calls :func:`register_executors` once.

The Claude Agent executor (``harness``) registers whenever the CLI bundled with the pinned
``claude-agent-sdk`` wheel is present and executable and a REST URL is configured. There is no
switch of its own: whether live runs execute at all is ``ouroboros-rest``'s
``OURO_LIVE_EXECUTION_ENABLED``.
"""

from __future__ import annotations

import logging
from pathlib import Path

from ouroboros_engine.execution.executors.claude_agent import (
    ClaudeAgentExecutor,
    CredentialIssuer,
)
from ouroboros_engine.execution.executors.claude_agent_env import bundled_cli
from ouroboros_engine.execution.registry import ExecutorRegistry

_log = logging.getLogger(__name__)


def register_executors(
    registry: ExecutorRegistry,
    *,
    rest_url: str,
    credentials: CredentialIssuer,
    cli_path: Path | None = None,
) -> list[str]:
    """Register every executor this process can run.

    Args:
        registry: Where they go — ``app.state.executors``.
        rest_url: ``OURO_REST_URL``; empty means no facade, so no harness.
        credentials: The control plane's credential routes.
        cli_path: The harness CLI; the pinned wheel's bundled binary when omitted.

    Returns:
        The kinds registered, sorted.
    """
    cli = cli_path if cli_path is not None else bundled_cli()
    if cli is None:
        _log.warning("the Claude Agent CLI is not installed: no harness executor")
    elif not rest_url.strip():
        _log.warning("no REST URL is configured: no harness executor")
    else:
        resolved = cli

        def harness() -> ClaudeAgentExecutor:
            """A fresh Claude Agent executor, for one stage attempt.

            Returns:
                The executor.
            """
            return ClaudeAgentExecutor(
                credentials, rest_url=rest_url, cli_path=resolved
            )

        registry.register(ClaudeAgentExecutor.kind, harness)
    return registry.kinds()
