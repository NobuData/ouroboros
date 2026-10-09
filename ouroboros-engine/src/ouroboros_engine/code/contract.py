"""``/v0/code/*`` on the wire — what ``ouroboros-rest``'s ``code`` adapter sends and reads.

Every request names the repository three ways at once — the workspace it is read for, its
``owner/name``, and where to fetch it from — plus, for that one call, the workspace's GitHub
token. Every answer names the **40-hex commit it was read at** (``sha``) and when the clone was
last fetched, so the adapter can build a ``git://owner/name@sha/path#Lnn`` locator that re-runs
to the same result.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ouroboros_engine.code.clones import SLUG_PATTERN, WORKSPACE_PATTERN
from ouroboros_engine.code.repo import PATH_PATTERN, REF_PATTERN

#: The stacks ``dep_graph`` parses. Anything else is answered ``unsupported``.
DepStack = Literal["c", "python", "javascript"]

# python-re: the ref and path patterns use look-arounds, which pydantic's default engine lacks.
_FROZEN = ConfigDict(extra="forbid", frozen=True, regex_engine="python-re")

Ref = Annotated[str, Field(pattern=REF_PATTERN, max_length=255)]
RepoPath = Annotated[str, Field(pattern=PATH_PATTERN, max_length=1024)]


class CodeRepository(BaseModel):
    """Which repository, for which workspace, from where.

    Attributes:
        workspace: The workspace's organization id; its clones are kept apart from every
            other's.
        slug: ``owner/name``.
        remote: ``https://host/owner/name.git``.
        token: The credential for this call's fetch. Used once and never stored or echoed.
    """

    model_config = _FROZEN

    workspace: Annotated[str, Field(pattern=WORKSPACE_PATTERN)]
    slug: Annotated[str, Field(pattern=SLUG_PATTERN, max_length=201)]
    remote: Annotated[str, Field(min_length=1, max_length=2048)]
    token: str | None = Field(default=None, min_length=1, max_length=1024, repr=False)


class CloneInfo(BaseModel):
    """The clone an answer was read from.

    Attributes:
        repository: ``owner/name``.
        fetched_at: The clone's last successful fetch.
        stale: ``True`` when a refresh was due and failed, so the clone was read as it was.
    """

    model_config = _FROZEN

    repository: str
    fetched_at: datetime
    stale: bool


class CommitInfo(BaseModel):
    """The citable facts of one commit.

    Attributes:
        sha: 40-hex.
        committed_at: The committer date, UTC.
        author: The author's name — never the address.
        summary: The message's first line, at most 200 characters.
    """

    model_config = _FROZEN

    sha: Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
    committed_at: datetime
    author: str
    summary: str


class Age(BaseModel):
    """How long something has gone unchanged, as the brief says it.

    Attributes:
        months: Whole calendar months.
        days: Whole days.
        phrase: ``unchanged in 14 months`` — the brief's sentence, from the data.
    """

    model_config = _FROZEN

    months: Annotated[int, Field(ge=0)]
    days: Annotated[int, Field(ge=0)]
    phrase: str


class BlameRequest(BaseModel):
    """``blame(path, range)`` at a ref."""

    model_config = _FROZEN

    repository: CodeRepository
    ref: Ref
    path: RepoPath
    start: Annotated[int, Field(ge=1)]
    end: Annotated[int, Field(ge=1)]

    @model_validator(mode="after")
    def _ordered(self) -> "BlameRequest":
        """Refuse a range that ends before it starts.

        Returns:
            The request.

        Raises:
            ValueError: ``end < start``.
        """
        if self.end < self.start:
            raise ValueError("end must not be before start")
        return self


class BlameHunk(BaseModel):
    """Consecutive lines last changed by one commit.

    Attributes:
        start: First line (1-based, inclusive).
        end: Last line (inclusive).
        commit: The commit that last changed them.
    """

    model_config = _FROZEN

    start: int
    end: int
    commit: CommitInfo


class Blame(BaseModel):
    """Who last changed a line range, and when.

    Attributes:
        clone: The clone read.
        ref: The ref as asked.
        sha: The commit it resolved to — the citation's anchor.
        path: The file.
        start: First line answered.
        end: Last line answered — clamped to the file's length.
        lines: The lines' text.
        hunks: The range split by last-changing commit.
        last_change: The most recent of those commits.
        as_of: ``sha``'s committer date — what "unchanged in …" is measured to, so the
            answer is the same whenever it is re-run.
        unchanged: How long the range had gone unchanged at ``as_of``.
    """

    model_config = _FROZEN

    clone: CloneInfo
    ref: str
    sha: str
    path: str
    start: int
    end: int
    lines: list[str]
    hunks: list[BlameHunk]
    last_change: CommitInfo
    as_of: datetime
    unchanged: Age


class HistoryRequest(BaseModel):
    """``history(path | symbol, window)`` at a ref."""

    model_config = _FROZEN

    repository: CodeRepository
    ref: Ref
    path: RepoPath | None = None
    symbol: (
        Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_:.]{0,127}$")] | None
    ) = None
    window_days: Annotated[int, Field(ge=1, le=3650)] = 90

    @model_validator(mode="after")
    def _subject(self) -> "HistoryRequest":
        """Require something to trace.

        Returns:
            The request.

        Raises:
            ValueError: Neither a path nor a symbol.
        """
        if self.path is None and self.symbol is None:
            raise ValueError("name a path or a symbol")
        return self


class ChangedCommit(BaseModel):
    """One commit and the lines it moved in scope.

    Attributes:
        commit: The commit.
        added: Lines added in scope.
        deleted: Lines deleted in scope.
        files: Files touched in scope.
    """

    model_config = _FROZEN

    commit: CommitInfo
    added: int
    deleted: int
    files: list[str]


class History(BaseModel):
    """Change frequency and churn over a window ending at ``sha``.

    Attributes:
        clone: The clone read.
        ref: The ref as asked.
        sha: Its commit.
        path: The path traced, if one was named.
        symbol: The symbol traced (commits that change how often it occurs), if one was.
        window_days: The window.
        since: Start of the window — ``until`` minus ``window_days``.
        until: ``sha``'s committer date.
        commits: The changes, newest first, at most 200.
        total_commits: How many there were.
        truncated: ``True`` when ``commits`` is not all of them, or the walk hit its bound.
        added: Lines added over the window.
        deleted: Lines deleted.
        authors: Distinct authors.
        per_month: Changes per 30 days.
    """

    model_config = _FROZEN

    clone: CloneInfo
    ref: str
    sha: str
    path: str | None
    symbol: str | None
    window_days: int
    since: datetime
    until: datetime
    commits: list[ChangedCommit]
    total_commits: int
    truncated: bool
    added: int
    deleted: int
    authors: int
    per_month: float


class ChangedBetweenRequest(BaseModel):
    """``changed_between(ref_a, ref_b, scope)``."""

    model_config = _FROZEN

    repository: CodeRepository
    base: Ref
    head: Ref
    scope: RepoPath | None = None


class ChangedFile(BaseModel):
    """One file's movement across a range.

    Attributes:
        path: The file.
        commits: How many commits in the range touched it.
        added: Lines added.
        deleted: Lines deleted.
    """

    model_config = _FROZEN

    path: str
    commits: int
    added: int
    deleted: int


class ChangedBetween(BaseModel):
    """What moved between a baseline and a later commit.

    Attributes:
        clone: The clone read.
        base: The baseline ref as asked.
        head: The later ref as asked.
        base_sha: Its commit.
        head_sha: Its commit.
        scope: The directory or file looked at, or ``None`` for the whole tree.
        commits: Commits reachable from ``head`` and not ``base`` that touch scope, newest
            first, at most 200.
        total_commits: How many there were.
        truncated: ``True`` when a list is not all of them.
        files: Files touched, most-touched first, at most 200.
        total_files: How many files there were.
        added: Lines added in scope.
        deleted: Lines deleted.
    """

    model_config = _FROZEN

    clone: CloneInfo
    base: str
    head: str
    base_sha: str
    head_sha: str
    scope: str | None
    commits: list[ChangedCommit]
    total_commits: int
    truncated: bool
    files: list[ChangedFile]
    total_files: int
    added: int
    deleted: int


class DepGraphRequest(BaseModel):
    """``dep_graph(module)`` at a ref, for the stack repository detection knows."""

    model_config = _FROZEN

    repository: CodeRepository
    ref: Ref
    module: RepoPath | None = None
    stack: DepStack | None = None


class DepEdge(BaseModel):
    """One dependency.

    Attributes:
        source: The file (or directory, for a module edge) that depends.
        target: What it depends on.
        weight: How many file edges a module edge stands for; ``1`` for a file edge.
    """

    model_config = _FROZEN

    source: str
    target: str
    weight: Annotated[int, Field(ge=1)] = 1


class DepGraph(BaseModel):
    """A module's dependency graph — or an honest ``unsupported``.

    Attributes:
        clone: The clone read.
        ref: The ref as asked.
        sha: Its commit.
        module: The directory graphed (``None`` for the whole tree).
        stack: The stack parsed, or ``None`` when none was known.
        status: ``ok``, or ``unsupported`` — never an empty graph standing in for one.
        reason: Why, when ``unsupported``.
        nodes: Files under the module.
        edges: File → file dependencies resolved inside the repository.
        module_edges: The same rolled up to directories.
        external: What the module imports from outside the repository.
        truncated: ``True`` when the file bound was reached.
    """

    model_config = _FROZEN

    clone: CloneInfo
    ref: str
    sha: str
    module: str | None
    stack: DepStack | None
    status: Literal["ok", "unsupported"]
    reason: str | None
    nodes: list[str]
    edges: list[DepEdge]
    module_edges: list[DepEdge]
    external: list[str]
    truncated: bool


class BisectCommitsRequest(BaseModel):
    """The commits a bisect between two refs walks."""

    model_config = _FROZEN

    repository: CodeRepository
    good: Ref
    bad: Ref


class BisectCommits(BaseModel):
    """The first-parent line from a good commit to a bad one.

    Attributes:
        clone: The clone read.
        good: The good ref as asked.
        bad: The bad ref as asked.
        good_sha: Its commit — known good, not a candidate.
        bad_sha: Its commit — the last candidate.
        bad_ref_name: The ref ``bad`` names — ``refs/heads/nightly`` — which a build fetches
            to reach every candidate; ``None`` when ``bad`` was a commit id.
        commits: Candidates oldest first: after ``good_sha``, up to and including
            ``bad_sha``.
        max_steps: ``⌊log₂ n⌋ + 1`` — the most build-farm jobs isolating the culprit takes.
    """

    model_config = _FROZEN

    clone: CloneInfo
    good: str
    bad: str
    good_sha: str
    bad_sha: str
    bad_ref_name: str | None
    commits: list[str]
    max_steps: int
