"""The tool boundary: an allow-list, and a record of everything it refused (CD.2, #560).

**"No side effects" cannot rest on a prompt.** A model told not to push is a model that
usually does not push. Here it *cannot*: the only tools that exist are the six in
:data:`ALLOWED_TOOLS`, and every one of them is answered by the virtual workspace or by a
replay estimate. Anything else a model asks for — whatever it is called — does not resolve,
is not run, and is written to the :class:`GuardAudit`.

**A blocked call is evidence, and it fails the run.** The audit is what turns *"the guards
held"* from an assumption into a row: an empty audit is a clean run, and a populated one is a
dry run whose result is not to be trusted, so the harness ends it ``failed``.

:data:`FORBIDDEN_CAPABILITIES` is not consulted to decide anything — the allow-list decides,
which is the point of an allow-list. It names the capabilities the issue promises are absent,
with the tool names a model is likeliest to reach for, so the guard suite can prove each one
absent by name and so an audit entry can say *which kind* of thing was attempted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .contract import GuardEntry

#: Every tool a dry-run stage has. There is no other way to act.
ALLOWED_TOOLS: Final[frozenset[str]] = frozenset(
    {"read_file", "search", "edit_file", "list_dir", "run_tests", "build"}
)

#: The guard that refuses a tool that is not on the allow-list.
ALLOW_LIST: Final = "allow_list"

#: The guard that refuses a path outside the repository.
WORKSPACE_BOUNDARY: Final = "workspace_boundary"

#: What a dry run must not be able to do, and what a model might call it.
FORBIDDEN_CAPABILITIES: Final[dict[str, tuple[str, ...]]] = {
    "network_egress": (
        "http_request",
        "fetch_url",
        "web_search",
        "web_fetch",
        "curl",
        "download",
    ),
    "shell": ("run_shell", "bash", "exec", "run_command", "terminal"),
    "repository_write": (
        "write_file",
        "git_commit",
        "git_push",
        "commit",
        "push",
        "create_branch",
        "apply_patch",
        "delete_file",
    ),
    "farm_dispatch": ("dispatch_build", "farm_submit", "submit_job", "run_build_job"),
    "pull_request": (
        "open_pr",
        "create_pull_request",
        "merge_pr",
        "merge_pull_request",
        "approve_pr",
        "push_fixup",
    ),
    "ticket_source_write": (
        "create_issue",
        "comment_issue",
        "update_ticket",
        "close_issue",
        "add_label",
    ),
    "credential_access": (
        "lease_credential",
        "read_secret",
        "get_env",
        "get_token",
    ),
}


def capability_of(tool: str) -> str | None:
    """Name the forbidden capability a tool name belongs to, if it is a known one.

    Args:
        tool: The name a model called.

    Returns:
        The capability, or ``None`` for a name nobody listed — which is refused all the same.
    """
    for capability, names in FORBIDDEN_CAPABILITIES.items():
        if tool in names:
            return capability
    return None


@dataclass(frozen=True, slots=True)
class Blocked:
    """One refusal, as it happened.

    Attributes:
        guard: Which guard held.
        call: What was attempted.
        stage_key: The stage that attempted it.
    """

    guard: str
    call: str
    stage_key: str


class GuardAudit:
    """Every call the tool boundary refused during one dry run."""

    def __init__(self) -> None:
        """Start clean."""
        self._blocked: list[Blocked] = []

    def record(self, guard: str, call: str, stage_key: str) -> Blocked:
        """Write one refusal down.

        Args:
            guard: Which guard held.
            call: What was attempted. Cut to 80 characters: it is a name, not a payload.
            stage_key: The stage that attempted it.

        Returns:
            The entry.
        """
        blocked = Blocked(
            guard=guard, call=(call or "(unnamed)")[:80], stage_key=stage_key
        )
        self._blocked.append(blocked)
        return blocked

    @property
    def clean(self) -> bool:
        """Whether nothing was refused."""
        return not self._blocked

    def __len__(self) -> int:
        """How many calls were refused."""
        return len(self._blocked)

    def entries(self) -> list[GuardEntry]:
        """Summarise the audit as V111's ``guard_audit`` stores it.

        Returns:
            One entry per distinct ``(guard, call, stage)``, in first-seen order, with how
            many times it happened.
        """
        counts: dict[Blocked, int] = {}
        for blocked in self._blocked:
            counts[blocked] = counts.get(blocked, 0) + 1
        return [
            GuardEntry(
                guard=blocked.guard,
                call=blocked.call,
                count=count,
                stage_key=blocked.stage_key,
            )
            for blocked, count in counts.items()
        ]


def is_allowed(tool: str) -> bool:
    """Whether a tool exists for a dry-run stage.

    The one decision of the allow-list, in one place: the tool set asks it before doing
    anything, and the guard suite turns red if it ever answers ``True`` for something else.

    Args:
        tool: The name a model called.

    Returns:
        ``True`` only for a member of :data:`ALLOWED_TOOLS`.
    """
    return tool in ALLOWED_TOOLS
