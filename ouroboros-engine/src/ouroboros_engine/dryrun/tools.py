"""The six tools a dry-run stage has, and the one door every call goes through (CD.2, #560).

``read_file``, ``search``, ``list_dir`` and ``edit_file`` act on the
:class:`~.workspace.VirtualWorkspace`; ``build`` and ``run_tests`` are **replay stubs** that
answer with an estimate from history (:mod:`.estimates`). That is all there is.
:meth:`ToolSet.call` asks the allow-list first (:func:`~.guard.is_allowed`); a name that is
not on it is recorded in the guard audit and answered with a refusal the model can read — it
is never looked up, dispatched or run.

**The manifest a model is shown is rendered from the same table that dispatches**, so a tool
cannot be offered that does not exist, and one that exists cannot go unmentioned.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

from .estimates import EstimateUnavailableError, InfraKind, ReplayEstimates
from .guard import ALLOW_LIST, WORKSPACE_BOUNDARY, Blocked, GuardAudit, is_allowed
from .workspace import VirtualWorkspace, WorkspaceError

#: The most characters of one file a tool result carries back to the model.
MAX_READ_CHARS: Final = 60_000


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """One tool, as a model is told about it.

    Attributes:
        name: What it is called.
        arguments: Its arguments, as ``name: what it is``.
        does: One sentence.
    """

    name: str
    arguments: dict[str, str]
    does: str


#: The tools, in the order the manifest lists them.
TOOL_SPECS: Final[tuple[ToolSpec, ...]] = (
    ToolSpec(
        "read_file",
        {"path": "a path from the repository root"},
        "Read a file as it stands in this dry run.",
    ),
    ToolSpec(
        "list_dir",
        {"path": 'a directory, or "" for the root'},
        "List a directory's immediate children.",
    ),
    ToolSpec(
        "search",
        {"query": "literal text", "path": "optional directory to search under"},
        "Find text in file paths and file contents.",
    ),
    ToolSpec(
        "edit_file",
        {
            "path": "a path from the repository root",
            "content": "the file's whole new text (omit with delete)",
            "delete": "true to delete the file instead",
        },
        "Draft a change. It is held in memory as a simulated diff; the repository is "
        "never written.",
    ),
    ToolSpec(
        "build",
        {},
        "Estimate the build from the farm's history. Nothing is built.",
    ),
    ToolSpec(
        "run_tests",
        {},
        "Estimate the test run from history. No test is run.",
    ),
)


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    """What a call came to.

    Attributes:
        ok: Whether the tool did what was asked.
        content: The result, or the reason it was not done — text the model reads.
        blocked: The guard entry, when the boundary refused the call.
    """

    ok: bool
    content: str
    blocked: Blocked | None = None


def render_manifest() -> str:
    """Describe the tools to a model.

    Returns:
        One line per tool of :data:`TOOL_SPECS`: its name, its arguments and what it does.
    """
    lines: list[str] = []
    for spec in TOOL_SPECS:
        arguments = ", ".join(
            f"{name}: {what}" for name, what in spec.arguments.items()
        )
        lines.append(f"- {spec.name}({arguments}) — {spec.does}")
    return "\n".join(lines)


class ToolSet:
    """The tools of one stage of one dry run."""

    def __init__(
        self,
        workspace: VirtualWorkspace,
        estimates: ReplayEstimates,
        audit: GuardAudit,
        *,
        dry_run: str,
        stage_key: str,
    ) -> None:
        """Bind the tools to a run and a stage.

        Args:
            workspace: The virtual workspace.
            estimates: Where ``build`` and ``run_tests`` resolve.
            audit: The run's guard audit.
            dry_run: ``dry_runs.id``.
            stage_key: The stage calling — what an audit entry is attributed to.
        """
        self._workspace = workspace
        self._estimates = estimates
        self._audit = audit
        self._dry_run = dry_run
        self._stage_key = stage_key
        self.writes = 0
        self._handlers: dict[str, Callable[[dict[str, Any]], str]] = {
            "read_file": self._read_file,
            "list_dir": self._list_dir,
            "search": self._search,
            "edit_file": self._edit_file,
            "build": lambda _arguments: self._replay("build"),
            "run_tests": lambda _arguments: self._replay("test"),
        }

    def call(self, name: str, arguments: object) -> ToolOutcome:
        """Make one tool call — or refuse it.

        Args:
            name: The tool the model named.
            arguments: The arguments it gave.

        Returns:
            The result; a refusal carries the guard entry that was recorded.
        """
        if not is_allowed(name) or name not in self._handlers:
            blocked = self._audit.record(ALLOW_LIST, str(name), self._stage_key)
            return ToolOutcome(
                ok=False,
                content=f"There is no tool named `{blocked.call}` in a dry run.",
                blocked=blocked,
            )
        if not isinstance(arguments, dict):
            return ToolOutcome(ok=False, content="Arguments must be a JSON object.")
        try:
            return ToolOutcome(ok=True, content=self._handlers[name](arguments))
        except WorkspaceError as refused:
            blocked = None
            if refused.code == "invalid_path":
                blocked = self._audit.record(WORKSPACE_BOUNDARY, name, self._stage_key)
            return ToolOutcome(ok=False, content=refused.message, blocked=blocked)
        except EstimateUnavailableError as unavailable:
            return ToolOutcome(
                ok=False,
                content=f"No estimate is available ({unavailable.code}).",
            )

    def _read_file(self, arguments: dict[str, Any]) -> str:
        """Read a file through the overlay.

        Args:
            arguments: ``path``.

        Returns:
            The text, cut at :data:`MAX_READ_CHARS` with a line saying so.
        """
        text = self._workspace.read(_text(arguments, "path"))
        if len(text) > MAX_READ_CHARS:
            return f"{text[:MAX_READ_CHARS]}\n[cut: {len(text)} characters in all]"
        return text

    def _list_dir(self, arguments: dict[str, Any]) -> str:
        """List a directory.

        Args:
            arguments: ``path``, optional.

        Returns:
            One child per line.
        """
        return (
            "\n".join(self._workspace.list_dir(_text(arguments, "path", "")))
            or "(empty)"
        )

    def _search(self, arguments: dict[str, Any]) -> str:
        """Search paths and contents.

        Args:
            arguments: ``query`` and an optional ``path``.

        Returns:
            ``path:line: text`` per match.
        """
        query = _text(arguments, "query")
        if not query.strip():
            return "A search needs a query."
        matches = self._workspace.search(query, _text(arguments, "path", ""))
        if not matches:
            return "No matches."
        return "\n".join(
            match.path
            if match.line == 0
            else f"{match.path}:{match.line}: {match.text}"
            for match in matches
        )

    def _edit_file(self, arguments: dict[str, Any]) -> str:
        """Write or delete a file in the overlay.

        Args:
            arguments: ``path`` and either ``content`` or ``delete: true``.

        Returns:
            A confirmation that says the change is simulated.
        """
        path = _text(arguments, "path")
        if arguments.get("delete") is True:
            self._workspace.delete(path)
            self.writes += 1
            return f"Deleted {path} in the simulated diff. The repository is untouched."
        content = arguments.get("content")
        if not isinstance(content, str):
            return "edit_file needs `content` (the file's whole new text) or `delete: true`."
        self._workspace.write(path, content)
        self.writes += 1
        return f"Drafted {path} in the simulated diff. The repository is untouched."

    def _replay(self, kind: InfraKind) -> str:
        """Answer a build or test request with an estimate from history.

        Args:
            kind: ``build`` or ``test``.

        Returns:
            The estimator's own line.
        """
        estimate = self._estimates.estimate(
            self._dry_run, kind, runner_pool=None, command=None
        )
        return f"Replayed from history, nothing was run: {estimate.note}"


def _text(arguments: dict[str, Any], name: str, default: str | None = None) -> str:
    """Read a string argument.

    Args:
        arguments: The call's arguments.
        name: Which one.
        default: What to use when it is absent; ``None`` makes it required.

    Returns:
        The string.

    Raises:
        WorkspaceError: ``invalid_argument`` when it is missing or not a string.
    """
    value = arguments.get(name, default)
    if not isinstance(value, str):
        raise WorkspaceError("invalid_argument", f"`{name}` must be a string.")
    return value
