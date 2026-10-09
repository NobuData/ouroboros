"""Blame, history, changed-between and the bisect line — deterministic code archaeology.

Each operation reads a :class:`~ouroboros_engine.code.repo.ReadOnlyRepo` at a commit resolved
once, up front, and measures time against **that commit's** committer date rather than the
clock: *"unchanged in 14 months"* is true of ``8c1b2e4`` forever, which is what lets a citation
re-run to the same sentence.

```
blame(src/dock/dock_ctrl.c, 200-230)          ─▶ "unchanged in 14 months" @8c1b2e4
history(src/motor/pid.c, 90d)                 ─▶ 6 changes · +41 -18 · 2.0/month
changed_between(v2.0.4, nightly, src/motor/)  ─▶ 37 commits, files by churn
bisect_commits(v2.0.4, nightly)               ─▶ n candidates, ⌊log₂ n⌋+1 farm jobs at most
```

Line counts are a line diff of the two blobs (``difflib`` up to :data:`EXACT_DIFF_LINES` lines a
side, a multiset difference beyond), so they agree with ``git diff --numstat`` on ordinary
edits; a binary file or one over :data:`MAX_DIFF_BYTES` counts as touched with no lines.
"""

import difflib
import math
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime

from dulwich.annotate import annotate_lines
from dulwich.diff_tree import TreeChange, tree_changes
from dulwich.objects import Commit

from ouroboros_engine.code.contract import (
    Age,
    BisectCommits,
    Blame,
    BlameHunk,
    ChangedBetween,
    ChangedCommit,
    ChangedFile,
    CloneInfo,
    CommitInfo,
    History,
)
from ouroboros_engine.code.repo import (
    PathNotFoundError,
    ReadOnlyRepo,
    facts_of,
)

#: The widest line range one ``blame`` answers.
MAX_BLAME_LINES = 500

#: The most commits an answer lists (the totals count all of them).
MAX_LISTED = 200

#: The most commits one walk visits before it stops and says ``truncated``.
MAX_WALK = 5000

#: The longest line a bisect may walk — 10 000 candidates is 14 farm jobs.
MAX_BISECT_COMMITS = 10_000

#: Blobs larger than this count as touched, with no line counts.
MAX_DIFF_BYTES = 1_048_576

#: Up to this many lines a side, the exact line diff; beyond it, the multiset difference.
EXACT_DIFF_LINES = 5000

_DAY = 86_400


class RangeOutsideFileError(ValueError):
    """A blame range starts after the file ends."""

    def __init__(self, path: str, start: int, length: int) -> None:
        """Record the range and the file's length.

        Args:
            path: The file.
            start: The first line asked for.
            length: How many lines the file has.
        """
        super().__init__(f"{path} has {length} lines; line {start} does not exist")
        self.path = path
        self.start = start
        self.length = length


class RangeTooWideError(ValueError):
    """A blame range wider than :data:`MAX_BLAME_LINES`."""


class NotAncestorError(ValueError):
    """The good commit is not on the bad commit's first-parent line."""


class BisectTooLongError(ValueError):
    """More than :data:`MAX_BISECT_COMMITS` candidates between good and bad."""


def commit_info(commit: Commit) -> CommitInfo:
    """A commit, as an answer cites it.

    Args:
        commit: The commit.

    Returns:
        Its :class:`CommitInfo`.
    """
    facts = facts_of(commit)
    return CommitInfo(
        sha=facts.sha,
        committed_at=_utc(facts.committed_at),
        author=facts.author,
        summary=facts.summary,
    )


def age(changed_at: datetime, as_of: datetime) -> Age:
    """How long something went unchanged, in the brief's words.

    Args:
        changed_at: When it last changed.
        as_of: When it is measured to.

    Returns:
        Whole calendar months and days, and the phrase — ``unchanged in 14 months``,
        ``unchanged in 2 years`` from 24 months, ``unchanged in 9 days`` under a month,
        ``changed the same day`` under a day.
    """
    days = max(0, (as_of - changed_at).days)
    months = (as_of.year - changed_at.year) * 12 + (as_of.month - changed_at.month)
    if (as_of.day, as_of.time()) < (changed_at.day, changed_at.time()):
        months -= 1
    months = max(0, months)
    if months >= 24:
        phrase = f"unchanged in {months // 12} years"
    elif months >= 1:
        phrase = f"unchanged in {months} month{'s' if months != 1 else ''}"
    elif days >= 1:
        phrase = f"unchanged in {days} day{'s' if days != 1 else ''}"
    else:
        phrase = "changed the same day"
    return Age(months=months, days=days, phrase=phrase)


def blame(
    repo: ReadOnlyRepo,
    clone: CloneInfo,
    ref: str,
    path: str,
    start: int,
    end: int,
) -> Blame:
    """Who last changed each line of a range, and how long ago.

    Args:
        repo: The clone.
        clone: Where it was read, echoed.
        ref: The ref.
        path: The file.
        start: First line, 1-based.
        end: Last line, inclusive — clamped to the file's length.

    Returns:
        The hunks, the most recent change among them and how long the range had gone unchanged
        at the ref's commit.

    Raises:
        RangeTooWideError: More than :data:`MAX_BLAME_LINES` lines.
        PathNotFoundError: No such file at the ref.
        RangeOutsideFileError: ``start`` is past the end of the file.
    """
    if end - start + 1 > MAX_BLAME_LINES:
        raise RangeTooWideError(f"blame answers at most {MAX_BLAME_LINES} lines")
    sha = repo.resolve(ref)
    repo.blob(sha, path)  # PathNotFoundError before annotate's own KeyError
    annotated = annotate_lines(repo.store, sha.encode(), path.encode())
    if start > len(annotated):
        raise RangeOutsideFileError(path, start, len(annotated))
    end = min(end, len(annotated))

    hunks: list[BlameHunk] = []
    infos: dict[bytes, CommitInfo] = {}
    for number in range(start, end + 1):
        (commit, _), _ = annotated[number - 1]
        info = infos.setdefault(commit.id, commit_info(commit))
        if hunks and hunks[-1].commit.sha == info.sha and hunks[-1].end == number - 1:
            hunks[-1] = hunks[-1].model_copy(update={"end": number})
        else:
            hunks.append(BlameHunk(start=number, end=number, commit=info))

    last = max(infos.values(), key=lambda info: (info.committed_at, info.sha))
    as_of = commit_info(repo.commit(sha)).committed_at
    return Blame(
        clone=clone,
        ref=ref,
        sha=sha,
        path=path,
        start=start,
        end=end,
        lines=[
            text.decode("utf-8", "replace").rstrip("\r\n")
            for _, text in annotated[start - 1 : end]
        ],
        hunks=hunks,
        last_change=last,
        as_of=as_of,
        unchanged=age(last.committed_at, as_of),
    )


def history(
    repo: ReadOnlyRepo,
    clone: CloneInfo,
    ref: str,
    *,
    path: str | None,
    symbol: str | None,
    window_days: int,
) -> History:
    """How often a path (or a symbol) changed over a window ending at the ref.

    The ref's first-parent line is walked, as ``git log --first-parent`` does: a merged
    branch counts once, as its merge, which is how the mainline took the change.

    Args:
        repo: The clone.
        clone: Where it was read, echoed.
        ref: The ref.
        path: A file or directory to trace, or ``None``.
        symbol: A symbol to trace — a commit counts when it changes how often the symbol
            occurs in a file it touches (git's pickaxe, ``-S``) — or ``None``.
        window_days: How far back from the ref's commit.

    Returns:
        The changes, their churn and their frequency.

    Raises:
        PathNotFoundError: A path that is not in the tree at the ref.
    """
    sha = repo.resolve(ref)
    if path is not None and repo.entry(sha, path) is None:
        raise PathNotFoundError(path, sha, "path")
    until = commit_info(repo.commit(sha)).committed_at
    since_ts = int(until.timestamp()) - window_days * _DAY

    changed: list[ChangedCommit] = []
    walked = 0
    for commit in _first_parent_line(repo, sha):
        walked += 1
        if commit.commit_time < since_ts or walked > MAX_WALK:
            break
        moved = _moved(repo, commit, path, symbol)
        if moved is not None:
            changed.append(moved[0])

    added = sum(item.added for item in changed)
    deleted = sum(item.deleted for item in changed)
    return History(
        clone=clone,
        ref=ref,
        sha=sha,
        path=path,
        symbol=symbol,
        window_days=window_days,
        since=_utc(since_ts),
        until=until,
        commits=changed[:MAX_LISTED],
        total_commits=len(changed),
        truncated=len(changed) > MAX_LISTED or walked > MAX_WALK,
        added=added,
        deleted=deleted,
        authors=len({item.commit.author for item in changed}),
        per_month=round(len(changed) * 30 / window_days, 2),
    )


def changed_between(
    repo: ReadOnlyRepo,
    clone: CloneInfo,
    base: str,
    head: str,
    scope: str | None,
) -> ChangedBetween:
    """What moved between a baseline and a later commit — the regression-forensics staple.

    Args:
        repo: The clone.
        clone: Where it was read, echoed.
        base: The baseline ref (``v2.0.4``).
        head: The later ref (``nightly``).
        scope: A directory or file to restrict to, or ``None``.

    Returns:
        Commits reachable from ``head`` and not from ``base`` that touch scope, and the files
        they touched.
    """
    base_sha = repo.resolve(base)
    head_sha = repo.resolve(head)
    excluded = _ancestors(repo, base_sha)

    changed: list[ChangedCommit] = []
    files: dict[str, list[int]] = {}
    walked = 0
    for commit in _reachable(repo, head_sha, excluded):
        walked += 1
        if walked > MAX_WALK:
            break
        moved = _moved(repo, commit, scope, None)
        if moved is None:
            continue
        changed.append(moved[0])
        for name, (added, deleted) in moved[1].items():
            tally = files.setdefault(name, [0, 0, 0])
            tally[0] += 1
            tally[1] += added
            tally[2] += deleted
    ranked = sorted(files.items(), key=lambda pair: (-pair[1][0], pair[0]))

    return ChangedBetween(
        clone=clone,
        base=base,
        head=head,
        base_sha=base_sha,
        head_sha=head_sha,
        scope=scope,
        commits=changed[:MAX_LISTED],
        total_commits=len(changed),
        truncated=len(changed) > MAX_LISTED
        or len(ranked) > MAX_LISTED
        or walked > MAX_WALK,
        files=[
            ChangedFile(path=name, commits=c, added=a, deleted=d)
            for name, (c, a, d) in ranked[:MAX_LISTED]
        ],
        total_files=len(ranked),
        added=sum(item.added for item in changed),
        deleted=sum(item.deleted for item in changed),
    )


def bisect_commits(
    repo: ReadOnlyRepo, clone: CloneInfo, good: str, bad: str
) -> BisectCommits:
    """The candidates a bisect walks: the first-parent line after ``good`` up to ``bad``.

    First-parent, so the line is linear and "every commit after the culprit is bad" holds
    for a binary search: a merge is tested as the merge, the way the mainline built it.

    Args:
        repo: The clone.
        clone: Where it was read, echoed.
        good: A ref known good.
        bad: A ref known bad.

    Returns:
        The candidates, oldest first, and the step bound ``⌊log₂ n⌋ + 1``.

    Raises:
        NotAncestorError: ``good`` is ``bad`` or not on its first-parent line.
        BisectTooLongError: More than :data:`MAX_BISECT_COMMITS` candidates.
    """
    good_sha = repo.resolve(good)
    bad_sha = repo.resolve(bad)
    line: list[str] = []
    for commit in _first_parent_line(repo, bad_sha):
        current = commit.id.decode("ascii")
        if current == good_sha:
            break
        if len(line) >= MAX_BISECT_COMMITS:
            raise BisectTooLongError(
                f"more than {MAX_BISECT_COMMITS} commits between good and bad"
            )
        line.append(current)
    else:
        raise NotAncestorError("good is not on bad's first-parent line")
    if not line:
        raise NotAncestorError("good and bad are the same commit")
    line.reverse()
    return BisectCommits(
        clone=clone,
        good=good,
        bad=bad,
        good_sha=good_sha,
        bad_sha=bad_sha,
        bad_ref_name=repo.full_name(bad),
        commits=line,
        max_steps=max_steps(len(line)),
    )


def max_steps(candidates: int) -> int:
    """The most farm jobs a bisect over ``candidates`` commits may spend.

    Args:
        candidates: How many commits could be the culprit (``≥ 1``).

    Returns:
        ``⌊log₂ n⌋ + 1``.
    """
    return math.floor(math.log2(max(1, candidates))) + 1


# ---------------------------------------------------------------------------
# Walking and diffing
# ---------------------------------------------------------------------------


def _first_parent_line(repo: ReadOnlyRepo, sha: str) -> Iterable[Commit]:
    """A commit and its first parents, newest first.

    Args:
        repo: The clone.
        sha: Where to start.

    Yields:
        Each commit on the line; it ends at a root, or at a parent the clone lacks.
    """
    current: str | None = sha
    while current is not None:
        try:
            commit = repo.commit(current)
        except LookupError:
            return
        yield commit
        current = commit.parents[0].decode("ascii") if commit.parents else None


def _ancestors(repo: ReadOnlyRepo, sha: str) -> set[bytes]:
    """Every commit reachable from one, itself included.

    Args:
        repo: The clone.
        sha: The commit.

    Returns:
        Their ids.
    """
    seen: set[bytes] = set()
    stack = [sha.encode()]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            stack.extend(repo.commit(current.decode("ascii")).parents)
        except LookupError:
            continue
    return seen


def _reachable(repo: ReadOnlyRepo, sha: str, excluded: set[bytes]) -> list[Commit]:
    """Commits reachable from ``sha`` and not in ``excluded``, newest first.

    Args:
        repo: The clone.
        sha: The later commit.
        excluded: The baseline's ancestry.

    Returns:
        The commits, by committer date descending (id breaks ties).
    """
    found: dict[bytes, Commit] = {}
    stack = [sha.encode()]
    while stack and len(found) <= MAX_WALK:
        current = stack.pop()
        if current in excluded or current in found:
            continue
        try:
            commit = repo.commit(current.decode("ascii"))
        except LookupError:
            continue
        found[current] = commit
        stack.extend(commit.parents)
    return sorted(found.values(), key=lambda c: (-c.commit_time, c.id))


def _in_scope(name: str, scope: str | None) -> bool:
    """Whether a path is inside a scope.

    Args:
        name: The path.
        scope: A directory or file, or ``None`` for everything.

    Returns:
        ``True`` when it is the scope or below it.
    """
    return scope is None or name == scope or name.startswith(f"{scope}/")


def _changes(repo: ReadOnlyRepo, commit: Commit) -> list[TreeChange]:
    """What a commit changed against its first parent (everything, for a root).

    Args:
        repo: The clone.
        commit: The commit.

    Returns:
        The tree changes.
    """
    parent_tree = None
    if commit.parents:
        try:
            parent_tree = repo.commit(commit.parents[0].decode("ascii")).tree
        except LookupError:
            parent_tree = None
    return list(tree_changes(repo.store, parent_tree, commit.tree))


def _change_path(change: TreeChange) -> str:
    """The path a change is reported under — the new one, or the old for a delete.

    Args:
        change: The change.

    Returns:
        The path.
    """
    entry = change.new if change.new is not None and change.new.path else change.old
    return entry.path.decode("utf-8", "replace") if entry and entry.path else ""


def _side(repo: ReadOnlyRepo, entry: object) -> bytes:
    """One side of a change's content.

    Args:
        repo: The clone.
        entry: The change's old or new entry.

    Returns:
        The blob's bytes, or ``b""`` when the side is absent or not a blob.
    """
    blob_id = getattr(entry, "sha", None)
    if not blob_id:
        return b""
    return repo.blob_by_id(blob_id) or b""


def line_delta(old: bytes, new: bytes) -> tuple[int, int]:
    """Lines added and deleted between two versions of a file.

    Args:
        old: The earlier content.
        new: The later content.

    Returns:
        ``(added, deleted)``; ``(0, 0)`` for a binary or oversized file.
    """
    if len(old) > MAX_DIFF_BYTES or len(new) > MAX_DIFF_BYTES:
        return (0, 0)
    if b"\0" in old[:8000] or b"\0" in new[:8000]:
        return (0, 0)
    before = old.splitlines()
    after = new.splitlines()
    if len(before) > EXACT_DIFF_LINES or len(after) > EXACT_DIFF_LINES:
        gained = Counter(after) - Counter(before)
        lost = Counter(before) - Counter(after)
        return (sum(gained.values()), sum(lost.values()))
    added = deleted = 0
    matcher = difflib.SequenceMatcher(None, before, after, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in {"replace", "delete"}:
            deleted += i2 - i1
        if tag in {"replace", "insert"}:
            added += j2 - j1
    return (added, deleted)


def _moved(
    repo: ReadOnlyRepo, commit: Commit, scope: str | None, symbol: str | None
) -> tuple[ChangedCommit, dict[str, tuple[int, int]]] | None:
    """A commit's movement in scope, or ``None`` when it did not touch it.

    Args:
        repo: The clone.
        commit: The commit.
        scope: The path, or ``None``.
        symbol: When set, only files whose count of the symbol changed count.

    Returns:
        The commit with its line counts and files, and ``{path: (added, deleted)}``.
    """
    per_file: dict[str, tuple[int, int]] = {}
    needle = symbol.encode() if symbol else None
    for change in _changes(repo, commit):
        name = _change_path(change)
        if not _in_scope(name, scope):
            continue
        old = _side(repo, change.old)
        new = _side(repo, change.new)
        if needle is not None and old.count(needle) == new.count(needle):
            continue
        per_file[name] = line_delta(old, new)
    if not per_file:
        return None
    moved = ChangedCommit(
        commit=commit_info(commit),
        added=sum(plus for plus, _ in per_file.values()),
        deleted=sum(minus for _, minus in per_file.values()),
        files=sorted(per_file),
    )
    return moved, per_file


def _utc(seconds: float) -> datetime:
    """A Unix time as a UTC datetime.

    Args:
        seconds: Unix seconds.

    Returns:
        The aware datetime.
    """
    return datetime.fromtimestamp(seconds, tz=UTC)
