"""The Claude Agent harness's tools, in the policy's vocabulary.

DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_). The harness names its
tools its own way (``Write``, ``Glob``); the tool policy reads DH.1's executor-neutral names
(``write_file``, ``search``) and the paths a call names. This module is the translation, and
the lists of what the harness is offered and what it is refused by name.
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Any, Final, Literal

from ouroboros_engine.execution.confine import resolve_in_tree
from ouroboros_engine.execution.policy import ToolRequest

#: Decision L5's file tools, as the harness names them — its ``tools`` option. Nothing
#: else is offered to the model: no shell, no network, no agents, no MCP.
OFFERED_TOOLS: Final[tuple[str, ...]] = ("Read", "Glob", "Grep", "Edit", "Write")

#: Tools refused by name as well (``disallowed_tools``), so a harness release that adds a
#: tool to the base set still cannot offer these. The names are the bundled CLI 2.1.300's
#: own; MCP has no tools to name because no server is configured and ``strict_mcp_config``
#: keeps every other configuration out.
DISALLOWED_TOOLS: Final[tuple[str, ...]] = (
    "Agent",
    "Bash",
    "BashOutput",
    "CronCreate",
    "CronDelete",
    "CronList",
    "EnterWorktree",
    "ExitWorktree",
    "KillShell",
    "ListAgents",
    "ListMcpResourcesTool",
    "NotebookEdit",
    "ReadMcpResourceTool",
    "ReportFindings",
    "ScheduleWakeup",
    "SendMessage",
    "Skill",
    "Task",
    "TaskStop",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
    "Workflow",
)

#: Harness name → the policy's neutral name.
NEUTRAL_NAMES: Final[dict[str, str]] = {
    "Read": "read_file",
    "Glob": "search",
    "Grep": "search",
    "Edit": "edit_file",
    "Write": "write_file",
}

#: Characters a glob uses; a pattern's literal directory ends before the first of them.
_GLOB_CHARS: Final = re.compile(r"[*?\[{]")

#: Anything the neutral tool-name grammar does not allow.
_NOT_A_NAME_CHAR: Final = re.compile(r"[^a-z0-9_]+")


def neutral_name(name: str) -> str:
    """The policy's name for a harness tool.

    An unknown tool keeps its own name, lower-cased and fitted to the neutral grammar, so
    the policy's allow-list refuses it by a recognisable name (``Bash`` → ``bash``).

    Args:
        name: The harness's tool name.

    Returns:
        A name the :class:`~ouroboros_engine.execution.policy.ToolRequest` grammar accepts.
    """
    known = NEUTRAL_NAMES.get(name)
    if known is not None:
        return known
    fitted = _NOT_A_NAME_CHAR.sub("_", name.lower()).strip("_")[:64].strip("_")
    return fitted or "unknown_tool"


def _pattern_base(pattern: str) -> str | None:
    """The literal directory a glob pattern starts from, when it can reach outside the tree.

    Args:
        pattern: A ``Glob`` pattern.

    Returns:
        The part before the first glob character, for an absolute pattern or one that
        climbs with ``..``; ``None`` for a pattern relative to the search directory.
    """
    if not (pattern.startswith("/") or ".." in PurePosixPath(pattern).parts):
        return None
    literal = _GLOB_CHARS.split(pattern, maxsplit=1)[0]
    return literal or "/"


def tool_paths(name: str, tool_input: dict[str, Any]) -> tuple[str, ...]:
    """Every path a harness tool call names.

    Args:
        name: The harness's tool name.
        tool_input: The call's input.

    Returns:
        ``file_path`` for the file tools; ``path`` for a search, plus a ``Glob``
        pattern's literal base when the pattern is absolute or climbs out. Empty for a call
        that names none (a search of the whole tree).
    """
    paths: list[str] = []
    for key in ("file_path", "notebook_path", "path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            paths.append(value)
    if name == "Glob":
        pattern = tool_input.get("pattern")
        base = _pattern_base(pattern) if isinstance(pattern, str) else None
        if base is not None:
            paths.append(base)
    return tuple(paths)


def to_request(name: str, tool_input: dict[str, Any], call_id: str) -> ToolRequest:
    """Translate one harness tool call into the request the policy decides.

    Args:
        name: The harness's tool name.
        tool_input: The call's input.
        call_id: The harness's ``tool_use_id``.

    Returns:
        The request.
    """
    return ToolRequest(
        call_id=call_id[:200] or "unidentified",
        tool=neutral_name(name),
        paths=tool_paths(name, tool_input),
    )


def file_status(
    working_tree: str, path: str
) -> tuple[str, Literal["added", "modified"]] | None:
    """Whether a write will add a file or modify one — asked before the write runs.

    Args:
        working_tree: The run's tree.
        path: The path the write names.

    Returns:
        The tree-relative path and ``added`` or ``modified``; ``None`` for a path outside
        the tree (the policy has refused it already).
    """
    relative = resolve_in_tree(working_tree, path)
    if relative is None:
        return None
    exists = (Path(working_tree) / relative).exists()
    return relative, "modified" if exists else "added"
