"""The harness, described from its own tables (CD.4, #562).

The dry-run page makes three claims — *writes are simulated, infrastructure is replayed, the
models are real* — and ``ouroboros-rest`` serves them as data rather than copy. This is where
that data starts: :func:`describe_harness` reads the same :data:`~.tools.TOOL_SPECS` that
dispatches a call, the same :data:`~.guard.GUARDS` that refuse one, and the paths the harness
actually asks. Change a tool or a guard and the description changes with it; there is no
second list to forget.
"""

from __future__ import annotations

from ouroboros_engine.control_plane.contract import (
    DRY_RUN_REPLAY_ESTIMATES_PATH,
    INVOKE_PATH,
)

from .contract import HARNESS_VERSION, HarnessDescription, HarnessGuard, HarnessTool
from .guard import FORBIDDEN_CAPABILITIES, GUARDS, is_allowed
from .tools import TOOL_SPECS


def describe_harness() -> HarnessDescription:
    """Describe the installed harness.

    Returns:
        Its version, the tools on the allow-list with what each does, the guards, the
        capabilities no tool provides, and where reads, writes, replays and model calls go.
    """
    return HarnessDescription(
        harness=HARNESS_VERSION,
        tools=[
            HarnessTool(name=spec.name, effect=spec.effect, does=spec.does)
            for spec in TOOL_SPECS
            if is_allowed(spec.name)
        ],
        guards=[
            HarnessGuard(name=name, refuses=refuses) for name, refuses in GUARDS.items()
        ],
        forbidden_capabilities=list(FORBIDDEN_CAPABILITIES),
        writes="memory_overlay",
        reads="provider_api_at_pinned_sha",
        replay_estimates_path=DRY_RUN_REPLAY_ESTIMATES_PATH,
        invoke_path=INVOKE_PATH,
    )
