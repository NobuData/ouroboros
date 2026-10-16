"""Where the Claude Agent harness runs from, and the only environment it is given.

DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_):

* :func:`bundled_cli` — the CLI inside the pinned ``claude-agent-sdk`` wheel. The executor
  runs that binary and no other: never a ``claude`` found on ``PATH``, whose version and
  login nobody pinned.
* :func:`config_dir` — the per-run ``CLAUDE_CONFIG_DIR``, ``<run dir>/claude-config``,
  beside the run's working tree on the runs volume (DI.1), so a restarted engine finds the
  session and the run's removal takes it along.
* :func:`harness_env` — the CLI's environment.

**The SDK merges, it does not replace.** ``claude-agent-sdk`` 0.2.167 starts the CLI with
``{**os.environ, **options.env}`` (minus ``CLAUDECODE``). An engine that set only the
variables it wanted would therefore hand the CLI every variable it inherited — an operator's
``ANTHROPIC_API_KEY``, an OAuth token, ``OURO_ENGINE_SHARED_SECRET``. So :func:`harness_env`
names **every** inherited variable and blanks it, except a short list of harmless ones
(:data:`KEPT_VARIABLES`), then sets the harness's own. What reaches the CLI is exactly that.
"""

from __future__ import annotations

import importlib.util
import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Final

#: The harness's per-run configuration directory, inside the run directory.
CONFIG_DIR_NAME: Final = "claude-config"

#: Inherited variables passed through unchanged. Nothing secret, nothing that selects a
#: provider, a login or a proxy: only what a process needs to find its binaries, speak
#: its locale and trust a private CA for an https control plane.
KEPT_VARIABLES: Final[frozenset[str]] = frozenset(
    {
        "PATH",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "TMPDIR",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
    }
)


#: A harness session id: a uuid, or at least nothing a glob or a path could read into.
_SESSION_ID: Final = re.compile(r"[A-Za-z0-9_-]{1,128}")


def bundled_cli() -> Path | None:
    """The CLI the pinned SDK wheel carries, if it is installed and executable.

    Found without importing the SDK, so a probe stays cheap.

    Returns:
        ``claude_agent_sdk/_bundled/claude``, or ``None`` when the SDK or its binary is
        absent or not executable.
    """
    spec = importlib.util.find_spec("claude_agent_sdk")
    if spec is None or not spec.submodule_search_locations:
        return None
    for location in spec.submodule_search_locations:
        candidate = Path(location) / "_bundled" / "claude"
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def config_dir(working_tree: str) -> Path:
    """The run's ``CLAUDE_CONFIG_DIR``.

    Args:
        working_tree: The run's working tree, ``<OURO_ENGINE_RUN_DIR>/<run>/tree``.

    Returns:
        ``<OURO_ENGINE_RUN_DIR>/<run>/claude-config`` — created by the caller.
    """
    return Path(working_tree).parent / CONFIG_DIR_NAME


def session_exists(config: Path, session_id: str) -> bool:
    """Whether a harness session can be resumed from this configuration directory.

    The CLI keeps a session at ``projects/<cwd, slugged>/<session id>.jsonl``. One that is
    not there is *"No conversation found"* once the CLI has started — asked here first, so
    a resume that cannot work is refused before any process runs.

    Args:
        config: The ``CLAUDE_CONFIG_DIR``.
        session_id: The session.

    Returns:
        ``True`` when the session's transcript is on disk; ``False`` too for an id that is
        not one (a path, a glob).
    """
    if not _SESSION_ID.fullmatch(session_id):
        return False
    return any((config / "projects").glob(f"*/{session_id}.jsonl"))


def harness_env(
    *,
    base_url: str,
    credential: str,
    alias: str,
    config: Path,
    inherited: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """The CLI's environment: every inherited variable blanked, then the harness's own.

    Args:
        base_url: The facade, ``<OURO_REST_URL>/internal/harness/anthropic``.
        credential: The run-scoped credential — the CLI's ``ANTHROPIC_API_KEY``.
        alias: The routing alias. Every model the CLI could pick on its own (the small fast
            model, the default haiku/sonnet/opus) is pinned to it, or the CLI's side traffic
            would name a model the credential may not call (``alias_mismatch``).
        config: The per-run configuration directory; also ``HOME``, so nothing is read
            from, or written to, the engine user's home.
        inherited: The engine's environment; ``os.environ`` when omitted.

    Returns:
        ``options.env`` for the SDK. Merged over the engine's environment by the SDK, it
        leaves the CLI exactly the kept variables and these.
    """
    source = os.environ if inherited is None else inherited
    env = {name: "" for name in source if name not in KEPT_VARIABLES}
    env |= {
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_API_KEY": credential,
        "ANTHROPIC_MODEL": alias,
        "ANTHROPIC_SMALL_FAST_MODEL": alias,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": alias,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": alias,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": alias,
        "CLAUDE_CONFIG_DIR": str(config),
        "HOME": str(config),
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "CLAUDE_CODE_MAX_RETRIES": "2",
        # What the SDK itself would set when the engine's environment does not: restated,
        # so an inherited value (blanked above) cannot switch either off.
        "CLAUDE_CODE_ENTRYPOINT": "sdk-py",
        "CLAUDE_CODE_SDK_READS_SESSION_STATE": "1",
    }
    return env
