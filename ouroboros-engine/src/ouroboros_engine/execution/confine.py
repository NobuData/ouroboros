"""Working-tree confinement — the one check that a path stays inside a run's tree.

DI.1 (`#1307 <https://github.com/NobuData/ouroboros/issues/1307>`_). The tool policy (DH.1)
calls :func:`resolve_in_tree` for every path a tool names, and
:meth:`~ouroboros_engine.execution.workspace.RunWorkspace.resolve` calls the same function, so
there is one rule and no second check that could disagree with it.

A path is inside when, after every symbolic link is resolved, it is the tree or lies under it
and no segment of it is git's own directory. That refuses each escape form:

* ``..`` segments that climb out (``../etc/passwd``, ``src/../../x``);
* an absolute path elsewhere (``/etc/passwd``);
* a symbolic link inside the tree that points out of it, or a path through one;
* any path through ``.git`` — the tree's own, or a nested one — because hooks and config there
  run code and hold remotes.

An absolute or ``..`` path that still resolves inside the tree is accepted: harness tools pass
absolute paths, and the policy judges where a path lands, not how it was spelled.
"""

import os
from pathlib import Path, PurePosixPath
from typing import Final

#: The directory inside a working tree that is not part of it: git's own, hooks included.
GIT_DIR: Final = ".git"


def resolve_in_tree(working_tree: str | os.PathLike[str], path: str) -> str | None:
    """The working-tree-relative form of a path, or ``None`` when it is not inside the tree.

    Symbolic links are resolved on both sides, so a link inside the tree that points out of
    it resolves out. A path need not exist: a file about to be written is resolved through
    its nearest existing parent.

    Args:
        working_tree: The tree's absolute path.
        path: Absolute, or relative to the tree.

    Returns:
        The relative path with forward slashes (``"."`` for the root itself), or ``None``
        when it escapes, passes through a ``.git`` directory, or is not a usable path at all.
    """
    if not path or "\x00" in path:
        return None
    root = Path(os.path.realpath(working_tree))
    candidate = Path(os.path.realpath(root / path))
    if not candidate.is_relative_to(root):
        return None
    relative = PurePosixPath(candidate.relative_to(root).as_posix())
    if any(part.lower() == GIT_DIR for part in relative.parts):
        return None
    return str(relative)
