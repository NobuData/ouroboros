"""The queue-correlation analyzer — one pool starved while another sits idle (mockup 18).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). It produces the pool-move
finding: *"pool-a queue > 5 min 14:00-16:00 on 11 of the last 14 weekdays; pool-b idle 82% of
that window"*.

**Days.** The last ``days_observed`` days up to the corpus window's end — weekdays only when
``weekdays_only`` — so "the last 14 weekdays" means the same thing on every run of the same
corpus. All times are UTC.

**The starved pool.** For each pool and each hour-aligned window of ``window_hours`` (00:00-02:00,
01:00-03:00, … 22:00-00:00), a day is *exceeded* when the longest queue wait (``started_at -
queued_at``) of the pool's jobs queued inside the window that day is over
``threshold_seconds``. The pool's window is the one with the most exceeded days; on a tie, the
one holding the most over-threshold jobs (a window that only clips the backlog's edge loses to
the one that contains it), then the earliest. It is a candidate when its exceeded days are at
least ``min_days_exceeded``.

**The idle pool.** For every other pool with runners, its idle share over the same window on the
same days is ``1 - busy / capacity``: ``busy`` the seconds its jobs ran inside the window
(``[started_at, finished_at)`` clipped to it), ``capacity`` its runners * the window * the days.
The idlest pool (by name on a tie) makes it a finding when its idle share is at least
``min_idle_share`` — a starved pool beside a busy one is a capacity problem, not a placement one.

**Confidence** is ``100 * (days_exceeded / days_observed + idle_share) / 2``, rounded.
``sample_size`` is the starved pool's jobs inside the window over the days.

Evidence: both pools, the idle pool's runners, and each exceeded day's longest-waiting build.

**Measured inputs (BV.4, #513).** ``queue_p95_seconds`` — the nearest-rank p95 of each observed
day's longest wait in the window; ``wait_reduction_seconds`` — the p95 of the exceeded days'
longest waits, the saving if a moved runner absorbed that backlog (an extrapolation, and the
composer labels it so); ``move_runner_id`` — the runner the move names: the idle pool's first by
id, since jobs record pools, not runners; ``pool_id`` / ``idle_pool_id``.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, ClassVar

from ouroboros_engine.analysis.common import (
    build_ref,
    distinct_refs,
    round_half,
    sampling_note,
    utc,
)
from ouroboros_engine.analysis.contract import (
    BuildJob,
    ConfidenceBasis,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    EvidenceKind,
    EvidenceRef,
    Finding,
    Grain,
    RunnerPool,
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "metric": "queue_wait",
    "window_hours": 2,
    "days_observed": 14,
    "weekdays_only": True,
    "threshold_seconds": 300,
    "min_days_exceeded": 7,
    "min_idle_share": 0.5,
    "max_evidence": 200,
}

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "queue_correlation v1: days whose longest wait in the window crossed the threshold, "
    "against the other pool's idle share; 100 * (days_exceeded / days_observed + idle) / 2"
)


@dataclass(frozen=True)
class _Starved:
    """A pool's worst window."""

    pool: RunnerPool
    hour: int
    exceeded: list[tuple[date, BuildJob]]
    over_threshold: int
    jobs_in_window: int
    daily_longest: list[float]


class QueueCorrelationAnalyzer(Analyzer):
    """Pools whose queue backs up in a daily window while another pool idles."""

    id: ClassVar[str] = "queue_correlation"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {
            CorpusRequirement(source=CorpusSource.JOBS, grain=Grain.BUILD),
            CorpusRequirement(source=CorpusSource.POOLS, grain=Grain.POOL),
        }
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Find starved pools with an idle neighbour.

        Args:
            corpus: A corpus carrying ``jobs`` and ``pools``.

        Returns:
            One ``queue_correlation`` finding per starved pool, in pool-name order.
        """
        days = observed_days(corpus.window.to)
        pools = sorted(corpus.pools or [], key=lambda p: (p.name, p.pool_id))
        by_pool: dict[str, list[BuildJob]] = defaultdict(list)
        for job in sorted(corpus.jobs or [], key=lambda j: j.build_id):
            if job.pool_id is not None:
                by_pool[job.pool_id].append(job)
        sampling = sampling_note(corpus, [CorpusSource.JOBS])

        findings = []
        for pool in pools:
            starved = _starved(pool, by_pool[pool.pool_id], days)
            if starved is None:
                continue
            idle = _idlest(pool, pools, by_pool, days, starved.hour)
            if idle is None:
                continue
            findings.append(_finding(starved, idle[0], idle[1], days, sampling))
        return findings


def observed_days(last: date) -> list[date]:
    """The days the analyzer observes, oldest first.

    Args:
        last: The corpus window's last day.

    Returns:
        The last ``days_observed`` days up to ``last`` — weekdays only when configured.
    """
    days: list[date] = []
    day = last
    while len(days) < PARAMETERS["days_observed"]:
        if not PARAMETERS["weekdays_only"] or day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    return sorted(days)


def _bounds(day: date, hour: int) -> tuple[datetime, datetime]:
    """One day's window as UTC instants.

    Args:
        day: The day.
        hour: The window's opening hour.

    Returns:
        ``[opens, closes)``.
    """
    opens = datetime.combine(day, time(hour), tzinfo=UTC)
    return opens, opens + timedelta(hours=PARAMETERS["window_hours"])


def _starved(
    pool: RunnerPool, jobs: list[BuildJob], days: list[date]
) -> _Starved | None:
    """The pool's worst window, if it is exceeded on enough days.

    Args:
        pool: The pool.
        jobs: Its jobs.
        days: The observed days.

    Returns:
        The window and its exceeded days, or ``None``.
    """
    started = [j for j in jobs if j.started_at is not None]
    best: _Starved | None = None
    for hour in range(24 - PARAMETERS["window_hours"] + 1):
        exceeded: list[tuple[date, BuildJob]] = []
        daily: list[float] = []
        inside = over = 0
        for day in days:
            opens, closes = _bounds(day, hour)
            queued = [j for j in started if opens <= utc(j.queued_at) < closes]
            inside += len(queued)
            over += sum(_wait(j) > PARAMETERS["threshold_seconds"] for j in queued)
            if not queued:
                continue
            longest = min(queued, key=lambda j: (-_wait(j), j.build_id))
            daily.append(_wait(longest))
            if _wait(longest) > PARAMETERS["threshold_seconds"]:
                exceeded.append((day, longest))
        if best is None or (len(exceeded), over) > (
            len(best.exceeded),
            best.over_threshold,
        ):
            best = _Starved(pool, hour, exceeded, over, inside, daily)
    if best is None or len(best.exceeded) < PARAMETERS["min_days_exceeded"]:
        return None
    return best


def _wait(job: BuildJob) -> float:
    """A started job's queue wait.

    Args:
        job: A job.

    Returns:
        Seconds from queued to started; 0 for a job that never started (callers filter
        those out before asking).
    """
    if job.started_at is None:
        return 0.0
    return (job.started_at - job.queued_at).total_seconds()


def _idlest(
    starved: RunnerPool,
    pools: list[RunnerPool],
    by_pool: dict[str, list[BuildJob]],
    days: list[date],
    hour: int,
) -> tuple[RunnerPool, float] | None:
    """The idlest other pool over the starved window, if idle enough.

    Args:
        starved: The starved pool.
        pools: Every pool, in name order.
        by_pool: Each pool's jobs.
        days: The observed days.
        hour: The window's opening hour.

    Returns:
        The pool and its idle share, or ``None``.
    """
    seconds = PARAMETERS["window_hours"] * 3600
    best: tuple[RunnerPool, float] | None = None
    for pool in pools:
        if pool.pool_id == starved.pool_id or not pool.runner_ids:
            continue
        busy = 0.0
        for day in days:
            opens, closes = _bounds(day, hour)
            for job in by_pool[pool.pool_id]:
                if job.started_at is None:
                    continue
                start = max(utc(job.started_at), opens)
                end = min(utc(job.finished_at), closes)
                busy += max(0.0, (end - start).total_seconds())
        capacity = len(pool.runner_ids) * seconds * len(days)
        idle = min(1.0, max(0.0, 1 - busy / capacity))
        if best is None or idle > best[1]:
            best = (pool, idle)
    if best is None or best[1] < PARAMETERS["min_idle_share"]:
        return None
    return best


def p95(values: list[float]) -> float:
    """The nearest-rank 95th percentile.

    Args:
        values: At least one value.

    Returns:
        The value at rank ``ceil(0.95 * n)`` of the sorted values.
    """
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def _clock(hour: int) -> str:
    """An hour as ``HH:MM``, midnight as ``00:00``.

    Args:
        hour: 0-24.

    Returns:
        The clock text.
    """
    return f"{hour % 24:02d}:00"


def _finding(
    starved: _Starved,
    idle_pool: RunnerPool,
    idle: float,
    days: list[date],
    sampling: dict[str, Any],
) -> Finding:
    """Build the finding for one starved pool.

    Args:
        starved: The starved pool's window.
        idle_pool: The idlest other pool.
        idle: Its idle share.
        days: The observed days.
        sampling: The jobs source's sampling note.

    Returns:
        The finding.
    """
    opens = _clock(starved.hour)
    closes = _clock(starved.hour + PARAMETERS["window_hours"])
    exceeded = len(starved.exceeded)
    effect = exceeded / len(days)
    refs = distinct_refs(
        [
            EvidenceRef(kind=EvidenceKind.RUNNER_POOL, id=starved.pool.pool_id),
            EvidenceRef(kind=EvidenceKind.RUNNER_POOL, id=idle_pool.pool_id),
            *(
                EvidenceRef(kind=EvidenceKind.RUNNER, id=runner)
                for runner in sorted(idle_pool.runner_ids)
            ),
            *(build_ref(job.build_id) for _, job in starved.exceeded),
        ],
        PARAMETERS["max_evidence"],
    )
    return Finding(
        analyzer=QueueCorrelationAnalyzer.id,
        analyzer_version=QueueCorrelationAnalyzer.version,
        finding_type="queue_correlation",
        subject_key=f"{starved.pool.name}@{opens}-{closes}",
        data={
            "window": {"from": opens, "to": closes},
            "metric": PARAMETERS["metric"],
            "threshold_seconds": PARAMETERS["threshold_seconds"],
            "days_exceeded": exceeded,
            "days_observed": len(days),
            "idle_share": round_half(idle, 2),
            "pool": starved.pool.name,
            "idle_pool": idle_pool.name,
            "exceeded_days": [day.isoformat() for day, _ in starved.exceeded],
            "longest_wait_seconds": [
                round_half(_wait(job), 0) for _, job in starved.exceeded
            ],
            "queue_p95_seconds": round_half(p95(starved.daily_longest), 0),
            "wait_reduction_seconds": round_half(
                p95([_wait(job) for _, job in starved.exceeded]), 0
            ),
            "move_runner_id": min(idle_pool.runner_ids),
            "pool_id": starved.pool.pool_id,
            "idle_pool_id": idle_pool.pool_id,
            "sampling": sampling,
        },
        evidence_refs=refs,
        confidence=int(round_half(100 * (effect + idle) / 2, 0)),
        confidence_basis=ConfidenceBasis(
            method=CONFIDENCE_METHOD,
            sample_size=max(1, starved.jobs_in_window),
            effect_size=round_half(effect, 3),
            stability=round_half(idle, 3),
        ),
    )
