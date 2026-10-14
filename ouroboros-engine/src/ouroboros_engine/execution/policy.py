"""The tool policy — one decision, made before a tool runs, for every executor kind.

DH.1 (`#1302 <https://github.com/NobuData/ouroboros/issues/1302>`_). A native executor asks
it between tool calls; a harness executor asks it from its pre-tool hook. Both hand it the
same :class:`ToolRequest` and get back the same :class:`ToolVerdict`, because there is only
:func:`evaluate`. This is where #160's *"permission enforcement at the tool boundary"* and
#315's *"halt on fail"* are implemented once: a ``deny`` verdict means the tool is not run
and the stage halts.

The rules, in the order they are checked — the first that refuses decides:

1. ``allow_list`` — the tool is not on the stage's allow-list. The default is decision
   **L5**'s file tools (:data:`L5_TOOLS`): read, list, search, write and edit, and nothing
   else — no shell, no network, no MCP.
2. ``stage_permission`` — the tool is ``push_fixup`` and the stage declared
   ``push_fixup: false`` (decision **P9**).
3. ``working_tree`` — a path resolves outside the run's working tree, or into its ``.git``
   directory, or a write names no path at all. Symbolic links are resolved first, so a link
   that points out is out.
4. ``stage_permission`` — a write lands on CI configuration
   (:data:`~ouroboros_engine.execution.glob.CI_CONFIG_GLOBS`) and the stage declared
   ``touch_ci: false``.
5. ``protected_path`` — a write lands on one of the workspace's protected paths.

Reads are held to rules 1 and 3 only: reading a protected file changes nothing, and AP.3
judges change-sets, not reads.
"""

import os
from pathlib import Path, PurePosixPath
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ouroboros_engine.execution.glob import CI_CONFIG_GLOBS, first_match
from ouroboros_engine.workflows.dsl import LlmPermissions

#: Tools that only look.
READ_TOOLS: Final[frozenset[str]] = frozenset({"read_file", "list_dir", "search"})

#: Tools that change the working tree. ``delete_file`` is not on the L5 list; it is named
#: here so a future allow-list that adds it is held to the write rules automatically.
WRITE_TOOLS: Final[frozenset[str]] = frozenset(
    {"write_file", "edit_file", "delete_file"}
)

#: Decision L5: file tools only, confined to one working tree.
L5_TOOLS: Final[frozenset[str]] = frozenset(
    {"read_file", "list_dir", "search", "write_file", "edit_file"}
)

#: The tool decision P9's ``push_fixup`` permission governs.
PUSH_FIXUP_TOOL: Final = "push_fixup"

#: The directory inside a working tree that is not part of it: git's own, hooks included.
GIT_DIR: Final = ".git"

#: Why a request was refused.
PolicyRule = Literal["allow_list", "stage_permission", "working_tree", "protected_path"]

#: The rules, in evaluation order.
POLICY_RULES: Final[tuple[str, ...]] = (
    "allow_list",
    "stage_permission",
    "working_tree",
    "protected_path",
)

#: A tool name in the executor-neutral vocabulary — also AP.1's ``tool_tag`` grammar.
ToolName = Annotated[
    str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]([a-z0-9_]*[a-z0-9])?$")
]


class _Model(BaseModel):
    """Frozen, and strict about unknown fields."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ToolPolicy(_Model):
    """What one stage attempt may do with its tools.

    Attributes:
        working_tree: The absolute path of the run's working tree (DI.1). Nothing outside
            it, and nothing in its ``.git``, may be read or written.
        permissions: The stage's declared P9 permissions, from the pinned workflow.
        protected_paths: The workspace's protected-path globs, in AP.3's grammar.
        allowed_tools: The stage's allow-list. Defaults to L5's file tools.
    """

    working_tree: str = Field(min_length=1)
    permissions: LlmPermissions
    protected_paths: tuple[str, ...] = ()
    allowed_tools: frozenset[str] = L5_TOOLS

    @field_validator("working_tree")
    @classmethod
    def _absolute(cls, value: str) -> str:
        """Refuse a relative tree: it would resolve against whatever the cwd happens to be."""
        if not Path(value).is_absolute():
            raise ValueError("working_tree must be an absolute path")
        return value


class ToolRequest(_Model):
    """One tool call, as every executor kind describes it to the policy.

    An adapter translates its own tool names into this vocabulary (a harness's ``Write``
    becomes ``write_file``) before asking; a name it cannot translate is passed through
    unchanged, and the allow-list refuses it.

    Attributes:
        call_id: The executor's id for this call, echoed on its result.
        tool: The tool, in the executor-neutral vocabulary.
        paths: Every path the call names, absolute or working-tree-relative. Empty for a
            call that names none (a search of the whole tree).
    """

    call_id: str = Field(min_length=1, max_length=200)
    tool: ToolName
    paths: tuple[str, ...] = ()


class ToolVerdict(_Model):
    """What the policy decided about one request.

    Attributes:
        decision: ``allow`` or ``deny``. A ``deny`` is a halt: the tool is not run.
        rule: The rule that refused, or ``None`` when allowed.
        reason: One sentence a person can read in the transcript.
        path: The working-tree-relative path the refusal is about, when there is one.
        glob: The glob that matched it, when a glob decided.
    """

    decision: Literal["allow", "deny"]
    rule: PolicyRule | None = None
    reason: str
    path: str | None = None
    glob: str | None = None

    @property
    def halts(self) -> bool:
        """Whether this verdict stops the stage (#315's halt on fail)."""
        return self.decision == "deny"


def _allow(request: ToolRequest) -> ToolVerdict:
    """The verdict for a request no rule refused."""
    return ToolVerdict(decision="allow", reason=f"{request.tool} is allowed.")


def _deny(
    rule: PolicyRule, reason: str, path: str | None = None, glob: str | None = None
) -> ToolVerdict:
    """A refusal."""
    return ToolVerdict(decision="deny", rule=rule, reason=reason, path=path, glob=glob)


def resolve_in_tree(working_tree: str, path: str) -> str | None:
    """The working-tree-relative form of a path, or ``None`` when it is not inside the tree.

    Symbolic links are resolved on both sides, so a link inside the tree that points out of
    it resolves out. A path need not exist: a file about to be written is resolved through
    its nearest existing parent.

    Args:
        working_tree: The tree's absolute path.
        path: Absolute, or relative to the tree.

    Returns:
        The relative path with forward slashes (``"."`` for the root itself), or ``None``
        when it escapes, names the ``.git`` directory, or is not a usable path at all.
    """
    if not path or "\x00" in path:
        return None
    root = Path(os.path.realpath(working_tree))
    candidate = Path(os.path.realpath(root / path))
    if not candidate.is_relative_to(root):
        return None
    relative = PurePosixPath(candidate.relative_to(root).as_posix())
    if relative.parts and relative.parts[0] == GIT_DIR:
        return None
    return str(relative)


def evaluate(policy: ToolPolicy, request: ToolRequest) -> ToolVerdict:
    """Decide one tool request. The only implementation of the policy; see the module.

    Pure: no I/O beyond resolving symbolic links, and no state, so the same request against
    the same policy is the same verdict whichever executor asks.

    Args:
        policy: The stage attempt's policy.
        request: The call about to be made.

    Returns:
        ``allow``, or the first rule's ``deny``.
    """
    if request.tool not in policy.allowed_tools:
        return _deny("allow_list", f"{request.tool} is not on this stage's allow-list.")
    if request.tool == PUSH_FIXUP_TOOL and not policy.permissions.push_fixup:
        return _deny("stage_permission", "This stage declares push_fixup: false.")

    if request.tool in WRITE_TOOLS and not request.paths:
        return _deny("working_tree", "A write must name the path it writes.")
    relative_paths: list[str] = []
    for path in request.paths:
        relative = resolve_in_tree(policy.working_tree, path)
        if relative is None:
            return _deny(
                "working_tree", "The path is outside the run's working tree.", path=path
            )
        relative_paths.append(relative)

    if request.tool not in WRITE_TOOLS:
        return _allow(request)

    for relative in relative_paths:
        ci_glob = first_match(relative, CI_CONFIG_GLOBS)
        if ci_glob is not None and not policy.permissions.touch_ci:
            return _deny(
                "stage_permission",
                "The path is CI configuration and this stage declares touch_ci: false.",
                path=relative,
                glob=ci_glob,
            )
        protected = first_match(relative, policy.protected_paths)
        if protected is not None:
            return _deny(
                "protected_path",
                "The path is protected in this workspace.",
                path=relative,
                glob=protected,
            )
    return _allow(request)
