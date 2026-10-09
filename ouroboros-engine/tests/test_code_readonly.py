"""No operation mutates a repository — asserted structurally and by fingerprint (#617).

Two halves, because either alone can be fooled:

* **Structurally.** The operation modules (``mining``, ``deps``) and the view they are handed
  (``repo``) import nothing from dulwich that writes, call no method that writes, and never
  assign into or delete from a subscript. Writing to a clone is :mod:`~ouroboros_engine.code.
  clones`' job alone, and only for a fetch.
* **Behaviourally.** Every operation, run over a clone, leaves the clone's bytes — and the
  remote's — exactly as they were.
"""

import ast
import hashlib
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest

from code_fixtures import SeededRepo, build_repo
from ouroboros_engine.code import deps, mining, repo
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.code.contract import CloneInfo
from ouroboros_engine.code.repo import ReadOnlyRepo

#: The modules an operation runs in.
OPERATION_MODULES = (mining, deps, repo)

#: The dulwich modules (and, from ``repo``, the names) they may import.
ALLOWED_IMPORTS = {
    "dulwich.annotate": {"annotate_lines"},
    "dulwich.diff_tree": {"TreeChange", "tree_changes"},
    "dulwich.errors": {"NotTreeError"},
    "dulwich.objects": {"Blob", "Commit", "ShaFile", "Tree", "TreeEntry"},
    "dulwich.object_store": {
        "BaseObjectStore",
        "iter_tree_contents",
        "peel_sha",
        "tree_lookup_path",
    },
    # The type of the clone ReadOnlyRepo wraps — repo.py only.
    "dulwich.repo": {"Repo"},
}

#: Methods that write an object, a ref, a file or a remote.
WRITING_METHODS = {
    "add_object",
    "add_objects",
    "add_pack",
    "add_thin_pack",
    "add_if_new",
    "set_if_equals",
    "set_symbolic_ref",
    "remove_if_equals",
    "do_commit",
    "stage",
    "fetch",
    "push",
    "send_pack",
    "init",
    "init_bare",
    "write_text",
    "write_bytes",
    "unlink",
    "rmtree",
    "mkdir",
    "rename",
    "chmod",
}

WORKSPACE = "5eed0617-0000-4000-8000-000000000001"
CLONE = CloneInfo(
    repository="acme/helios-firmware",
    fetched_at=datetime(2026, 10, 9, tzinfo=UTC),
    stale=False,
)


def _tree(module: object) -> ast.Module:
    source = Path(module.__file__).read_text(encoding="utf-8")  # type: ignore[attr-defined]
    return ast.parse(source)


@pytest.mark.parametrize("module", OPERATION_MODULES, ids=lambda m: m.__name__)
def test_operation_modules_import_only_dulwichs_read_side(module: object) -> None:
    for node in ast.walk(_tree(module)):
        if isinstance(node, ast.Import):
            assert not any(alias.name.startswith("dulwich") for alias in node.names)
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
            "dulwich"
        ):
            allowed = ALLOWED_IMPORTS.get(node.module or "")
            assert allowed is not None, f"{module.__name__} imports {node.module}"  # type: ignore[attr-defined]
            if node.module == "dulwich.repo":
                assert module is repo, "only the read-only view names the clone's type"
            assert {alias.name for alias in node.names} <= allowed


@pytest.mark.parametrize("module", OPERATION_MODULES, ids=lambda m: m.__name__)
def test_operation_modules_call_nothing_that_writes(module: object) -> None:
    for node in ast.walk(_tree(module)):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            assert node.func.attr not in WRITING_METHODS, (
                f"{module.__name__} calls .{node.func.attr}()"  # type: ignore[attr-defined]
            )
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in {"open", *WRITING_METHODS}


@pytest.mark.parametrize("module", OPERATION_MODULES, ids=lambda m: m.__name__)
def test_operation_modules_never_store_into_a_subscript(module: object) -> None:
    # `repo.refs[name] = sha` and `del repo.refs[name]` are how a ref moves.
    for node in ast.walk(_tree(module)):
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AugAssign | ast.AnnAssign):
            targets = [node.target]
        elif isinstance(node, ast.Delete):
            targets = node.targets
        for target in targets:
            # A local tally (`tally[0] += 1`) is a list, not a repository; refs and
            # stores are only ever reached through an attribute.
            if isinstance(target, ast.Subscript):
                assert not isinstance(target.value, ast.Attribute), (
                    f"{module.__name__} stores into {ast.unparse(target)}"  # type: ignore[attr-defined]
                )


def test_the_read_only_view_offers_no_writing_member() -> None:
    members = {name for name in dir(ReadOnlyRepo) if not name.startswith("_")}

    assert members == {
        "blob",
        "blob_by_id",
        "close",
        "commit",
        "entry",
        "files_under",
        "full_name",
        "resolve",
        "store",
    }


# ---------------------------------------------------------------------------
# Fingerprints
# ---------------------------------------------------------------------------


def _fingerprint(root: Path) -> str:
    """Every file under a directory — path, mode and bytes — as one digest.

    Args:
        root: The directory.

    Returns:
        A sha256 hex digest.
    """
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(str(path.stat().st_mode).encode())
        if path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()


@pytest.fixture
def clone(tmp_path: Path) -> Iterator[tuple[SeededRepo, Path, ReadOnlyRepo]]:
    """A remote, its clone's path, and the clone opened read-only."""
    seeded = build_repo(tmp_path / "remote" / "helios-firmware.git")
    store = CloneStore(tmp_path / "clones", allow_local=True)
    ref = RepositoryRef(WORKSPACE, "acme/helios-firmware", str(seeded.path))
    opened = store.open(ref)
    yield seeded, store.path_of(ref), opened.repo
    opened.repo.close()


OPERATIONS: dict[str, Callable[[ReadOnlyRepo], object]] = {
    "blame": lambda r: mining.blame(
        r, CLONE, "nightly", "src/dock/dock_ctrl.c", 1, 300
    ),
    "history": lambda r: mining.history(
        r, CLONE, "nightly", path=None, symbol="approach_kp", window_days=3650
    ),
    "changed_between": lambda r: mining.changed_between(
        r, CLONE, "v2.0.4", "nightly", None
    ),
    "bisect_commits": lambda r: mining.bisect_commits(r, CLONE, "v2.0.4", "nightly"),
    "dep_graph": lambda r: deps.dep_graph(r, CLONE, "nightly", None, "c"),
}


@pytest.mark.parametrize("name", sorted(OPERATIONS))
def test_no_operation_changes_a_byte_of_the_clone_or_the_remote(
    clone: tuple[SeededRepo, Path, ReadOnlyRepo], name: str
) -> None:
    seeded, path, view = clone
    before = (_fingerprint(path), _fingerprint(seeded.path))

    OPERATIONS[name](view)

    assert (_fingerprint(path), _fingerprint(seeded.path)) == before
