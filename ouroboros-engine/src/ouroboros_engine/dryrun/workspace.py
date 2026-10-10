"""The virtual workspace: real reads at a pinned commit, writes that land nowhere (CD.2, #560).

Two halves, and the line between them is the guarantee.

**Reads are real.** A :class:`RepositoryReader` resolves the tree and each file *lazily* from
the git host at the dry run's pinned commit — a dry run touches a handful of files, so nothing
is cloned. Every answer is kept in a :class:`ReadCache` keyed by repository and commit: a
commit never changes, so a second read of the same file, in this run or the next, is not a
second request.

**Writes are not.** ``write`` and ``delete`` change an in-memory **overlay** and nothing else.
Later reads go *through* the overlay, which is what makes ``implement`` → ``review`` a chain:
the reviewer reads the file as the implementer left it. The overlay is also the artifact —
:meth:`VirtualWorkspace.diff` renders it as a unified diff.

**The overlay cannot be flushed, by construction.** :class:`RepositoryReader` has two methods
and both read; :class:`VirtualWorkspace` holds no other collaborator and has no method that
hands the overlay to one. :class:`GithubReader` builds every request in one place and that
place only ever says ``GET``. The guard suite asserts each of those three sentences.

**What a lazy workspace cannot do in full is said, not hidden.** A tree the provider
truncated, or a content search that stopped at its file bound, adds a line to
:attr:`VirtualWorkspace.notes` — the clone tier that lifts those limits is CF.3 (#572).
"""

from __future__ import annotations

import difflib
import json
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Final, Protocol
from urllib import error, request
from urllib.parse import quote

#: The most bytes of one file the workspace will read or hold. A larger file is refused.
MAX_FILE_BYTES: Final = 1_000_000

#: The most bytes the process-wide read cache holds before it evicts the least recently used.
CACHE_BYTES: Final = 64 * 1024 * 1024

#: The most files one content search fetches that it does not already hold.
SEARCH_FETCH_LIMIT: Final = 40

#: The most matches one search returns.
SEARCH_MATCH_LIMIT: Final = 100

#: The most entries one directory listing returns.
LIST_LIMIT: Final = 500

#: Seconds to wait for the provider.
READ_TIMEOUT_SECONDS: Final = 20.0

#: A path inside the repository: relative, ``/``-separated, no empty, ``.`` or ``..`` segment.
_PATH = re.compile(
    r"^(?!/)(?!.*(?:^|/)\.{1,2}(?:/|$))(?!.*//)[^\x00-\x1f\\]{1,1024}(?<!/)$"
)


class WorkspaceError(RuntimeError):
    """A workspace operation that could not be done.

    Attributes:
        code: ``not_found``, ``invalid_path``, ``too_large``, ``binary`` or ``unavailable``.
        message: A sentence the model can act on.
    """

    def __init__(self, code: str, message: str) -> None:
        """Name the failure.

        Args:
            code: The code.
            message: The sentence.
        """
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class TreeEntry:
    """One file of the pinned tree.

    Attributes:
        path: Its path from the repository root.
        size: Its size in bytes.
    """

    path: str
    size: int


@dataclass(frozen=True, slots=True)
class Tree:
    """Every file of the pinned commit, as far as the provider listed them.

    Attributes:
        entries: The files, by path.
        truncated: Whether the provider cut the listing short.
    """

    entries: tuple[TreeEntry, ...]
    truncated: bool


class RepositoryReader(Protocol):
    """Read access to one repository at one commit. There is no write on this interface."""

    def tree(self) -> Tree:
        """List every file of the pinned commit.

        Returns:
            The files.

        Raises:
            WorkspaceError: ``unavailable`` when the provider did not answer.
        """
        ...

    def blob(self, path: str) -> bytes:
        """Read one file at the pinned commit.

        Args:
            path: The file's path.

        Returns:
            Its bytes.

        Raises:
            WorkspaceError: ``not_found``, ``too_large`` or ``unavailable``.
        """
        ...


class ReadCache:
    """A byte-bounded LRU of what was read, shared by every run in the process.

    Keys carry the repository and the commit, so two workspaces never see each other's
    reads and an entry can never go stale: a commit's contents do not change.
    """

    def __init__(self, max_bytes: int = CACHE_BYTES) -> None:
        """Make an empty cache.

        Args:
            max_bytes: How much it may hold.
        """
        self._max = max_bytes
        self._held = 0
        self._entries: OrderedDict[tuple[str, str, str], tuple[object, int]] = (
            OrderedDict()
        )
        self._lock = threading.Lock()

    def get(self, key: tuple[str, str, str]) -> object | None:
        """Look an entry up, marking it recently used.

        Args:
            key: ``(repository, sha, what)``.

        Returns:
            The value, or ``None`` when it is not held.
        """
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            self._entries.move_to_end(key)
            return entry[0]

    def put(self, key: tuple[str, str, str], value: object, size: int) -> None:
        """Hold an entry, evicting the least recently used ones to make room.

        Args:
            key: ``(repository, sha, what)``.
            value: The value.
            size: Its weight in bytes. A value heavier than the whole cache is not held.
        """
        if size > self._max:
            return
        with self._lock:
            previous = self._entries.pop(key, None)
            if previous is not None:
                self._held -= previous[1]
            self._entries[key] = (value, size)
            self._held += size
            while self._held > self._max:
                _, (_, evicted) = self._entries.popitem(last=False)
                self._held -= evicted

    def __len__(self) -> int:
        """How many entries are held."""
        with self._lock:
            return len(self._entries)


class GithubReader:
    """A :class:`RepositoryReader` over GitHub's REST API.

    Two calls: the recursive tree of the commit, and a file's raw contents at it. Every
    request is built by :meth:`_get`, and :meth:`_get` only ever sends ``GET``.
    """

    #: The only HTTP method this reader sends.
    METHOD: Final = "GET"

    def __init__(
        self,
        api_url: str,
        slug: str,
        sha: str,
        token: str | None,
        *,
        timeout: float = READ_TIMEOUT_SECONDS,
        opener: request.OpenerDirector | None = None,
    ) -> None:
        """Bind a reader to one repository at one commit.

        Args:
            api_url: The API's origin — ``https://api.github.com``.
            slug: ``owner/name``.
            sha: The 40-hex commit.
            token: A read token, or ``None`` for a public repository. Held for the reader's
                life and never printed.
            timeout: Seconds to wait for an answer.
            opener: The opener to send with; a test supplies its own.
        """
        self._base = f"{api_url.rstrip('/')}/repos/{slug}"
        self._sha = sha
        self._token = token
        self._timeout = timeout
        self._opener = opener or request.build_opener(request.ProxyHandler({}))

    def __repr__(self) -> str:
        """A representation that never prints the token."""
        return f"GithubReader({self._base}@{self._sha})"

    def tree(self) -> Tree:
        """See :meth:`RepositoryReader.tree`."""
        raw = self._get(
            f"/git/trees/{self._sha}?recursive=1", "application/vnd.github+json"
        )
        try:
            listing = json.loads(raw.decode("utf-8"))
            entries = tuple(
                TreeEntry(path=str(item["path"]), size=int(item.get("size", 0)))
                for item in listing["tree"]
                if item.get("type") == "blob"
            )
            return Tree(
                entries=entries, truncated=bool(listing.get("truncated", False))
            )
        except (ValueError, KeyError, TypeError) as malformed:
            raise WorkspaceError(
                "unavailable", "the git host answered the tree outside its contract"
            ) from malformed

    def blob(self, path: str) -> bytes:
        """See :meth:`RepositoryReader.blob`."""
        return self._get(
            f"/contents/{quote(path, safe='/')}?ref={self._sha}",
            "application/vnd.github.raw+json",
        )

    def _get(self, suffix: str, accept: str) -> bytes:
        """Send the one kind of request this reader sends.

        Args:
            suffix: The path and query under the repository.
            accept: The media type to ask for.

        Returns:
            The body of a ``2xx``, at most :data:`MAX_FILE_BYTES` for a file.

        Raises:
            WorkspaceError: ``not_found`` on ``404``, ``too_large`` on a body past the
                bound, ``unavailable`` on anything else.
        """
        headers = {"Accept": accept, "X-GitHub-Api-Version": "2022-11-28"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        prepared = request.Request(  # noqa: S310 - https only: the contract's pattern says so
            f"{self._base}{suffix}", headers=headers, method=self.METHOD
        )
        try:
            with self._opener.open(prepared, timeout=self._timeout) as answer:
                body = answer.read(MAX_FILE_BYTES * 8 + 1)
        except error.HTTPError as refused:
            if refused.code == 404:
                raise WorkspaceError(
                    "not_found", "no such file at the pinned commit"
                ) from refused
            raise WorkspaceError(
                "unavailable", f"the git host answered {refused.code}"
            ) from refused
        except (error.URLError, TimeoutError, ConnectionError, OSError) as failure:
            raise WorkspaceError(
                "unavailable", "the git host could not be reached"
            ) from failure
        return body


@dataclass(frozen=True, slots=True)
class SearchMatch:
    """One line a search found.

    Attributes:
        path: The file.
        line: The line number, from 1; ``0`` for a match on the path itself.
        text: The line, cut to 200 characters.
    """

    path: str
    line: int
    text: str


class VirtualWorkspace:
    """A repository at a pinned commit, with an overlay of everything written to it."""

    def __init__(
        self, reader: RepositoryReader, cache: ReadCache, repository: str, sha: str
    ) -> None:
        """Make a workspace with an empty overlay.

        Args:
            reader: Where reads resolve.
            cache: The process's read cache.
            repository: ``owner/name`` — half of every cache key.
            sha: The pinned commit — the other half.
        """
        self._reader = reader
        self._cache = cache
        self._key = (repository, sha)
        self._overlay: dict[str, str | None] = {}
        self._read: list[str] = []
        self.notes: list[str] = []
        self.fetches = 0

    # -- reads ------------------------------------------------------------------------

    def read(self, path: str) -> str:
        """Read a file as the run sees it: the overlay first, then the pinned commit.

        Args:
            path: The file.

        Returns:
            Its text.

        Raises:
            WorkspaceError: ``invalid_path``, ``not_found`` (including a file the run
                deleted), ``too_large``, ``binary`` or ``unavailable``.
        """
        checked = _checked(path)
        if checked in self._overlay:
            written = self._overlay[checked]
            if written is None:
                raise WorkspaceError("not_found", f"{checked} was deleted in this run")
            text = written
        else:
            text = self._base(checked)
        # Logged only once it was actually read: a refused read mapped nothing.
        self._read.append(checked)
        return text

    def list_dir(self, path: str = "") -> list[str]:
        """List a directory as the run sees it.

        Args:
            path: The directory, or ``""`` for the root.

        Returns:
            Its immediate children, sorted, a directory ending in ``/``. At most
            :data:`LIST_LIMIT`.

        Raises:
            WorkspaceError: ``invalid_path``, ``not_found`` or ``unavailable``.
        """
        prefix = _directory(path)
        children: set[str] = set()
        for candidate in self._paths():
            if not candidate.startswith(prefix):
                continue
            head, slash, _ = candidate[len(prefix) :].partition("/")
            children.add(head + slash)
        if not children and prefix:
            raise WorkspaceError("not_found", f"no directory {prefix} in the workspace")
        return sorted(children)[:LIST_LIMIT]

    def search(self, query: str, path: str = "") -> list[SearchMatch]:
        """Find a literal string in paths and in file contents.

        Every path is searched. Contents are searched in the overlay, in every file already
        read, and in at most :data:`SEARCH_FETCH_LIMIT` more files, smallest first; stopping
        there is noted rather than silent.

        Args:
            query: The text to find, case-insensitively.
            path: Only search under this directory.

        Returns:
            Up to :data:`SEARCH_MATCH_LIMIT` matches, by path then line.

        Raises:
            WorkspaceError: ``invalid_path`` or ``unavailable``.
        """
        needle = query.casefold()
        prefix = _directory(path)
        sizes = {entry.path: entry.size for entry in self._tree().entries}
        scoped = [p for p in self._paths() if p.startswith(prefix)]

        matches = [SearchMatch(p, 0, p) for p in scoped if needle in p.casefold()]
        held = [p for p in scoped if p in self._overlay or self._cached(p) is not None]
        unheld = sorted(
            (p for p in scoped if p not in held and sizes.get(p, 0) <= MAX_FILE_BYTES),
            key=lambda p: (sizes.get(p, 0), p),
        )
        if len(unheld) > SEARCH_FETCH_LIMIT:
            self._note(
                f"search read {SEARCH_FETCH_LIMIT} of {len(unheld)} unread files "
                "(a lazy workspace bounds deep searches)"
            )
        for candidate in sorted(held + unheld[:SEARCH_FETCH_LIMIT]):
            try:
                text = self._peek(candidate)
            except WorkspaceError:
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                if needle in line.casefold():
                    matches.append(SearchMatch(candidate, number, line.strip()[:200]))
        return sorted(matches, key=lambda m: (m.path, m.line))[:SEARCH_MATCH_LIMIT]

    # -- writes: the overlay, and only the overlay --------------------------------------

    def write(self, path: str, content: str) -> None:
        """Write a file into the overlay. Nothing leaves the process.

        Args:
            path: The file.
            content: Its whole new text.

        Raises:
            WorkspaceError: ``invalid_path`` or ``too_large``.
        """
        checked = _checked(path)
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise WorkspaceError("too_large", f"{checked} would exceed the file bound")
        self._overlay[checked] = content

    def delete(self, path: str) -> None:
        """Delete a file in the overlay.

        Args:
            path: The file.

        Raises:
            WorkspaceError: ``invalid_path`` or ``not_found``.
        """
        checked = _checked(path)
        if checked not in self._paths():
            raise WorkspaceError("not_found", f"no file {checked} in the workspace")
        self._overlay[checked] = None

    # -- what the run did ---------------------------------------------------------------

    @property
    def read_log(self) -> tuple[str, ...]:
        """Every path :meth:`read` was asked for, in order, repeats included.

        A stage's own reads are the slice of this log made while it ran.
        """
        return tuple(self._read)

    def changed_paths(self) -> list[str]:
        """The files the overlay actually changes, sorted.

        Returns:
            Paths whose overlay content differs from the pinned commit's — a file written
            back to what it was is not a change.
        """
        return [path for path, _, _ in self._changes()]

    def diff(self) -> str:
        """Render the overlay as a unified diff against the pinned commit.

        Returns:
            The diff, files in path order; ``""`` when nothing changed.
        """
        parts: list[str] = []
        for path, before, after in self._changes():
            parts.extend(
                difflib.unified_diff(
                    before.splitlines(keepends=True),
                    after.splitlines(keepends=True),
                    fromfile=f"a/{path}" if before else "/dev/null",
                    tofile=f"b/{path}" if after else "/dev/null",
                )
            )
        text = "".join(part if part.endswith("\n") else part + "\n" for part in parts)
        return text

    def line_counts(self) -> list[tuple[str, int, int]]:
        """Count the lines each changed file adds and removes.

        Returns:
            ``(path, added, removed)`` per changed file, in path order.
        """
        counts: list[tuple[str, int, int]] = []
        for path, before, after in self._changes():
            added = removed = 0
            for line in difflib.ndiff(before.splitlines(), after.splitlines()):
                added += line.startswith("+ ")
                removed += line.startswith("- ")
            counts.append((path, added, removed))
        return counts

    # -- internals ----------------------------------------------------------------------

    def _changes(self) -> list[tuple[str, str, str]]:
        """Pair every overlay entry with the pinned text it replaces.

        Returns:
            ``(path, before, after)`` for entries that differ, in path order; a missing
            side is ``""``.
        """
        if not self._overlay:
            return []
        base = {entry.path for entry in self._tree().entries}
        changes: list[tuple[str, str, str]] = []
        for path in sorted(self._overlay):
            after = self._overlay[path] or ""
            before = self._base(path) if path in base else ""
            if before != after or (path in base) != (self._overlay[path] is not None):
                changes.append((path, before, after))
        return changes

    def _paths(self) -> set[str]:
        """Every file the run sees: the pinned tree, plus writes, minus deletes."""
        paths = {entry.path for entry in self._tree().entries}
        for path, content in self._overlay.items():
            if content is None:
                paths.discard(path)
            else:
                paths.add(path)
        return paths

    def _tree(self) -> Tree:
        """The pinned tree, fetched once per repository and commit."""
        key = (*self._key, "\x00tree")
        held = self._cache.get(key)
        if isinstance(held, Tree):
            return held
        self.fetches += 1
        tree = self._reader.tree()
        if tree.truncated:
            self._note(
                "the git host truncated the file listing: paths deep in the tree may "
                "be missing from listings and searches"
            )
        self._cache.put(key, tree, sum(len(e.path) + 16 for e in tree.entries))
        return tree

    def _cached(self, path: str) -> str | None:
        """A pinned file's text if the cache holds it."""
        held = self._cache.get((*self._key, path))
        return held if isinstance(held, str) else None

    def _base(self, path: str) -> str:
        """A file's text at the pinned commit, from the cache or the provider.

        Args:
            path: A checked path.

        Returns:
            Its text.

        Raises:
            WorkspaceError: ``not_found``, ``too_large``, ``binary`` or ``unavailable``.
        """
        held = self._cached(path)
        if held is not None:
            return held
        self.fetches += 1
        raw = self._reader.blob(path)
        if len(raw) > MAX_FILE_BYTES:
            raise WorkspaceError("too_large", f"{path} is larger than the file bound")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as binary:
            raise WorkspaceError("binary", f"{path} is not a text file") from binary
        self._cache.put((*self._key, path), text, len(raw))
        return text

    def _peek(self, path: str) -> str:
        """Read through the overlay without counting the path as read by a stage."""
        if path in self._overlay:
            return self._overlay[path] or ""
        return self._base(path)

    def _note(self, note: str) -> None:
        """Record a limit the workspace ran into, once."""
        if note not in self.notes:
            self.notes.append(note)


def _checked(path: str) -> str:
    """Refuse a path that could name anything outside the repository.

    Args:
        path: The path as a tool was given it.

    Returns:
        The path, unchanged.

    Raises:
        WorkspaceError: ``invalid_path`` for an absolute path, a ``..`` or ``.`` segment, a
            backslash, a control character or an empty path.
    """
    if not isinstance(path, str) or _PATH.fullmatch(path) is None:
        raise WorkspaceError(
            "invalid_path",
            "paths are relative to the repository root, with no `.` or `..` segment",
        )
    return path


def _directory(path: str) -> str:
    """Turn a directory argument into the prefix its files share.

    Args:
        path: ``""`` for the root, or a directory with or without a trailing ``/``.

    Returns:
        ``""`` for the root, otherwise the checked path ending in ``/``.

    Raises:
        WorkspaceError: ``invalid_path`` — an absolute path is not a directory of the
            repository, however it would resolve.
    """
    if path == "":
        return ""
    return _checked(path.removesuffix("/")) + "/"


def glob_matches(glob: str, path: str) -> bool:
    """Whether a path matches one of the DSL's globs.

    Args:
        glob: ``drivers/can/**`` — ``**`` spans directories, ``*`` and ``?`` stay inside one.
        path: A repository path.

    Returns:
        ``True`` when the whole path matches.
    """
    pattern: list[str] = []
    index = 0
    while index < len(glob):
        if glob.startswith("**/", index):
            pattern.append("(?:.*/)?")
            index += 3
        elif glob.startswith("**", index):
            pattern.append(".*")
            index += 2
        elif glob[index] == "*":
            pattern.append("[^/]*")
            index += 1
        elif glob[index] == "?":
            pattern.append("[^/]")
            index += 1
        else:
            pattern.append(re.escape(glob[index]))
            index += 1
    return re.fullmatch("".join(pattern), path) is not None
