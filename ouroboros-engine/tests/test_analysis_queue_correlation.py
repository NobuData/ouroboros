"""The queue-correlation analyzer — the pool-move finding (#512)."""

from datetime import date

import pytest

from analysis_pattern_fixtures import TO, corpus, instant, job
from analysis_patterns_golden import mockup_corpus, uid
from ouroboros_engine.analysis.contract import EvidenceKind, Finding
from ouroboros_engine.analysis.patterns.queue_correlation import (
    PARAMETERS,
    QueueCorrelationAnalyzer,
    observed_days,
)


@pytest.fixture(scope="module")
def mockup() -> Finding:
    (finding,) = QueueCorrelationAnalyzer().analyze(mockup_corpus())
    return finding


def test_pool_a_waits_on_11_of_14_weekdays_while_pool_b_idles_82_percent(
    mockup: Finding,
) -> None:
    data = mockup.data
    assert mockup.subject_key == "pool-a@14:00-16:00"
    assert data["window"] == {"from": "14:00", "to": "16:00"}
    assert (data["days_exceeded"], data["days_observed"]) == (11, 14)
    assert data["idle_share"] == 0.82
    assert (data["pool"], data["idle_pool"]) == ("pool-a", "pool-b")
    kinds = [r.kind for r in mockup.evidence_refs]
    assert kinds[:2] == [EvidenceKind.RUNNER_POOL] * 2
    assert kinds.count(EvidenceKind.RUNNER) == 2
    assert kinds.count(EvidenceKind.BUILD) == 11


def test_the_observed_days_are_the_last_weekdays() -> None:
    days = observed_days(date(2026, 8, 7))
    assert len(days) == PARAMETERS["days_observed"]
    assert all(d.weekday() < 5 for d in days)
    assert days[-1] == date(2026, 8, 7) and days == sorted(days)


def _queue(idle_busy_seconds: int) -> list[dict]:
    """Pool 1 waits 10 minutes at 09:10 every observed day; pool 2 runs for a while."""
    rows = []
    n = 0
    for on in observed_days(TO):
        n += 1
        rows.append(job(n, queued=instant(on, 9, 10), pool=1, wait=600))
        n += 1
        rows.append(
            job(n, queued=instant(on, 8), pool=2, wait=0, seconds=idle_busy_seconds)
        )
    return rows


def _pools() -> list[dict]:
    return [
        {"pool_id": uid("pool", 1), "name": "a", "runner_ids": [uid("runner", 1)]},
        {"pool_id": uid("pool", 2), "name": "b", "runner_ids": [uid("runner", 2)]},
    ]


def test_the_window_holding_the_backlog_wins_a_tie() -> None:
    (finding,) = QueueCorrelationAnalyzer().analyze(
        corpus(jobs=_queue(600), pools=_pools())
    )
    # 08:00-10:00 and 09:00-11:00 both see every day exceeded; the earlier wins the tie of
    # equal over-threshold jobs.
    assert finding.data["window"] == {"from": "08:00", "to": "10:00"}
    assert finding.data["days_exceeded"] == 14


def test_a_busy_neighbour_is_not_an_idle_one() -> None:
    # Pool b busy the whole window: a capacity problem, not a placement one.
    assert (
        QueueCorrelationAnalyzer().analyze(corpus(jobs=_queue(7200), pools=_pools()))
        == []
    )


def test_a_queue_under_the_threshold_is_not_starved() -> None:
    rows = [
        {**row, "started_at": row["queued_at"]}
        if row["pool_id"] == uid("pool", 1)
        else row
        for row in _queue(60)
    ]
    assert QueueCorrelationAnalyzer().analyze(corpus(jobs=rows, pools=_pools())) == []


def test_a_pool_without_runners_is_never_the_idle_pool() -> None:
    pools = _pools()
    pools[1]["runner_ids"] = []
    assert (
        QueueCorrelationAnalyzer().analyze(corpus(jobs=_queue(60), pools=pools)) == []
    )
