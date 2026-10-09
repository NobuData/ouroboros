"""The clone cache — bare mirrors of the workspace's repositories, kept with the engine.

One clone per **workspace and repository**, at
``OURO_ENGINE_CLONE_DIR/<workspace id>/<owner>__<name>.git``: two workspaces that both
enable ``acme/helios-firmware`` read through their own credential into their own clone, so one
workspace's access never answers for another's.

* **Bare.** A clone has no working tree. Nothing checks out, nothing edits; an operation reads
  objects (:class:`~ouroboros_engine.code.repo.ReadOnlyRepo`).
* **Fetched, never pushed.** This module is the only one that writes into a clone — the objects
  and the ``refs/heads/*`` / ``refs/tags/*`` a fetch brings — and it writes nothing anywhere
  else. No remote is configured in the clone and no credential is written to it: the token
  ``ouroboros-rest`` sends with a call is used for that call's fetch and dropped.
* **Refreshed when stale.** A clone fetched within ``OURO_ENGINE_CLONE_REFRESH_SECONDS`` is
  read as it is; an older one is fetched first; a ref the clone does not have yet forces one
  fetch. When a refresh fails and a clone exists, the clone is read as it was — every answer
  names the commit it was read at, so a stale read is still an exact one.
* **Serialised.** One fetch at a time per clone, across threads (a lock) and processes (an
  advisory lock file beside it).

Only ``https://`` remotes are accepted by the route; tests open a store with
``allow_local=True`` to read fixture repositories from a path.
"""

import fcntl
import re
import shutil
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dulwich.client import (
    FetchPackResult,
    GitClient,
    HttpGitClient,
    HTTPProxyUnauthorized,
    HTTPUnauthorized,
    get_transport_and_path,
)
from dulwich.repo import Repo

from ouroboros_engine.code.repo import ReadOnlyRepo

#: ``owner/name`` — GitHub's alphabet, the locator's too.
SLUG_PATTERN = r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"

#: A workspace id — ``ouroboros-rest``'s organization id, the directory a workspace's clones
#: live under. A safe path segment: letters, digits, ``_`` and ``-``, and never ``.``/``..``.
WORKSPACE_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"

#: The user name GitHub expects beside a token over HTTPS.
TOKEN_USERNAME = "x-access-token"  # noqa: S105 — a fixed user name, not a secret

#: The file whose mtime is the clone's last successful fetch.
FETCHED_STAMP = "OURO_FETCHED"

_SLUG = re.compile(SLUG_PATTERN)
_WORKSPACE = re.compile(WORKSPACE_PATTERN)
_MIRRORED = (b"refs/heads/", b"refs/tags/")


class CloneError(RuntimeError):
    """A clone could not be made or refreshed."""


class RemoteAuthError(CloneError):
    """The remote refused the credential (``401``/``403``)."""


class RemoteUnreachableError(CloneError):
    """The remote could not be read — a network failure, a ``404``, a protocol error."""


class RemoteRefusedError(CloneError):
    """The remote is not one this store reads from (not ``https://``, or carries userinfo)."""


@dataclass(frozen=True)
class RepositoryRef:
    """Which repository, for which workspace, from where, with what.

    Attributes:
        workspace: The workspace's uuid — the clone's directory.
        slug: ``owner/name``.
        remote: The fetch URL — ``https://github.com/owner/name.git``.
        token: The credential for this call, or ``None`` for a public remote. Never stored.
    """

    workspace: str
    slug: str
    remote: str
    token: str | None = None

    def __repr__(self) -> str:
        """A representation that never prints the token.

        Returns:
            The ref without its credential.
        """
        held = "set" if self.token else "none"
        return (
            f"RepositoryRef({self.workspace}, {self.slug}, {self.remote}, token={held})"
        )


@dataclass(frozen=True)
class OpenedClone:
    """A clone ready to read.

    Attributes:
        repo: The read-only view.
        fetched_at: Unix seconds of the last successful fetch.
        stale: ``True`` when a refresh was due and failed, so the clone was read as it was.
        fetched: ``True`` when this open fetched — a ref still missing will not appear by
            fetching again.
    """

    repo: ReadOnlyRepo
    fetched_at: float
    stale: bool
    fetched: bool


class CloneStore:
    """Bare clones under one root directory."""

    def __init__(
        self,
        root: Path,
        *,
        refresh_seconds: float = 300.0,
        timeout_seconds: float = 120.0,
        allow_local: bool = False,
        clock: Callable[[], float] = time.time,
    ) -> None:
        """Configure the store. Nothing is created until a clone is first opened.

        Args:
            root: ``OURO_ENGINE_CLONE_DIR``.
            refresh_seconds: How long a fetch stays fresh.
            timeout_seconds: The socket timeout of one fetch.
            allow_local: Accept a filesystem path as a remote — tests only.
            clock: The time source, for freshness.
        """
        self.root = root
        self.refresh_seconds = refresh_seconds
        self.timeout_seconds = timeout_seconds
        self.allow_local = allow_local
        self._clock = clock
        self._locks: dict[Path, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def path_of(self, repository: RepositoryRef) -> Path:
        """Where a repository's clone lives.

        Args:
            repository: The repository.

        Returns:
            ``root/<workspace>/<owner>__<name>.git``.

        Raises:
            RemoteRefusedError: The workspace or slug is malformed.
        """
        if not _WORKSPACE.fullmatch(repository.workspace):
            raise RemoteRefusedError("the workspace must be an organization id")
        if not _SLUG.fullmatch(repository.slug) or ".." in repository.slug:
            raise RemoteRefusedError("the repository must be owner/name")
        owner, name = repository.slug.split("/")
        return self.root / repository.workspace / f"{owner}__{name}.git"

    def open(self, repository: RepositoryRef, *, force: bool = False) -> OpenedClone:
        """A clone to read, made or refreshed first when it needs to be.

        Args:
            repository: The repository and this call's credential.
            force: Fetch even when the clone is fresh — a ref it did not have was asked for.

        Returns:
            The opened clone.

        Raises:
            RemoteRefusedError: The remote is not an accepted URL.
            RemoteAuthError: The first fetch was refused the credential.
            RemoteUnreachableError: The first fetch failed otherwise.
        """
        self._check_remote(repository.remote)
        path = self.path_of(repository)
        with self._locked(path):
            if not (path / FETCHED_STAMP).exists():
                self._first_clone(repository, path)
                return OpenedClone(
                    ReadOnlyRepo(Repo(str(path))), self._stamp(path), False, True
                )
            fetched_at = self._stamp(path)
            stale = fetched = False
            if force or self._clock() - fetched_at >= self.refresh_seconds:
                try:
                    self._fetch_into(repository, path)
                    fetched_at = self._stamp(path)
                    fetched = True
                except CloneError:
                    stale = True
            return OpenedClone(
                ReadOnlyRepo(Repo(str(path))), fetched_at, stale, fetched
            )

    def _first_clone(self, repository: RepositoryRef, path: Path) -> None:
        """Make a clone, removing what was made when the fetch fails.

        Args:
            repository: The repository.
            path: Where it goes.

        Raises:
            CloneError: The fetch failed; nothing is left behind.
        """
        if path.exists():
            shutil.rmtree(path)  # a clone whose first fetch never finished
        path.parent.mkdir(parents=True, exist_ok=True)
        Repo.init_bare(str(path), mkdir=True)
        try:
            self._fetch_into(repository, path)
        except BaseException:
            shutil.rmtree(path, ignore_errors=True)
            raise

    def _fetch_into(self, repository: RepositoryRef, path: Path) -> None:
        """Fetch branches and tags and mirror them into the clone's refs.

        Args:
            repository: The repository and its credential.
            path: The clone.

        Raises:
            RemoteAuthError: The credential was refused.
            RemoteUnreachableError: Anything else went wrong on the way.
        """
        with Repo(str(path)) as repo:
            client, remote_path = self._client(repository)
            try:
                result: FetchPackResult = client.fetch(
                    remote_path, repo, determine_wants=_wanted
                )
            except (HTTPUnauthorized, HTTPProxyUnauthorized) as error:
                raise RemoteAuthError("the remote refused the credential") from error
            except Exception as error:
                if _status_of(error) in {401, 403}:
                    raise RemoteAuthError(
                        "the remote refused the credential"
                    ) from error
                raise RemoteUnreachableError("the remote could not be read") from error
            _mirror_refs(repo, result.refs, result.symrefs)
        (path / FETCHED_STAMP).write_text(f"{self._clock():.0f}\n", encoding="ascii")

    def _client(self, repository: RepositoryRef) -> tuple[GitClient, str]:
        """The transport for a remote.

        Args:
            repository: The repository and its credential.

        Returns:
            The client and the path to fetch from it.
        """
        if repository.remote.startswith("https://"):
            parts = urlsplit(repository.remote)
            client = HttpGitClient(
                f"https://{parts.netloc}",
                username=TOKEN_USERNAME if repository.token else None,
                password=repository.token,
                timeout=self.timeout_seconds,
                quiet=True,
            )
            return client, parts.path
        return get_transport_and_path(repository.remote, quiet=True)

    def _check_remote(self, remote: str) -> None:
        """Refuse a remote this store does not read from.

        Args:
            remote: The fetch URL.

        Raises:
            RemoteRefusedError: Not ``https://`` (or, with ``allow_local``, an existing local
                path), or credentials written into the URL.
        """
        if remote.startswith("https://"):
            parts = urlsplit(remote)
            if parts.username or parts.password or not parts.hostname:
                raise RemoteRefusedError("the remote must be https://host/owner/name")
            return
        if self.allow_local and Path(remote).is_dir():
            return
        raise RemoteRefusedError("the remote must be https://host/owner/name")

    def _stamp(self, path: Path) -> float:
        """When the clone was last fetched.

        Args:
            path: The clone.

        Returns:
            Unix seconds; ``0`` when it never was.
        """
        try:
            return float((path / FETCHED_STAMP).read_text(encoding="ascii").strip())
        except (OSError, ValueError):
            return 0.0

    @contextmanager
    def _locked(self, path: Path) -> Iterator[None]:
        """Hold the clone's lock — in this process, and across processes.

        Args:
            path: The clone.

        Yields:
            Nothing; the lock is held for the ``with`` body.
        """
        with self._locks_guard:
            lock = self._locks.setdefault(path, threading.Lock())
        with lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            lock_file = path.parent / f"{path.name}.lock"
            with lock_file.open("a") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(handle, fcntl.LOCK_UN)


def _wanted(refs: Mapping[bytes, bytes], depth: int | None = None) -> list[bytes]:
    """Which advertised objects to fetch: branch and tag tips, nothing else.

    Args:
        refs: What the remote advertised.
        depth: Unused — clones are never shallow.

    Returns:
        The ids of every branch and tag (``refs/pull/*`` and the like are left on the remote).
    """
    del depth
    return sorted(
        {
            sha
            for name, sha in refs.items()
            if name.startswith(_MIRRORED) and not name.endswith(b"^{}")
        }
    )


def _mirror_refs(
    repo: Repo, advertised: Mapping[bytes, bytes], symrefs: Mapping[bytes, bytes]
) -> None:
    """Make the clone's branches and tags the remote's.

    Args:
        repo: The clone.
        advertised: The remote's refs, as fetched.
        symrefs: The remote's symbolic refs — ``HEAD`` among them.
    """
    wanted = {
        name: sha
        for name, sha in advertised.items()
        if name.startswith(_MIRRORED) and not name.endswith(b"^{}") and sha
    }
    for name in list(repo.refs.keys()):
        if name.startswith(_MIRRORED) and name not in wanted:
            del repo.refs[name]
    for name, sha in wanted.items():
        repo.refs[name] = sha
    head = symrefs.get(b"HEAD")
    if head is not None and head in wanted:
        repo.refs.set_symbolic_ref(b"HEAD", head)


def _status_of(error: BaseException) -> int | None:
    """The HTTP status a dulwich protocol error reports in its message, if any.

    Args:
        error: What the fetch raised.

    Returns:
        The status, or ``None``.
    """
    match = re.search(r"\b(4\d\d|5\d\d)\b", str(error))
    return int(match.group(1)) if match else None
