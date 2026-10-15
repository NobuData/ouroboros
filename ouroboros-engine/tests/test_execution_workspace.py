"""The run workspace (DI.1, #1307) — a writable, confined, checkpointed tree per run."""

import os
import shutil
import signal
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
from dulwich.repo import Repo

from code_fixtures import SeededRepo, add_commit, build_repo
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.execution.policy import ToolPolicy, ToolRequest, evaluate
from ouroboros_engine.execution.workspace import (
    PathEscapeError,
    RunSpec,
    RunWorkspace,
    RunWorkspaces,
    WorkspaceBusyError,
    WorkspaceConflictError,
    WorkspaceError,
    WorkspaceLimitError,
    WorkspaceRefusedError,
)
from ouroboros_engine.workflows.dsl import LlmPermissions

WORKSPACE = "org-acme"
SLUG = "acme/helios-firmware"
CANARY = "ghp_canary-never-written-1307"
RUN = "0b5e1307-0000-4000-8000-000000000001"
OTHER_RUN = "0b5e1307-0000-4000-8000-000000000002"
MB = 1024 * 1024


class Clock:
    """A settable clock."""

    def __init__(self) -> None:
        """Start at a fixed instant."""
        self.now = 1_760_000_000.0

    def __call__(self) -> float:
        """The current instant."""
        return self.now


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """The fixture repository, as the remote."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def clock() -> Clock:
    """The store's clock."""
    return Clock()


@pytest.fixture
def clones(tmp_path: Path) -> CloneStore:
    """A clone cache reading local remotes."""
    return CloneStore(tmp_path / "clones", allow_local=True)


@pytest.fixture
def store(tmp_path: Path, clones: CloneStore, clock: Clock) -> RunWorkspaces:
    """Run trees with roomy limits and plenty of free disk."""
    return RunWorkspaces(
        tmp_path / "runs",
        clones,
        max_bytes=64 * MB,
        idle_seconds=3600.0,
        clock=clock,
        disk_free=lambda _path: 1024 * MB,
    )


def _spec(
    seeded: SeededRepo, run: str = RUN, base: str = "c3", issue: int = 42
) -> RunSpec:
    return RunSpec(
        run=run,
        issue_number=issue,
        base_commit=seeded.sha(base) if len(base) < 40 else base,
        repository=RepositoryRef(WORKSPACE, SLUG, str(seeded.path), CANARY),
    )


def _files(tree: Path) -> dict[str, bytes]:
    return {
        path.relative_to(tree).as_posix(): path.read_bytes()
        for path in tree.rglob("*")
        if path.is_file() and ".git" not in path.relative_to(tree).parts
    }


# ── creation ────────────────────────────────────────────────────────────────────────────


def test_a_tree_is_checked_out_at_the_base_on_the_run_branch(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)) as workspace:
        repo = Repo(str(workspace.path))
        assert workspace.path == store.root / RUN / "tree"
        assert (
            repo.refs.get_symrefs()[b"HEAD"] == f"refs/heads/ouro/run-{RUN}-42".encode()
        )
        assert workspace.head == seeded.sha("c3")
        assert not workspace.restored
        assert workspace.changes() == []
        assert "src/dock/dock_ctrl.c" in _files(workspace.path)
        repo.close()


def test_the_tree_borrows_objects_and_the_mirror_is_never_written(
    store: RunWorkspaces, clones: CloneStore, seeded: SeededRepo
) -> None:
    spec = _spec(seeded)
    with store.open(spec) as workspace:
        (workspace.path / "new.txt").write_text("x\n")
        workspace.checkpoint("implement")
        alternates = workspace.path / ".git" / "objects" / "info" / "alternates"
        assert alternates.read_text().strip() == str(
            (clones.path_of(spec.repository) / "objects").resolve()
        )
    mirror = Repo(str(clones.path_of(spec.repository)))
    assert not [name for name in mirror.refs.allkeys() if b"ouro/" in name]
    mirror.close()


def test_a_base_commit_newer_than_the_mirror_forces_one_fetch(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)):
        pass
    newer = add_commit(seeded, "later", "2026-06-01", {"NEW.md": b"new\n"})
    with store.open(_spec(seeded, run=OTHER_RUN, base=newer)) as workspace:
        assert (workspace.path / "NEW.md").read_bytes() == b"new\n"


def test_a_base_commit_the_repository_lacks_is_refused(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with pytest.raises(WorkspaceError, match="no commit"):
        store.open(_spec(seeded, base="f" * 40))
    assert not (store.root / RUN).exists()


@pytest.mark.parametrize(
    ("run", "issue", "base", "message"),
    [
        ("../escape", 1, "a" * 40, "run id"),
        ("", 1, "a" * 40, "run id"),
        (RUN, 0, "a" * 40, "issue"),
        (RUN, 1, "HEAD", "base commit"),
    ],
)
def test_malformed_run_inputs_are_refused(
    store: RunWorkspaces,
    seeded: SeededRepo,
    run: str,
    issue: int,
    base: str,
    message: str,
) -> None:
    spec = RunSpec(run, issue, base, RepositoryRef(WORKSPACE, SLUG, str(seeded.path)))
    with pytest.raises(WorkspaceError, match=message):
        store.open(spec)


# ── isolation ───────────────────────────────────────────────────────────────────────────


def test_two_concurrent_runs_on_one_repository_never_see_each_others_files(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    first = store.open(_spec(seeded, issue=1))
    second = store.open(_spec(seeded, run=OTHER_RUN, issue=2))
    try:
        (first.path / "only-first.txt").write_text("first\n")
        (second.path / "VERSION").write_text("second\n")
        first.checkpoint("implement")

        assert not (second.path / "only-first.txt").exists()
        assert (first.path / "VERSION").read_text() != "second\n"
        assert [file.path for file in first.changes()] == ["only-first.txt"]
        assert [file.path for file in second.changes()] == ["VERSION"]
        second_repo = Repo(str(second.path))
        assert f"ouro/run-{RUN}-1".encode() not in b"".join(second_repo.refs.keys())
        second_repo.close()
    finally:
        first.close()
        second.close()


def test_a_tree_open_elsewhere_cannot_be_opened_again(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)), pytest.raises(WorkspaceBusyError):
        store.open(_spec(seeded))


def test_a_tree_made_for_another_base_is_a_conflict(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)):
        pass
    with pytest.raises(WorkspaceConflictError):
        store.open(_spec(seeded, base="c4"))


# ── confinement ─────────────────────────────────────────────────────────────────────────


@pytest.fixture
def workspace(store: RunWorkspaces, seeded: SeededRepo, tmp_path: Path):
    """An open tree with a symbolic link that leaves it."""
    opened = store.open(_spec(seeded))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("outside\n")
    (opened.path / "escape").symlink_to(outside, target_is_directory=True)
    yield opened
    opened.close()


ESCAPES = {
    "symlink": "escape/secret.txt",
    "dotdot": "../../outside/secret.txt",
    "dotdot-inside-first": "src/../../tree-sibling",
    "absolute": "/etc/passwd",
    "git-dir": ".git/config",
    "git-dir-absolute": None,  # filled from the tree's path
    "nested-git-dir": "vendor/lib/.git/hooks/pre-commit",
    "git-dir-case": ".GIT/config",
}


@pytest.mark.parametrize("form", sorted(ESCAPES))
def test_each_path_escape_form_is_refused(workspace: RunWorkspace, form: str) -> None:
    path = ESCAPES[form] or str(workspace.path / ".git" / "config")
    with pytest.raises(PathEscapeError):
        workspace.resolve(path)
    policy = ToolPolicy(
        working_tree=str(workspace.path),
        permissions=LlmPermissions(push_fixup=False, touch_ci=False),
    )
    for tool in ("read_file", "write_file"):
        verdict = evaluate(
            policy, ToolRequest(call_id=f"call-{tool}", tool=tool, paths=(path,))
        )
        assert verdict.decision == "deny"
        assert verdict.rule == "working_tree"


def test_a_path_that_lands_inside_is_accepted_however_spelled(
    workspace: RunWorkspace,
) -> None:
    assert workspace.resolve("src/dock/dock_ctrl.c") == "src/dock/dock_ctrl.c"
    assert workspace.resolve("src/../VERSION") == "VERSION"
    assert workspace.resolve(str(workspace.path / "new" / "file.py")) == "new/file.py"


# ── credentials ─────────────────────────────────────────────────────────────────────────


def test_no_credential_reaches_the_tree_or_its_git_config(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    def assert_clean() -> None:
        for path in (store.root / RUN).rglob("*"):
            if path.is_file():
                assert CANARY.encode() not in path.read_bytes(), path
        config = (store.root / RUN / "tree" / ".git" / "config").read_text()
        assert "[remote" not in config
        assert "url" not in config

    workspace = store.open(_spec(seeded))
    assert_clean()
    (workspace.path / "a.txt").write_text("a\n")
    workspace.changes()
    assert_clean()
    workspace.checkpoint("implement")
    assert_clean()
    workspace.close()
    store.open(_spec(seeded)).close()
    assert_clean()
    assert CANARY not in repr(_spec(seeded))


# ── checkpoints and resume ──────────────────────────────────────────────────────────────


def test_a_checkpoint_commits_locally_and_an_unchanged_stage_makes_none(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)) as workspace:
        (workspace.path / "VERSION").write_text("9.9.9\n")
        first = workspace.checkpoint("implement")
        assert first != seeded.sha("c3")
        assert workspace.checkpoint("review") == first
        repo = Repo(str(workspace.path))
        commit = repo[first.encode()]
        repo.close()
        assert commit.message == b"ouroboros checkpoint: implement"
        assert commit.parents == [seeded.sha("c3").encode()]


def test_reopening_resets_the_tree_to_its_last_checkpoint(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)) as workspace:
        (workspace.path / "VERSION").write_text("2.0.0\n")
        (workspace.path / ".gitignore").write_text("build/\n")
        checkpoint = workspace.checkpoint("implement")
        expected = _files(workspace.path)
        (workspace.path / "VERSION").write_text("half-written")
        (workspace.path / "stray.txt").write_text("stray\n")
        (workspace.path / "src" / "dock" / "dock_ctrl.c").unlink()
    with store.open(_spec(seeded)) as reopened:
        assert reopened.restored
        assert reopened.head == checkpoint
        assert _files(reopened.path) == expected


def test_a_killed_engine_leaves_the_tree_at_its_last_checkpoint(
    store: RunWorkspaces, seeded: SeededRepo, tmp_path: Path
) -> None:
    script = tmp_path / "stage.py"
    script.write_text(
        textwrap.dedent(
            f"""
            import os, signal
            from pathlib import Path
            from ouroboros_engine.code.clones import CloneStore, RepositoryRef
            from ouroboros_engine.execution.workspace import RunSpec, RunWorkspaces

            store = RunWorkspaces(
                Path({str(store.root)!r}),
                CloneStore(Path({str(store.clones.root)!r}), allow_local=True),
                max_bytes={store.max_bytes},
                disk_free=lambda _p: 1 << 40,
            )
            spec = RunSpec({RUN!r}, 42, {seeded.sha("c3")!r},
                           RepositoryRef({WORKSPACE!r}, {SLUG!r}, {str(seeded.path)!r}))
            workspace = store.open(spec)
            (workspace.path / "VERSION").write_text("checkpointed\\n")
            print(workspace.checkpoint("plan"), flush=True)
            (workspace.path / "VERSION").write_text("mid-stage")
            (workspace.path / "half.txt").write_text("half")
            os.kill(os.getpid(), signal.SIGKILL)
            """
        )
    )
    result = subprocess.run(  # noqa: S603 — the test's own interpreter and script
        [sys.executable, str(script)], capture_output=True, text=True, check=False
    )
    assert result.returncode == -signal.SIGKILL, result.stderr
    checkpoint = result.stdout.strip()

    with store.open(_spec(seeded)) as workspace:
        assert workspace.restored
        assert workspace.head == checkpoint
        assert (workspace.path / "VERSION").read_text() == "checkpointed\n"
        assert not (workspace.path / "half.txt").exists()
        assert [file.path for file in workspace.changes()] == ["VERSION"]


# ── change reports ──────────────────────────────────────────────────────────────────────


def _edit(tree: Path) -> None:
    (tree / "VERSION").write_text("2.0.0\nwith a second line\n")
    (tree / "src" / "dock" / "dock_ctrl.h").unlink()
    (tree / "docs").mkdir(exist_ok=True)
    (tree / "docs" / "new.md").write_text("one\ntwo\nthree\n")
    (tree / "blob.bin").write_bytes(b"\x00\x01\x02")
    (tree / ".gitignore").write_text("build/\n")
    (tree / "build").mkdir()
    (tree / "build" / "out.o").write_bytes(b"ignored")


def test_changes_are_the_trees_diff_against_the_base(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)) as workspace:
        _edit(workspace.path)
        workspace.checkpoint("implement")
        (workspace.path / "docs" / "new.md").write_text("one\nTWO\nthree\nfour\n")
        reported = {file.path: file for file in workspace.changes()}

    assert sorted(reported) == [
        ".gitignore",
        "VERSION",
        "blob.bin",
        "docs/new.md",
        "src/dock/dock_ctrl.h",
    ]
    assert reported["docs/new.md"].status == "added"
    assert (reported["docs/new.md"].additions, reported["docs/new.md"].deletions) == (
        4,
        0,
    )
    assert reported["src/dock/dock_ctrl.h"].status == "deleted"
    assert reported["VERSION"].status == "modified"
    assert reported["blob.bin"].additions is None


@pytest.mark.skipif(shutil.which("git") is None, reason="needs the git binary")
def test_reported_changes_equal_git_diff_of_the_tree(
    store: RunWorkspaces, seeded: SeededRepo, tmp_path: Path
) -> None:
    with store.open(_spec(seeded)) as workspace:
        _edit(workspace.path)
        workspace.checkpoint("implement")
        (workspace.path / "VERSION").write_text("3.0.0\n")
        (workspace.path / "src" / "motor" / "pid.c").write_text("int pid;\n")
        reported = {
            file.path: (file.status[0].upper(), file.additions, file.deletions)
            for file in workspace.changes()
        }
        env = {
            **os.environ,
            "GIT_INDEX_FILE": str(tmp_path / "scratch-index"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "HOME": str(tmp_path),
        }
        git = ["git", "-C", str(workspace.path)]
        subprocess.run([*git, "add", "-A"], env=env, check=True)  # noqa: S603
        base = seeded.sha("c3")
        names = subprocess.run(  # noqa: S603
            [*git, "diff", "--cached", "--no-renames", "--name-status", base],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        numstat = subprocess.run(  # noqa: S603
            [*git, "diff", "--cached", "--no-renames", "--numstat", base],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    counts = {}
    for line in numstat.splitlines():
        added, removed, path = line.split("\t")
        counts[path] = (
            None if added == "-" else int(added),
            None if removed == "-" else int(removed),
        )
    expected = {}
    for line in names.splitlines():
        status, path = line.split("\t")
        expected[path] = (status, *counts[path])
    assert reported == expected


# ── limits ──────────────────────────────────────────────────────────────────────────────


def test_a_full_volume_refuses_a_new_run_with_a_reason(
    tmp_path: Path, clones: CloneStore, seeded: SeededRepo
) -> None:
    store = RunWorkspaces(
        tmp_path / "runs", clones, max_bytes=64 * MB, disk_free=lambda _p: 10 * MB
    )
    with pytest.raises(WorkspaceRefusedError, match="10 MB free"):
        store.open(_spec(seeded))
    assert not (store.root / RUN).exists()


def test_a_checkout_over_the_limit_is_refused_and_leaves_nothing(
    tmp_path: Path, clones: CloneStore, seeded: SeededRepo
) -> None:
    store = RunWorkspaces(
        tmp_path / "runs", clones, max_bytes=1, disk_free=lambda _p: 1024 * MB
    )
    with pytest.raises(WorkspaceLimitError):
        store.open(_spec(seeded))
    assert not (store.root / RUN).exists()


def test_a_tree_that_grows_past_the_limit_is_refused_at_the_next_boundary(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    with store.open(_spec(seeded)) as workspace:
        store.max_bytes = workspace.size_bytes() + 1024
        (workspace.path / "big.bin").write_bytes(b"x" * 4096)
        with pytest.raises(WorkspaceLimitError, match="per-run limit"):
            workspace.changes()
        with pytest.raises(WorkspaceLimitError):
            workspace.checkpoint("implement")


# ── removal and the sweeper ─────────────────────────────────────────────────────────────


def test_finish_removes_a_terminal_runs_tree(
    store: RunWorkspaces, seeded: SeededRepo
) -> None:
    workspace = store.open(_spec(seeded))
    workspace.finish("pushed")
    assert not (store.root / RUN).exists()


def test_a_finished_run_cannot_be_reopened_before_the_sweep(
    store: RunWorkspaces, seeded: SeededRepo, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = store.open(_spec(seeded))
    monkeypatch.setattr(shutil, "rmtree", lambda *_a, **_k: None)
    workspace.finish("abandoned")
    monkeypatch.undo()
    with pytest.raises(WorkspaceConflictError, match="finished"):
        store.open(_spec(seeded))
    assert store.sweep().terminal == (RUN,)
    assert not (store.root / RUN).exists()


def test_the_sweeper_removes_orphaned_and_idle_trees_and_spares_open_ones(
    store: RunWorkspaces, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_spec(seeded)).close()
    open_one = store.open(_spec(seeded, run=OTHER_RUN))
    half_made = store.root / "0b5e1307-dead"
    (half_made / "tree").mkdir(parents=True)
    corrupt = store.root / "0b5e1307-corrupt"
    corrupt.mkdir()
    (corrupt / "run.json").write_text('{"state": "active", "touched_at": "soon"}')
    unrelated = store.root / "not a run"
    unrelated.mkdir()

    assert store.sweep().orphaned == ("0b5e1307-corrupt", "0b5e1307-dead")
    assert (store.root / RUN).exists()

    clock.now += store.idle_seconds + 1
    report = store.sweep()
    assert report.idle == (RUN,)
    assert (store.root / OTHER_RUN).exists()
    assert unrelated.exists()
    open_one.close()


def test_opening_a_new_run_sweeps_first(
    store: RunWorkspaces, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_spec(seeded)).close()
    clock.now += store.idle_seconds + 1
    store.open(_spec(seeded, run=OTHER_RUN)).close()
    assert not (store.root / RUN).exists()
