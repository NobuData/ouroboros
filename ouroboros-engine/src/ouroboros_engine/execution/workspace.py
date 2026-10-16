"""The run workspace — one writable working tree per run, confined, checkpointed, removed.

DI.1 (`#1307 <https://github.com/NobuData/ouroboros/issues/1307>`_). The clone cache (#617)
keeps bare mirrors that nothing edits; this module gives the stage that writes code a real
tree to write in::

    OURO_ENGINE_CLONE_DIR/<workspace>/<owner>__<name>.git    bare mirror, read through alternates
    OURO_ENGINE_RUN_DIR/<run>/run.json                         what the tree is for, and its state
    OURO_ENGINE_RUN_DIR/<run>/lock                             held while an engine has it open
    OURO_ENGINE_RUN_DIR/<run>/tree/                            on branch ouro/run-<run>-<issue>

* **A shared clone, not a worktree.** The tree is a repository of its own whose object store
  borrows the mirror's objects (``objects/info/alternates``, git's ``clone --shared``). Its
  branch and checkpoint commits live in the tree's own refs and objects, so a refresh of the
  mirror — which prunes every branch the remote lacks — never touches them, and the mirror is
  still written only by fetches. Nothing is copied: a run costs its checkout and its edits.
* **Never shared.** One tree per run, and an exclusive lock while it is open: two runs on one
  repository have two trees, and a second engine (or a thawed zombie) cannot open a tree that
  is in use.
* **No credential.** The token a call carries is used only by the mirror's fetch. The tree has
  no remote and its ``.git/config`` names none; DI.2 (#1310) supplies one at push time.
* **Confined.** :meth:`RunWorkspace.resolve` is
  :func:`~ouroboros_engine.execution.confine.resolve_in_tree` — the same function the tool
  policy calls.
* **Checkpointed.** :meth:`RunWorkspace.checkpoint` commits the tree on the run branch (local
  only) at each stage boundary. Opening the tree again resets it to the last checkpoint and
  drops whatever a killed stage left half-written, so a resumed stage starts from a known
  state (decision A.5 of ``docs/DECISION_EXECUTION_ENGINE.md``).
* **Reported from disk.** :meth:`RunWorkspace.changes` is the tree's own diff against the
  run's base commit — AP.1's whole change-set — so what the console shows is what is on disk.
* **Removed.** :meth:`RunWorkspace.finish` removes the tree on a terminal state, after DI.2
  has pushed or when the run is abandoned. :meth:`RunWorkspaces.sweep` removes what that
  missed: trees marked terminal, half-made trees, and trees nobody has opened for
  ``OURO_ENGINE_RUN_IDLE_HOURS``.
* **Bounded.** A tree over ``OURO_ENGINE_RUN_MAX_MB`` is refused at the next tool boundary,
  and a new run is refused while the volume has less than that limit free — a stated reason,
  not a full disk.
"""

import difflib
import fcntl
import json
import os
import re
import shutil
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Final, Literal

from dulwich import porcelain
from dulwich.diff_tree import tree_changes
from dulwich.object_store import BaseObjectStore
from dulwich.objects import Blob, Commit
from dulwich.repo import Repo

from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.control_plane.ingest import FileStatus, IngestFile
from ouroboros_engine.execution.confine import resolve_in_tree

#: A run id — ``runs.id`` — as a safe path segment: letters, digits, ``_`` and ``-``.
RUN_ID_PATTERN: Final = r"^[A-Za-z0-9_-]{1,64}$"

#: The branch every run works on, from its run id and issue number.
BRANCH_TEMPLATE: Final = "ouro/run-{run}-{issue}"

#: The identity on checkpoint commits. Local only and never pushed as such: DI.2 (#1310)
#: writes the attributed commits a pull request carries.
CHECKPOINT_IDENTITY: Final = b"Ouroboros checkpoint <checkpoint@ouroboros.invalid>"

#: The local ref holding the last attributed commit pushed to the run branch (DI.2). Outside
#: ``refs/heads/``, so nothing that lists branches — or pushes them — ever sees it.
PUBLISHED_REF: Final = b"refs/ouro/published"

#: The local ref holding the checkpoint that last attributed commit was made from: where the
#: next publish starts reading checkpoints.
PUBLISHED_CHECKPOINT_REF: Final = b"refs/ouro/published-checkpoint"

#: A checkpoint commit's message: the stage, and the attempt when a model stage made it.
_CHECKPOINT_MESSAGE = re.compile(
    r"^ouroboros checkpoint: (?P<stage>[A-Za-z0-9_.-]+)(?: attempt (?P<attempt>\d+))?\n?$"
)

#: The files beside a run's tree.
METADATA_FILE: Final = "run.json"
LOCK_FILE: Final = "lock"
TREE_DIR: Final = "tree"

#: The store-wide lock that serialises opening, finishing and sweeping trees.
STORE_LOCK: Final = ".store.lock"

#: How a run ended, for :meth:`RunWorkspace.finish`.
FinishReason = Literal["pushed", "abandoned"]

_RUN_ID = re.compile(RUN_ID_PATTERN)
_MB: Final = 1024 * 1024


class WorkspaceError(RuntimeError):
    """A run workspace could not be made, opened or used."""


class WorkspaceRefusedError(WorkspaceError):
    """A new run was refused — the volume cannot hold another tree. The message says why."""


class WorkspaceLimitError(WorkspaceError):
    """The tree has grown past the per-run size limit."""

    def __init__(self, size_bytes: int, limit_bytes: int) -> None:
        """Name the size and the limit.

        Args:
            size_bytes: The tree's size on disk, ``.git`` included.
            limit_bytes: ``OURO_ENGINE_RUN_MAX_MB``, in bytes.
        """
        super().__init__(
            f"The run's working tree is {size_bytes // _MB} MB, over the "
            f"{limit_bytes // _MB} MB per-run limit."
        )
        self.size_bytes = size_bytes
        self.limit_bytes = limit_bytes


class WorkspaceBusyError(WorkspaceError):
    """The tree is open in another engine process or another caller."""


class WorkspaceConflictError(WorkspaceError):
    """A tree exists for the run id but was made for another repository, issue or base."""


class PathEscapeError(WorkspaceError):
    """A path resolves outside the tree, or through ``.git``."""

    def __init__(self, path: str) -> None:
        """Name the refused path.

        Args:
            path: The path as it was given.
        """
        super().__init__(f"The path is outside the run's working tree: {path!r}")
        self.path = path


@dataclass(frozen=True)
class RunSpec:
    """What a run's tree is made from — the run as ``ouroboros-rest`` recorded it.

    Attributes:
        run: ``runs.id``.
        issue_number: The issue the run works on.
        base_commit: The 40-hex commit the run starts from.
        repository: The workspace's repository and this call's credential. The credential is
            used by the mirror's fetch and never reaches the tree.
    """

    run: str
    issue_number: int
    base_commit: str
    repository: RepositoryRef

    @property
    def branch(self) -> str:
        """The run's branch name.

        Returns:
            ``ouro/run-<run>-<issue>``.
        """
        return BRANCH_TEMPLATE.format(run=self.run, issue=self.issue_number)


@dataclass(frozen=True)
class CheckpointCommit:
    """One local checkpoint a publish has not yet turned into an attributed commit.

    Attributes:
        sha: The checkpoint commit.
        tree: Its tree — what the attributed commit carries.
        stage: The stage whose boundary it was.
        attempt: The attempt that made it, or ``None`` (a terminal or an abort).
        time: Its commit time, seconds since the epoch.
        timezone: Its time-zone offset, seconds.
    """

    sha: str
    tree: bytes
    stage: str
    attempt: int | None
    time: int
    timezone: int


@dataclass(frozen=True)
class SweepReport:
    """What one sweep removed, by why.

    Attributes:
        terminal: Run ids whose tree was marked terminal.
        orphaned: Run ids whose tree was half-made or unreadable.
        idle: Run ids whose tree nobody had opened within the idle limit.
    """

    terminal: tuple[str, ...] = ()
    orphaned: tuple[str, ...] = ()
    idle: tuple[str, ...] = ()


class RunWorkspaces:
    """Every run's tree under one root directory."""

    def __init__(
        self,
        root: Path,
        clones: CloneStore,
        *,
        max_bytes: int = 2048 * _MB,
        idle_seconds: float = 168 * 3600.0,
        clock: Callable[[], float] = time.time,
        disk_free: Callable[[Path], int] | None = None,
    ) -> None:
        """Configure the store. Nothing is created until a tree is first opened.

        Args:
            root: ``OURO_ENGINE_RUN_DIR``.
            clones: The clone cache whose mirrors the trees borrow objects from.
            max_bytes: ``OURO_ENGINE_RUN_MAX_MB``, in bytes — one tree's limit, and the
                free space a new run needs.
            idle_seconds: ``OURO_ENGINE_RUN_IDLE_HOURS``, in seconds — how long a tree may go
                unopened before the sweeper treats it as orphaned.
            clock: The time source, for idleness.
            disk_free: Free bytes on the volume holding a path; ``shutil.disk_usage`` unless a
                test supplies one.
        """
        self.root = root
        self.clones = clones
        self.max_bytes = max_bytes
        self.idle_seconds = idle_seconds
        self._clock = clock
        self._disk_free = disk_free or (lambda path: shutil.disk_usage(path).free)
        self._guard = threading.Lock()

    def path_of(self, run: str) -> Path:
        """Where a run's directory lives.

        Args:
            run: ``runs.id``.

        Returns:
            ``root/<run>``.

        Raises:
            WorkspaceError: The run id is not a safe path segment.
        """
        if not _RUN_ID.fullmatch(run):
            raise WorkspaceError("the run id must be letters, digits, '_' or '-'")
        return self.root / run

    def open(self, spec: RunSpec) -> "RunWorkspace":
        """The run's tree, made at its base commit on first open, else reset to its checkpoint.

        Call it on stage start; close the result at stage end. The tree is kept across
        stages and correction rounds until :meth:`RunWorkspace.finish`.

        Args:
            spec: The run.

        Returns:
            The open tree, holding the run's lock until it is closed.

        Raises:
            WorkspaceBusyError: The tree is open elsewhere.
            WorkspaceConflictError: The run's tree was made for another repository, issue or
                base commit.
            WorkspaceRefusedError: A new tree was asked for and the volume has less than the
                per-run limit free.
            WorkspaceLimitError: The base checkout alone is over the per-run limit.
            WorkspaceError: The run id, issue or base commit is malformed, or the base commit
                is not in the repository.
        """
        directory = self.path_of(spec.run)
        if spec.issue_number < 1:
            raise WorkspaceError("the issue number must be positive")
        if not re.fullmatch(r"[0-9a-f]{40}", spec.base_commit):
            raise WorkspaceError("the base commit must be a 40-hex commit id")
        with self._store_locked():
            if (directory / METADATA_FILE).exists():
                return self._reopen(spec, directory)
            self._sweep_locked()
            return self._create(spec, directory)

    def sweep(self) -> SweepReport:
        """Remove trees whose run is over or that nobody owns any more.

        A tree that is open (its lock is held) is never removed. Otherwise a tree is removed
        when it is marked terminal, when its metadata is missing or unreadable (a create that
        died), or when nobody has opened it for the idle limit.

        Returns:
            What was removed, by why.
        """
        with self._store_locked():
            return self._sweep_locked()

    def _sweep_locked(self) -> SweepReport:
        """:meth:`sweep`, with the store lock already held.

        Returns:
            What was removed, by why.
        """
        removed: dict[str, list[str]] = {"terminal": [], "orphaned": [], "idle": []}
        if not self.root.is_dir():
            return SweepReport()
        now = self._clock()
        for directory in sorted(self.root.iterdir()):
            if not directory.is_dir() or not _RUN_ID.fullmatch(directory.name):
                continue
            with _try_lock(directory / LOCK_FILE) as held:
                if not held:
                    continue
                metadata = _read_metadata(directory)
                touched = metadata.get("touched_at") if metadata else None
                if metadata is None or not isinstance(touched, int | float):
                    why = "orphaned"
                elif metadata.get("state") == "terminal":
                    why = "terminal"
                elif now - touched > self.idle_seconds:
                    why = "idle"
                else:
                    continue
                shutil.rmtree(directory, ignore_errors=True)
                removed[why].append(directory.name)
        return SweepReport(
            terminal=tuple(removed["terminal"]),
            orphaned=tuple(removed["orphaned"]),
            idle=tuple(removed["idle"]),
        )

    def _create(self, spec: RunSpec, directory: Path) -> "RunWorkspace":
        """Make the run's tree at its base commit.

        Args:
            spec: The run.
            directory: ``root/<run>``, absent.

        Returns:
            The open tree.
        """
        self.root.mkdir(parents=True, exist_ok=True)
        free = self._disk_free(self.root)
        if free < self.max_bytes:
            raise WorkspaceRefusedError(
                f"The run volume has {free // _MB} MB free and a run may need up to "
                f"{self.max_bytes // _MB} MB (OURO_ENGINE_RUN_MAX_MB); no new run starts "
                "until space is freed."
            )
        mirror = self._mirror_with(spec)
        directory.mkdir()
        handle = _lock(directory / LOCK_FILE)
        repo: Repo | None = None
        try:
            tree = directory / TREE_DIR
            Repo.init(str(tree), mkdir=True).close()
            alternates = tree / ".git" / "objects" / "info" / "alternates"
            alternates.parent.mkdir(parents=True, exist_ok=True)
            alternates.write_text(
                f"{(mirror / 'objects').resolve()}\n", encoding="utf-8"
            )
            repo = Repo(str(tree))
            branch = f"refs/heads/{spec.branch}".encode()
            repo.refs[branch] = spec.base_commit.encode()
            repo.refs.set_symbolic_ref(b"HEAD", branch)
            porcelain.reset(repo, "hard", spec.base_commit)
            workspace = RunWorkspace(
                self, spec, directory, repo, handle, restored=False
            )
            workspace.enforce_limit()
            workspace.touch()
        except BaseException:
            if repo is not None:
                repo.close()
            handle.close()
            shutil.rmtree(directory, ignore_errors=True)
            raise
        return workspace

    def _reopen(self, spec: RunSpec, directory: Path) -> "RunWorkspace":
        """Open an existing tree and put it back at its last checkpoint.

        Args:
            spec: The run.
            directory: ``root/<run>``, with metadata.

        Returns:
            The open tree, ``restored`` set.
        """
        handle = _lock_now(directory / LOCK_FILE)
        if handle is None:
            raise WorkspaceBusyError(f"run {spec.run}'s working tree is already open")
        repo: Repo | None = None
        try:
            metadata = _read_metadata(directory)
            expected = _metadata_of(spec)
            if metadata is None or any(
                metadata.get(key) != value for key, value in expected.items()
            ):
                raise WorkspaceConflictError(
                    f"run {spec.run}'s working tree was made for another repository, issue "
                    "or base commit"
                )
            if metadata.get("state") == "terminal":
                raise WorkspaceConflictError(f"run {spec.run} has already finished")
            repo = Repo(str(directory / TREE_DIR))
            tree = str(directory / TREE_DIR)
            porcelain.clean(repo, tree)
            porcelain.reset(repo, "hard", "HEAD")
            workspace = RunWorkspace(self, spec, directory, repo, handle, restored=True)
            workspace.touch()
        except BaseException:
            if repo is not None:
                repo.close()
            handle.close()
            raise
        return workspace

    def _mirror_with(self, spec: RunSpec) -> Path:
        """The mirror's path, fetched first when it lacks the base commit.

        Args:
            spec: The run.

        Returns:
            The bare mirror's directory.

        Raises:
            WorkspaceError: The repository has no such commit even after a fetch.
        """
        for force in (False, True):
            opened = self.clones.open(spec.repository, force=force)
            try:
                found = _has_commit(opened.repo.store, spec.base_commit)
            finally:
                opened.repo.close()
            if found:
                return self.clones.path_of(spec.repository)
            if opened.fetched:
                break
        raise WorkspaceError(f"the repository has no commit {spec.base_commit}")

    @contextmanager
    def _store_locked(self) -> Iterator[None]:
        """Hold the store lock — in this process, and across processes.

        Yields:
            Nothing; the lock is held for the ``with`` body.
        """
        with self._guard:
            self.root.mkdir(parents=True, exist_ok=True)
            handle = _lock(self.root / STORE_LOCK)
            try:
                yield
            finally:
                handle.close()


class RunWorkspace:
    """One run's open working tree. Close it at stage end; :meth:`finish` it at run end."""

    def __init__(
        self,
        store: RunWorkspaces,
        spec: RunSpec,
        directory: Path,
        repo: Repo,
        lock: IO[str],
        *,
        restored: bool,
    ) -> None:
        """Wrap an open tree. Made by :meth:`RunWorkspaces.open` only.

        Args:
            store: The store it belongs to.
            spec: The run.
            directory: ``root/<run>``.
            repo: The tree's repository.
            lock: The run's lock file, held.
            restored: ``True`` when the tree existed and was reset to its last checkpoint.
        """
        self.spec = spec
        self.directory = directory
        self.path = directory / TREE_DIR
        self.restored = restored
        self._store = store
        self._repo = repo
        self._lock: IO[str] | None = lock

    def __enter__(self) -> "RunWorkspace":
        """Use as a context manager that closes on exit.

        Returns:
            Itself.
        """
        return self

    def __exit__(self, *_exc: object) -> None:
        """Close the tree, keeping it on disk."""
        self.close()

    @property
    def head(self) -> str:
        """The last checkpoint — the run branch's tip.

        Returns:
            A 40-hex commit id; the base commit before the first checkpoint.
        """
        return self._repo.refs[b"HEAD"].decode("ascii")

    def resolve(self, path: str) -> str:
        """The tree-relative form of a path a tool was given, or a refusal.

        Args:
            path: Absolute, or relative to the tree.

        Returns:
            The relative path with forward slashes.

        Raises:
            PathEscapeError: The path resolves outside the tree or through ``.git``.
        """
        relative = resolve_in_tree(self.path, path)
        if relative is None:
            raise PathEscapeError(path)
        return relative

    def changes(self) -> list[IngestFile]:
        """The tree's diff against the run's base commit — AP.1's whole change-set.

        Call it at every tool boundary. Untracked files count and ignored files do not, as in
        ``git add -A && git diff --cached <base>``. Line counts are ``None`` for a binary file.

        Returns:
            One file per changed path, sorted by path.

        Raises:
            WorkspaceLimitError: The tree is over the per-run limit.
        """
        self.enforce_limit()
        tree_id = self._stage_all()
        base_tree = self._commit(self.spec.base_commit.encode()).tree
        files: list[IngestFile] = []
        for change in tree_changes(self._repo.object_store, base_tree, tree_id):
            if change.old is None and change.new is not None:
                status: FileStatus = "added"
                path = change.new.path
            elif change.new is None and change.old is not None:
                status = "deleted"
                path = change.old.path
            elif change.new is not None and change.old is not None:
                status = "modified"
                path = change.new.path
            else:  # pragma: no cover — tree_changes never yields an empty change
                continue
            old = self._blob(change.old.sha if change.old else None)
            new = self._blob(change.new.sha if change.new else None)
            additions, deletions = _line_counts(old, new)
            files.append(
                IngestFile(
                    path=path.decode("utf-8", "surrogateescape"),
                    status=status,
                    additions=additions,
                    deletions=deletions,
                )
            )
        self.touch()
        return sorted(files, key=lambda file: file.path)

    def checkpoint(self, stage_key: str, attempt: int | None = None) -> str:
        """Commit the tree on the run branch, locally, at a stage boundary.

        A stage that changed nothing since the last checkpoint makes no commit.

        Args:
            stage_key: The stage whose boundary this is, for the commit message.
            attempt: The attempt that ended, for a model stage — DI.2 (#1310) writes one
                attributed commit per checkpoint and names the attempt in it.

        Returns:
            The checkpoint commit id — the branch tip after the call.

        Raises:
            WorkspaceLimitError: The tree is over the per-run limit.
        """
        self.enforce_limit()
        tree_id = self._stage_all()
        if self._commit(self._repo.refs[b"HEAD"]).tree != tree_id:
            self._repo.get_worktree().commit(
                message=(
                    f"ouroboros checkpoint: {stage_key}"
                    + ("" if attempt is None else f" attempt {attempt}")
                ).encode(),
                author=CHECKPOINT_IDENTITY,
                committer=CHECKPOINT_IDENTITY,
            )
        self.touch()
        return self.head

    @property
    def git(self) -> Repo:
        """The tree's repository, for the branch publisher (DI.2) to write and push through.

        Returns:
            The open repository. Its config names no remote and never will: a push is told
            where to go per call.
        """
        return self._repo

    def published(self) -> str | None:
        """The last attributed commit pushed to the run branch.

        Returns:
            Its 40-hex id, or ``None`` before the first push.
        """
        found = self._repo.refs.as_dict().get(PUBLISHED_REF)
        return None if found is None else found.decode("ascii")

    def unpublished_checkpoints(self) -> list[CheckpointCommit]:
        """The checkpoints made since the last push, oldest first.

        Walks the run branch back from its tip to the checkpoint the last publish read up to
        — or to the base commit before the first. A checkpoint is recognised by its message;
        anything else on the branch (there is nothing else) would be skipped, not published.

        Returns:
            Each checkpoint, with the stage and attempt its message names.
        """
        refs = self._repo.refs.as_dict()
        stop = refs.get(PUBLISHED_CHECKPOINT_REF) or self.spec.base_commit.encode()
        found: list[CheckpointCommit] = []
        current = self._repo.refs[b"HEAD"]
        seen: set[bytes] = set()
        while current != stop and current not in seen:
            seen.add(current)
            commit = self._commit(current)
            matched = _CHECKPOINT_MESSAGE.match(
                commit.message.decode("utf-8", "replace")
            )
            if matched is not None:
                attempt = matched.group("attempt")
                found.append(
                    CheckpointCommit(
                        sha=current.decode("ascii"),
                        tree=commit.tree,
                        stage=matched.group("stage"),
                        attempt=None if attempt is None else int(attempt),
                        time=commit.commit_time,
                        timezone=commit.commit_timezone,
                    )
                )
            if not commit.parents:
                break
            current = commit.parents[0]
        return list(reversed(found))

    def mark_published(self, attributed: str, checkpoint: str) -> None:
        """Record a successful push: the next publish starts after ``checkpoint``.

        Args:
            attributed: The attributed commit now at the run branch's tip on the host.
            checkpoint: The checkpoint it was made from.
        """
        self._repo.refs[PUBLISHED_REF] = attributed.encode("ascii")
        self._repo.refs[PUBLISHED_CHECKPOINT_REF] = checkpoint.encode("ascii")

    def size_bytes(self) -> int:
        """The tree's size on disk, ``.git`` included; symbolic links are not followed.

        Returns:
            Bytes.
        """
        total = 0
        for folder, _dirs, names in os.walk(self.path):
            for name in names:
                with suppress(OSError):
                    total += (Path(folder) / name).lstat().st_size
        return total

    def enforce_limit(self) -> None:
        """Refuse a tree over the per-run limit.

        Raises:
            WorkspaceLimitError: It is over.
        """
        size = self.size_bytes()
        if size > self._store.max_bytes:
            raise WorkspaceLimitError(size, self._store.max_bytes)

    def touch(self) -> None:
        """Record that the tree is in use, so the sweeper does not treat it as idle."""
        metadata = _metadata_of(self.spec)
        metadata.update(state="active", touched_at=self._store._clock())
        _write_metadata(self.directory, metadata)

    def close(self) -> None:
        """Release the run's lock, keeping the tree for the next stage."""
        self._repo.close()
        if self._lock is not None:
            self._lock.close()
            self._lock = None

    def finish(self, reason: FinishReason) -> None:
        """Remove the tree: the run reached a terminal state.

        Call it after DI.2 (#1310) has pushed the branch (``pushed``), or when the run is
        abandoned. The tree is marked terminal first, so a removal that fails part-way is
        finished by the next sweep.

        Args:
            reason: Why the run's tree is no longer needed.
        """
        metadata = _metadata_of(self.spec)
        metadata.update(
            state="terminal", finished=reason, touched_at=self._store._clock()
        )
        _write_metadata(self.directory, metadata)
        self.close()
        with (
            self._store._store_locked(),
            _try_lock(self.directory / LOCK_FILE) as held,
        ):
            if held:
                shutil.rmtree(self.directory, ignore_errors=True)

    def _stage_all(self) -> bytes:
        """Stage every change in the tree, deletions and untracked files included.

        Returns:
            The id of the tree object the index now describes.
        """
        status = porcelain.status(self._repo, untracked_files="all")
        paths = [
            path.decode("utf-8", "surrogateescape") if isinstance(path, bytes) else path
            for path in [*status.unstaged, *status.untracked]
        ]
        if paths:
            self._repo.get_worktree().stage(paths)
        return self._repo.open_index().commit(self._repo.object_store)

    def _commit(self, sha: bytes) -> Commit:
        """A commit object.

        Args:
            sha: Its id.

        Returns:
            The commit.
        """
        commit = self._repo[sha]
        assert isinstance(commit, Commit)  # noqa: S101 — refs here only ever name commits
        return commit

    def _blob(self, sha: bytes | None) -> bytes | None:
        """A blob's content, or ``None`` for no blob (a submodule or one side of add/delete).

        Args:
            sha: The blob id, or ``None``.

        Returns:
            Its bytes, or ``None``.
        """
        if sha is None:
            return None
        found = self._repo.object_store[sha]
        return found.as_raw_string() if isinstance(found, Blob) else None


def _line_counts(old: bytes | None, new: bytes | None) -> tuple[int | None, int | None]:
    """Lines added and removed between two versions of a file, as ``git diff --numstat``.

    Args:
        old: The base content, or ``None`` when the file was added.
        new: The tree's content, or ``None`` when it was deleted.

    Returns:
        ``(additions, deletions)``; ``(None, None)`` when either side is binary.
    """
    if (old is not None and b"\x00" in old) or (new is not None and b"\x00" in new):
        return None, None
    before = (old or b"").splitlines(keepends=True)
    after = (new or b"").splitlines(keepends=True)
    additions = deletions = 0
    matcher = difflib.SequenceMatcher(None, before, after, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            deletions += i2 - i1
            additions += j2 - j1
    return additions, deletions


def _has_commit(store: BaseObjectStore, sha: str) -> bool:
    """Whether an object store holds a commit.

    Args:
        store: The mirror's object store.
        sha: The 40-hex id.

    Returns:
        ``True`` when it is there and is a commit.
    """
    try:
        found = store[sha.encode()]
    except KeyError:
        return False
    return isinstance(found, Commit)


def _metadata_of(spec: RunSpec) -> dict[str, object]:
    """The fields that say what a tree was made for. Never the credential.

    Args:
        spec: The run.

    Returns:
        ``run``, ``issue_number``, ``base_commit``, ``workspace``, ``slug``, ``branch``.
    """
    return {
        "run": spec.run,
        "issue_number": spec.issue_number,
        "base_commit": spec.base_commit,
        "workspace": spec.repository.workspace,
        "slug": spec.repository.slug,
        "branch": spec.branch,
    }


def _read_metadata(directory: Path) -> dict[str, object] | None:
    """A tree's metadata, or ``None`` when it is missing or unreadable.

    Args:
        directory: ``root/<run>``.

    Returns:
        The decoded object, or ``None``.
    """
    try:
        loaded = json.loads((directory / METADATA_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return loaded if isinstance(loaded, dict) else None


def _write_metadata(directory: Path, metadata: dict[str, object]) -> None:
    """Write a tree's metadata atomically — a crash leaves the old file or the new one.

    Args:
        directory: ``root/<run>``.
        metadata: What to write.
    """
    staging = directory / f"{METADATA_FILE}.tmp"
    staging.write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
    staging.replace(directory / METADATA_FILE)


def _lock(path: Path) -> IO[str]:
    """Open and ``flock`` a lock file exclusively, waiting for it.

    Args:
        path: The lock file; created when absent.

    Returns:
        The open handle holding the lock — closing it releases the lock.
    """
    handle = path.open("a", encoding="utf-8")
    fcntl.flock(handle, fcntl.LOCK_EX)
    return handle


def _lock_now(path: Path) -> IO[str] | None:
    """Open and ``flock`` a lock file exclusively, or give up at once.

    Args:
        path: The lock file; created when absent.

    Returns:
        The open handle holding the lock, or ``None`` when another holder has it.
    """
    handle = path.open("a", encoding="utf-8")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    return handle


@contextmanager
def _try_lock(path: Path) -> Iterator[bool]:
    """Hold a lock file for the ``with`` body if nobody else holds it.

    Args:
        path: The lock file.

    Yields:
        ``True`` when the lock is held, ``False`` when another holder has it.
    """
    handle = _lock_now(path)
    try:
        yield handle is not None
    finally:
        if handle is not None:
            handle.close()
