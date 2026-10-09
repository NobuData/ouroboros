"""A read-only view of one clone — the only thing a mining operation is handed.

**No operation writes to a repository** (#617). The clone cache
(:mod:`ouroboros_engine.code.clones`) is the one module that creates and refreshes clones; it
opens a :class:`ReadOnlyRepo` over the result and hands *that* to
:mod:`~ouroboros_engine.code.mining` and :mod:`~ouroboros_engine.code.deps`. The view offers
lookups — resolve a ref, read a commit, a tree path, a blob — and nothing that adds an object or
moves a ref. ``tests/test_code_readonly.py`` holds the operation modules to that structurally
(they import no dulwich module that writes and call no writing method) and behaviourally (a
clone's bytes are identical before and after every operation).

Refs are resolved by name only: a full or abbreviated hex id, a branch, a tag, or ``HEAD``.
Revision syntax (``main~3``, ``v1..v2``, ``@{yesterday}``) is refused — a citation names a
commit, and an expression whose answer moves is not one.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass

from dulwich.errors import NotTreeError
from dulwich.object_store import (
    BaseObjectStore,
    iter_tree_contents,
    peel_sha,
    tree_lookup_path,
)
from dulwich.objects import Blob, Commit, ShaFile, Tree, TreeEntry
from dulwich.repo import Repo

#: A ref a caller may name: a hex id, a branch or tag name, or ``HEAD``. No revision syntax,
#: no leading ``-`` (an option, to anything that shells out) and no ``..`` (a range).
REF_PATTERN = r"^(?![-/.])(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]{1,255}(?<![/.])$"

#: A repository-relative path: segments of the citation locator's alphabet, no ``.``/``..``.
PATH_PATTERN = r"^(?!.*(^|/)\.\.?(/|$))[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$"

_REF = re.compile(REF_PATTERN)
_PATH = re.compile(PATH_PATTERN)
_HEX = re.compile(r"^[0-9a-f]{4,40}$")


class RefNotFoundError(LookupError):
    """A ref names no commit in the clone (or names several, abbreviated)."""

    def __init__(self, ref: str, reason: str = "names no commit") -> None:
        """Record which ref and why.

        Args:
            ref: The ref as the caller wrote it.
            reason: What was wrong — ``names no commit`` or ``is ambiguous``.
        """
        super().__init__(f"{ref} {reason}")
        self.ref = ref
        self.reason = reason


class PathNotFoundError(LookupError):
    """A path is not in the tree of the commit it was asked of."""

    def __init__(self, path: str, sha: str, kind: str = "file") -> None:
        """Record which path, at which commit.

        Args:
            path: The repository-relative path.
            sha: The commit it was looked up at.
            kind: ``file`` or ``directory`` — what the caller needed it to be.
        """
        super().__init__(f"no {kind} {path} at {sha[:12]}")
        self.path = path
        self.sha = sha
        self.kind = kind


@dataclass(frozen=True)
class CommitFacts:
    """What a citation says about one commit.

    Attributes:
        sha: The 40-hex id.
        committed_at: Unix seconds, the committer date — what "last changed" means.
        author: The author's name (never the address).
        summary: The message's first line, at most 200 characters.
    """

    sha: str
    committed_at: int
    author: str
    summary: str


def valid_ref(ref: str) -> bool:
    """Whether a ref is one :meth:`ReadOnlyRepo.resolve` would try.

    Args:
        ref: The candidate.

    Returns:
        ``True`` for a name in :data:`REF_PATTERN`'s alphabet.
    """
    return _REF.fullmatch(ref) is not None


def valid_path(path: str) -> bool:
    """Whether a path is a repository-relative path a locator can carry.

    Args:
        path: The candidate.

    Returns:
        ``True`` for :data:`PATH_PATTERN`.
    """
    return _PATH.fullmatch(path) is not None


def facts_of(commit: Commit) -> CommitFacts:
    """The citable facts of a commit.

    Args:
        commit: The commit.

    Returns:
        Its :class:`CommitFacts`.
    """
    name = commit.author.decode("utf-8", "replace")
    if "<" in name:
        name = name.split("<", 1)[0].strip()
    message = commit.message.decode("utf-8", "replace").strip()
    summary = message.splitlines()[0] if message else ""
    return CommitFacts(
        sha=commit.id.decode("ascii"),
        committed_at=int(commit.commit_time),
        author=name or "unknown",
        summary=summary[:200],
    )


class ReadOnlyRepo:
    """Lookups over one clone — and nothing else.

    The underlying store is reachable as :attr:`store` because dulwich's own read functions
    (``annotate_lines``, ``tree_changes``, the walker) take one; the operation modules pass it
    to those and to nothing that writes, which the structural test asserts.
    """

    def __init__(self, repo: Repo) -> None:
        """Wrap an opened clone.

        Args:
            repo: The bare clone, opened by :mod:`ouroboros_engine.code.clones`.
        """
        self._repo = repo

    def close(self) -> None:
        """Release the clone's open pack files."""
        self._repo.close()

    @property
    def store(self) -> BaseObjectStore:
        """The object store, for dulwich's read functions.

        Returns:
            The clone's object store.
        """
        return self._repo.object_store

    def resolve(self, ref: str) -> str:
        """The commit a ref names.

        Args:
            ref: A hex id (4 to 40), a branch, a tag, ``refs/…`` or ``HEAD``.

        Returns:
            The 40-hex commit id — an annotated tag peeled to its commit.

        Raises:
            RefNotFoundError: The ref is malformed, names nothing, names something that is not
                a commit, or is an ambiguous abbreviation.
        """
        if not valid_ref(ref):
            raise RefNotFoundError(ref, "is not a ref name")
        candidate = self._by_name(ref)
        if candidate is None and _HEX.fullmatch(ref):
            candidate = self._by_prefix(ref)
        if candidate is None:
            raise RefNotFoundError(ref)
        try:
            _, peeled = peel_sha(self.store, candidate)
        except KeyError as error:
            raise RefNotFoundError(ref) from error
        if not isinstance(peeled, Commit):
            raise RefNotFoundError(ref, "does not name a commit")
        return peeled.id.decode("ascii")

    def full_name(self, ref: str) -> str | None:
        """The ref a name resolves through — what a build can fetch.

        Args:
            ref: A name as :meth:`resolve` takes it.

        Returns:
            ``refs/tags/…``, ``refs/heads/…`` or ``refs/…`` when the name is a ref; ``None``
            for a commit id.
        """
        if not valid_ref(ref):
            return None
        names = [ref] if ref.startswith("refs/") else []
        names += [f"refs/tags/{ref}", f"refs/heads/{ref}"]
        return next((name for name in names if name.encode() in self._repo.refs), None)

    def _by_name(self, ref: str) -> bytes | None:
        """A ref looked up by name, in git's order.

        Args:
            ref: The name.

        Returns:
            The object id it points at, or ``None``.
        """
        refs = self._repo.refs
        names = [ref] if ref.startswith("refs/") or ref == "HEAD" else []
        names += [f"refs/tags/{ref}", f"refs/heads/{ref}"]
        for name in names:
            try:
                return refs[name.encode()]
            except KeyError:
                continue
        if re.fullmatch(r"[0-9a-f]{40}", ref) and ref.encode() in self.store:
            return ref.encode()
        return None

    def _by_prefix(self, prefix: str) -> bytes | None:
        """An abbreviated id expanded, when exactly one commit-ish object has it.

        Args:
            prefix: 4 to 39 hex digits.

        Returns:
            The full id, or ``None`` when nothing matches.

        Raises:
            RefNotFoundError: Several objects match.
        """
        matches = list(self.store.iter_prefix(prefix.encode()))
        if len(matches) > 1:
            raise RefNotFoundError(prefix, "is ambiguous")
        return matches[0] if matches else None

    def commit(self, sha: str) -> Commit:
        """A commit by id.

        Args:
            sha: The 40-hex id.

        Returns:
            The commit.

        Raises:
            RefNotFoundError: Nothing with that id is a commit.
        """
        found = self._object(sha.encode())
        if not isinstance(found, Commit):
            raise RefNotFoundError(sha)
        return found

    def _object(self, sha: bytes) -> ShaFile | None:
        """Any object by id.

        Args:
            sha: The 40-hex id.

        Returns:
            The object, or ``None``.
        """
        try:
            return self.store[sha]
        except KeyError:
            return None

    def entry(self, sha: str, path: str) -> tuple[int, bytes] | None:
        """The tree entry at a path in a commit.

        Args:
            sha: The commit.
            path: Repository-relative; ``""`` is the root tree.

        Returns:
            ``(mode, object id)``, or ``None`` when there is nothing there.
        """
        tree = self.commit(sha).tree
        if path == "":
            return (0o040000, tree)
        try:
            return tree_lookup_path(self.store.__getitem__, tree, path.encode())
        except (KeyError, NotTreeError):
            return None

    def blob(self, sha: str, path: str) -> bytes:
        """A file's bytes at a commit.

        Args:
            sha: The commit.
            path: The file.

        Returns:
            Its content.

        Raises:
            PathNotFoundError: There is no file at that path.
        """
        found = self.entry(sha, path)
        target = self._object(found[1]) if found else None
        if not isinstance(target, Blob):
            raise PathNotFoundError(path, sha)
        return target.as_raw_string()

    def blob_by_id(self, blob_id: bytes) -> bytes | None:
        """A blob's bytes by object id.

        Args:
            blob_id: The blob's id.

        Returns:
            Its content, or ``None`` when the id is not a blob.
        """
        found = self._object(blob_id)
        return found.as_raw_string() if isinstance(found, Blob) else None

    def files_under(self, sha: str, directory: str) -> Iterator[tuple[str, bytes]]:
        """Every file below a directory at a commit.

        Args:
            sha: The commit.
            directory: Repository-relative; ``""`` for the whole tree.

        Yields:
            ``(path, blob id)`` for each file, in tree order. Submodules are skipped.

        Raises:
            PathNotFoundError: The directory is not a directory at that commit.
        """
        found = self.entry(sha, directory)
        tree = self._object(found[1]) if found else None
        if not isinstance(tree, Tree):
            raise PathNotFoundError(directory, sha, "directory")
        prefix = f"{directory}/" if directory else ""
        for item in iter_tree_contents(self.store, tree.id):
            if not isinstance(item, TreeEntry) or item.mode is None:
                continue
            if (item.mode & 0o170000) != 0o100000:  # regular files only
                continue
            yield prefix + item.path.decode("utf-8", "replace"), item.sha
