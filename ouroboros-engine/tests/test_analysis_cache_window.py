"""The cache-window analyzer — the re-warm numbers and BK.5's cluster line (#512)."""

from datetime import timedelta

import pytest

from analysis_pattern_fixtures import FROM, corpus, instant, job
from analysis_patterns_golden import mockup_corpus, uid
from ouroboros_engine.analysis.contract import Corpus, EvidenceKind, Finding
from ouroboros_engine.analysis.patterns.cache_window import (
    PARAMETERS,
    CacheWindowAnalyzer,
)

MAIN = PARAMETERS["main_ref"]


@pytest.fixture(scope="module")
def mockup() -> Finding:
    (finding,) = CacheWindowAnalyzer().analyze(mockup_corpus())
    return finding


def test_the_cache_drops_from_78_to_31_percent_after_14_deps_refreshes(
    mockup: Finding,
) -> None:
    data = mockup.data
    assert mockup.subject_key == "deps-refresh merge"
    assert (data["hit_rate_before"], data["hit_rate_after"]) == (0.78, 0.31)
    assert (data["window_hours"], data["occurrences"]) == (6, 14)
    assert data["share"] == 0.19 and data["builds_in_window"] == 154
    assert data["recovery_hours_median"] == 6.0
    assert [r.kind for r in mockup.evidence_refs] == [EvidenceKind.MERGE] * 14


def test_the_finding_alone_renders_the_insights_cluster_line(mockup: Finding) -> None:
    # #446 renders "Failures cluster on deps-refresh days" from these fields and nothing else.
    data = mockup.data
    assert data["failures_cluster"] is True
    assert len(data["trigger_days"]) == 14
    assert data["failure_rate_trigger_days"] > (
        PARAMETERS["failure_cluster_ratio"] * data["failure_rate_other_days"]
    )


def _refreshes(count: int, after: tuple[int, int], *, fail: bool = False) -> Corpus:
    """``count`` refresh merges, each with two builds in its window at the given counters."""
    jobs, cache = [], []
    n = 0
    for k in range(count):
        on = FROM + timedelta(days=2 * k)
        rows = [
            (instant(on, 8), "deps: refresh west manifest", MAIN, after, "succeeded"),
            (
                instant(on, 9),
                None,
                "refs/heads/pr",
                after,
                "failed" if fail else "succeeded",
            ),
            (instant(on, 18), None, "refs/heads/pr", (80, 20), "succeeded"),
            (
                instant(on + timedelta(days=1), 12),
                None,
                "refs/heads/pr",
                (80, 20),
                "succeeded",
            ),
        ]
        for queued, title, ref, (hits, misses), status in rows:
            n += 1
            jobs.append(job(n, queued=queued, title=title, ref=ref, status=status))
            cache.append(
                {
                    "build_id": uid("job", n),
                    "day": jobs[-1]["day"],
                    "hits": hits,
                    "misses": misses,
                }
            )
    return corpus(jobs=jobs, cache=cache)


def test_a_planted_drop_is_found_with_its_rates() -> None:
    (finding,) = CacheWindowAnalyzer().analyze(_refreshes(3, (30, 70), fail=True))

    assert (finding.data["hit_rate_before"], finding.data["hit_rate_after"]) == (
        0.8,
        0.3,
    )
    assert finding.data["occurrences"] == 3
    assert finding.data["recovery_hours_median"] == 10.0
    assert finding.data["failures_cluster"] is True
    assert finding.data["failure_rate_other_days"] == 0.0


def test_too_few_occurrences_are_not_a_pattern() -> None:
    assert CacheWindowAnalyzer().analyze(_refreshes(2, (30, 70))) == []


def test_no_drop_is_no_finding() -> None:
    assert CacheWindowAnalyzer().analyze(_refreshes(4, (75, 25))) == []


def test_failures_that_do_not_cluster_say_so() -> None:
    (finding,) = CacheWindowAnalyzer().analyze(_refreshes(3, (30, 70)))
    assert finding.data["failures_cluster"] is False
    assert finding.data["failure_rate_trigger_days"] == 0.0


def test_no_cached_builds_finds_nothing() -> None:
    assert CacheWindowAnalyzer().analyze(corpus(jobs=[], cache=[])) == []


def test_the_finding_carries_the_composers_measured_inputs(mockup: Finding) -> None:
    # BV.4 (#513) composes the re-warm impact from these, never from a guess.
    assert mockup.data["slowdown_seconds"] == 168
    assert mockup.data["trigger_title"] == "deps: refresh west manifest"
    assert mockup.data["pool_id"] == uid("pool", 1)


def test_no_comparable_builds_leaves_the_slowdown_unknown() -> None:
    # Every cached build is inside a window: nothing to compare against.
    jobs, cache = [], []
    for k in range(3):
        on = FROM + timedelta(days=k)
        jobs.append(
            job(k + 1, queued=instant(on, 8), title="deps: refresh x", ref=MAIN)
        )
        cache.append(
            {
                "build_id": uid("job", k + 1),
                "day": jobs[-1]["day"],
                "hits": 1,
                "misses": 9,
            }
        )
    jobs.append(job(9, queued=instant(FROM, 20), label="other"))
    cache.append(
        {"build_id": uid("job", 9), "day": jobs[-1]["day"], "hits": 9, "misses": 1}
    )
    (finding,) = CacheWindowAnalyzer().analyze(corpus(jobs=jobs, cache=cache))
    assert finding.data["slowdown_seconds"] is None
