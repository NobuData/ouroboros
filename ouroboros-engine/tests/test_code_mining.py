"""Blame, history, changed-between and the bisect line over the seeded fixture (CL.4, #617).

The acceptance criteria this suite holds: blame, history and changed-between are green over a
seeded repository, with dates that reproduce the brief's *"unchanged in 14 months"* from data,
and every answer names the commit it was read at, so re-running it gives the same answer.
"""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest

from code_fixtures import SeededRepo, build_repo
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.code.contract import CloneInfo
from ouroboros_engine.code.mining import (
    MAX_BLAME_LINES,
    NotAncestorError,
    RangeOutsideFileError,
    RangeTooWideError,
    age,
    bisect_commits,
    blame,
    changed_between,
    history,
    line_delta,
    max_steps,
)
from ouroboros_engine.code.repo import PathNotFoundError, ReadOnlyRepo, RefNotFoundError

WORKSPACE = "5eed0617-0000-4000-8000-000000000001"
CLONE = CloneInfo(
    repository="acme/helios-firmware",
    fetched_at=datetime(2026, 10, 9, tzinfo=UTC),
    stale=False,
)


@pytest.fixture(scope="module")
def seeded(tmp_path_factory: pytest.TempPathFactory) -> SeededRepo:
    """The fixture repository — the remote."""
    return build_repo(tmp_path_factory.mktemp("remote") / "helios-firmware.git")


@pytest.fixture(scope="module")
def repo(
    seeded: SeededRepo, tmp_path_factory: pytest.TempPathFactory
) -> Iterator[ReadOnlyRepo]:
    """A clone of it, opened read-only — what an operation is handed."""
    store = CloneStore(tmp_path_factory.mktemp("clones"), allow_local=True)
    opened = store.open(
        RepositoryRef(WORKSPACE, "acme/helios-firmware", str(seeded.path))
    )
    yield opened.repo
    opened.repo.close()


# ---------------------------------------------------------------------------
# blame
# ---------------------------------------------------------------------------


def test_blame_reproduces_the_briefs_unchanged_in_14_months(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 200, 230)

    assert answer.sha == seeded.sha("c7")
    assert answer.unchanged.phrase == "unchanged in 14 months"
    assert answer.unchanged.months == 14
    assert answer.last_change.sha == seeded.sha("c0")
    assert answer.last_change.summary == "Tune approach controller gains"
    assert answer.last_change.author == "Ana Ortiz"  # the name, never the address
    assert answer.as_of == datetime(2026, 8, 15, 12, tzinfo=UTC)
    assert [(h.start, h.end) for h in answer.hunks] == [(200, 230)]
    assert (
        answer.lines[14]
        == "static const float approach_kp = 1.40f; /* tuned 2025-06 */"
    )


def test_blame_splits_a_range_by_the_commit_that_last_changed_each_line(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 10, 14)

    assert [(h.start, h.end, h.commit.sha) for h in answer.hunks] == [
        (10, 11, seeded.sha("c0")),
        (12, 12, seeded.sha("c2")),
        (13, 14, seeded.sha("c0")),
    ]
    assert answer.last_change.sha == seeded.sha("c2")
    assert answer.unchanged.phrase == "unchanged in 8 months"


def test_blame_is_the_same_answer_every_time_it_is_re_run(repo: ReadOnlyRepo) -> None:
    first = blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 200, 230)
    again = blame(repo, CLONE, first.sha, "src/dock/dock_ctrl.c", 200, 230)

    assert again.model_dump(exclude={"ref"}) == first.model_dump(exclude={"ref"})


def test_blame_reads_at_an_abbreviated_id_and_an_annotated_tag(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    by_prefix = blame(repo, CLONE, seeded.sha("c1")[:7], "src/dock/dock_ctrl.c", 1, 1)
    by_tag = blame(repo, CLONE, "v2.0.4", "src/dock/dock_ctrl.c", 1, 1)

    assert by_prefix.sha == by_tag.sha == seeded.sha("c1")


def test_blame_clamps_the_end_to_the_file(repo: ReadOnlyRepo) -> None:
    answer = blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 299, 400)

    assert (answer.start, answer.end) == (299, 300)


def test_blame_refuses_a_start_past_the_end_of_the_file(repo: ReadOnlyRepo) -> None:
    with pytest.raises(RangeOutsideFileError) as raised:
        blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 301, 310)

    assert raised.value.length == 300


def test_blame_refuses_a_range_wider_than_its_bound(repo: ReadOnlyRepo) -> None:
    with pytest.raises(RangeTooWideError):
        blame(repo, CLONE, "nightly", "src/dock/dock_ctrl.c", 1, MAX_BLAME_LINES + 1)


def test_blame_names_a_missing_file_and_a_missing_ref(repo: ReadOnlyRepo) -> None:
    with pytest.raises(PathNotFoundError):
        blame(repo, CLONE, "nightly", "src/dock/nope.c", 1, 2)
    with pytest.raises(RefNotFoundError):
        blame(repo, CLONE, "no-such-branch", "src/dock/dock_ctrl.c", 1, 2)


@pytest.mark.parametrize("ref", ["main~1", "v2.0.4..nightly", "-x", "a//b", "HEAD@{1}"])
def test_revision_syntax_is_not_a_ref(repo: ReadOnlyRepo, ref: str) -> None:
    with pytest.raises(RefNotFoundError):
        repo.resolve(ref)


# ---------------------------------------------------------------------------
# age
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("changed", "measured", "phrase"),
    [
        ("2025-06-02T12:00", "2026-08-15T12:00", "unchanged in 14 months"),
        ("2025-06-20T12:00", "2026-08-15T12:00", "unchanged in 13 months"),
        ("2026-07-15T12:00", "2026-08-15T12:00", "unchanged in 1 month"),
        ("2026-08-06T12:00", "2026-08-15T12:00", "unchanged in 9 days"),
        ("2026-08-14T12:00", "2026-08-15T12:00", "unchanged in 1 day"),
        ("2026-08-15T08:00", "2026-08-15T12:00", "changed the same day"),
        ("2023-08-15T12:00", "2026-08-15T12:00", "unchanged in 3 years"),
    ],
)
def test_age_says_it_as_the_brief_does(
    changed: str, measured: str, phrase: str
) -> None:
    def at(text: str) -> datetime:
        return datetime.fromisoformat(text).replace(tzinfo=UTC)

    assert age(at(changed), at(measured)).phrase == phrase


# ---------------------------------------------------------------------------
# history
# ---------------------------------------------------------------------------


def test_history_counts_changes_and_churn_over_the_window(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = history(
        repo, CLONE, "nightly", path="src/motor/pid.c", symbol=None, window_days=180
    )

    assert [c.commit.sha for c in answer.commits] == [
        seeded.sha("c6"),
        seeded.sha("c4"),
        seeded.sha("c3"),
    ]
    assert answer.total_commits == 3
    assert (answer.added, answer.deleted) == (3, 1)
    assert answer.authors == 2
    assert answer.per_month == 0.5
    assert answer.until == datetime(2026, 8, 15, 12, tzinfo=UTC)
    assert answer.truncated is False


def test_history_window_ends_at_the_refs_commit_not_the_clock(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = history(
        repo, CLONE, "nightly", path="src/motor/pid.c", symbol=None, window_days=60
    )

    assert [c.commit.sha for c in answer.commits] == [seeded.sha("c6")]


def test_history_traces_a_symbol_by_the_commits_that_change_its_count(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = history(
        repo, CLONE, "nightly", path=None, symbol="approach_kp", window_days=3650
    )

    assert [c.commit.sha for c in answer.commits] == [
        seeded.sha("c4"),
        seeded.sha("c0"),
    ]
    assert answer.commits[0].files == ["src/motor/pid.c"]


def test_history_names_a_path_that_is_not_there(repo: ReadOnlyRepo) -> None:
    with pytest.raises(PathNotFoundError):
        history(repo, CLONE, "nightly", path="src/gone", symbol=None, window_days=30)


# ---------------------------------------------------------------------------
# changed_between
# ---------------------------------------------------------------------------


def test_changed_between_lists_what_moved_in_scope(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = changed_between(repo, CLONE, "v2.0.4", "nightly", "src/motor")

    assert answer.base_sha == seeded.sha("c1")
    assert answer.head_sha == seeded.sha("c7")
    assert [c.commit.sha for c in answer.commits] == [
        seeded.sha("c6"),
        seeded.sha("c4"),
        seeded.sha("c3"),
    ]
    assert [(f.path, f.commits, f.added, f.deleted) for f in answer.files] == [
        ("src/motor/pid.c", 3, 3, 1)
    ]


def test_changed_between_without_a_scope_is_the_whole_tree(repo: ReadOnlyRepo) -> None:
    answer = changed_between(repo, CLONE, "v2.0.4", "nightly", None)

    assert answer.total_commits == 6
    assert {f.path for f in answer.files} == {
        "src/motor/pid.c",
        "src/dock/dock_ctrl.c",
        "docs/motor.md",
        "VERSION",
    }


# ---------------------------------------------------------------------------
# bisect_commits
# ---------------------------------------------------------------------------


def test_the_bisect_line_runs_from_after_good_to_bad(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    answer = bisect_commits(repo, CLONE, "v2.0.4", "nightly")

    assert answer.commits == [seeded.sha(f"c{n}") for n in range(2, 8)]
    assert answer.good_sha == seeded.sha("c1")
    assert answer.bad_sha == seeded.sha("c7")
    assert answer.max_steps == 3  # ⌊log₂ 6⌋ + 1
    assert answer.bad_ref_name == "refs/heads/nightly"
    assert bisect_commits(repo, CLONE, "v2.0.4", seeded.sha("c7")).bad_ref_name is None


def test_a_good_that_is_not_an_ancestor_is_refused(repo: ReadOnlyRepo) -> None:
    with pytest.raises(NotAncestorError):
        bisect_commits(repo, CLONE, "nightly", "v2.0.4")
    with pytest.raises(NotAncestorError):
        bisect_commits(repo, CLONE, "nightly", "nightly")


@pytest.mark.parametrize(
    ("candidates", "steps"), [(1, 1), (2, 2), (3, 2), (6, 3), (8, 4), (300, 9)]
)
def test_the_step_bound_is_floor_log2_plus_one(candidates: int, steps: int) -> None:
    assert max_steps(candidates) == steps


# ---------------------------------------------------------------------------
# line_delta
# ---------------------------------------------------------------------------


def test_line_delta_counts_like_numstat() -> None:
    assert line_delta(b"a\nb\nc\n", b"a\nB\nc\nd\n") == (2, 1)
    assert line_delta(b"", b"x\ny\n") == (2, 0)


def test_binary_and_oversized_files_count_no_lines() -> None:
    assert line_delta(b"\0\1", b"\0\2") == (0, 0)
    assert line_delta(b"x" * 2_000_000, b"y") == (0, 0)


def test_long_files_fall_back_to_the_multiset_difference() -> None:
    before = b"".join(f"{n}\n".encode() for n in range(6000))
    after = before + b"new\n"

    assert line_delta(before, after) == (1, 0)
