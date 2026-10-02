"""The cache-window analyzer — the cache going cold after a class of merge (mockup 18).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). It produces the ccache re-warm
suggestion's evidence, *"78%→31% for ~6h after each deps refresh (14 occurrences)"*, and the
insights page's *"failures cluster on deps-refresh days"* line (BK.5,
`#446 <https://github.com/NobuData/ouroboros/issues/446>`_) — the second from the same finding,
with no second computation.

**Merges.** A merge is the first job (by ``queued_at``, then id) of each commit built on
``main_ref``; its ``title`` is the commit title. Each ``merge_classes`` entry is a class name
and a regex over that title (v1: ``deps-refresh merge`` = ``^deps: refresh``). A class with fewer
than ``min_occurrences`` merges is not a pattern.

**Hit rates are pooled.** A build's objects are its ccache ``hits + misses``. A cached build is
*in a window* when it queued within ``[merge, merge + window_hours)`` of one of the class's
merges. ``hit_rate_after`` is the windows' builds' hits over their objects; ``hit_rate_before``
the same over every other cached build — pooled, so a build with ten objects does not count as
much as one with a thousand. A finding needs ``before - after >= min_drop``.

**Recovery.** For each merge, the hours until the first cached build queued after it (within
``recovery_horizon_hours``) whose own hit rate is back within ``recovery_tolerance`` of
``hit_rate_before``; ``recovery_hours_median`` is their median (``null`` when none recovered).

**The insights line (#446).** ``trigger_days`` are the merges' UTC days; ``failure_rate_trigger_days``
and ``failure_rate_other_days`` are failed (or retried) jobs over all jobs on those days and on
every other day; ``failures_cluster`` is true when the first is at least
``failure_cluster_ratio`` times the second (or the second is 0 and the first is not). BK.5 renders
its line exactly when this is true.

**Confidence** is ``100 * stability * min(1, occurrences / (2 * min_occurrences)) *
min(1, drop / (2 * min_drop))``, where ``stability`` is the share of merges whose own window
rate sits below the midpoint of the two rates. ``sample_size`` is the cached builds.
"""

import re
import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, ClassVar

from ouroboros_engine.analysis.common import round_half, sampling_note, utc
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
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "main_ref": "refs/heads/main",
    "merge_classes": {"deps-refresh merge": "^deps: refresh"},
    "window_hours": 6,
    "min_occurrences": 3,
    "min_drop": 0.2,
    "recovery_tolerance": 0.05,
    "recovery_horizon_hours": 24,
    "failure_cluster_ratio": 1.5,
}

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "cache_window v1: pooled hit rate inside each trigger's window against the rest; "
    "100 * stability * min(1, occurrences / 6) * min(1, drop / 0.4)"
)

_FAILED = frozenset({"failed", "retried"})


@dataclass(frozen=True)
class _Merge:
    """The first build of one merged commit."""

    sha: str
    at: datetime
    title: str


@dataclass(frozen=True)
class _Cached:
    """One cached build: when it queued, and its counters."""

    at: datetime
    hits: int
    objects: int


class CacheWindowAnalyzer(Analyzer):
    """Hit-rate drops in the hours after a class of merge, with the failure-day split."""

    id: ClassVar[str] = "cache_window"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {
            CorpusRequirement(source=CorpusSource.JOBS, grain=Grain.BUILD),
            CorpusRequirement(source=CorpusSource.CACHE, grain=Grain.BUILD),
        }
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Measure each merge class's post-merge cache window.

        Args:
            corpus: A corpus carrying ``jobs`` and ``cache``.

        Returns:
            One ``cache_window`` finding per merge class whose window drops the hit rate by
            at least ``min_drop``, in class-name order.
        """
        jobs = sorted(corpus.jobs or [], key=lambda j: (utc(j.queued_at), j.build_id))
        merges = _merges(jobs)
        cached = _cached(jobs, corpus)
        sampling = sampling_note(corpus, [CorpusSource.JOBS, CorpusSource.CACHE])
        findings = []
        for name, pattern in sorted(PARAMETERS["merge_classes"].items()):
            matcher = re.compile(pattern)
            members = [m for m in merges if matcher.search(m.title)]
            if len(members) < PARAMETERS["min_occurrences"] or not cached:
                continue
            finding = _finding(name, pattern, members, cached, jobs, sampling)
            if finding is not None:
                findings.append(finding)
        return findings


def _merges(jobs: list[BuildJob]) -> list[_Merge]:
    """The first main-branch build of each commit that carries a title.

    Args:
        jobs: The corpus's jobs, in queue order.

    Returns:
        One merge per commit, in time order.
    """
    first: dict[str, _Merge] = {}
    for job in jobs:
        if job.git_ref != PARAMETERS["main_ref"] or job.title is None:
            continue
        if job.commit_sha not in first:
            first[job.commit_sha] = _Merge(
                job.commit_sha, utc(job.queued_at), job.title
            )
    return sorted(first.values(), key=lambda m: (m.at, m.sha))


def _cached(jobs: list[BuildJob], corpus: Corpus) -> list[_Cached]:
    """Join each build's cache counters to its queue time.

    Args:
        jobs: The corpus's jobs, in queue order.
        corpus: The corpus, for its ``cache`` source.

    Returns:
        The cached builds with at least one object, in queue order.
    """
    stats = {stat.build_id: stat for stat in corpus.cache or []}
    cached = []
    for job in jobs:
        stat = stats.get(job.build_id)
        if stat is None or stat.hits + stat.misses == 0:
            continue
        cached.append(_Cached(utc(job.queued_at), stat.hits, stat.hits + stat.misses))
    return cached


def _rate(builds: list[_Cached]) -> float | None:
    """Pooled hit rate.

    Args:
        builds: Cached builds.

    Returns:
        Hits over objects, or ``None`` for no builds.
    """
    objects = sum(b.objects for b in builds)
    return sum(b.hits for b in builds) / objects if objects else None


def _finding(
    name: str,
    pattern: str,
    merges: list[_Merge],
    cached: list[_Cached],
    jobs: list[BuildJob],
    sampling: dict[str, Any],
) -> Finding | None:
    """Build one merge class's finding, or nothing when its window shows no drop.

    Args:
        name: The class name.
        pattern: Its title regex.
        merges: The class's merges, in time order.
        cached: Every cached build, in queue order.
        jobs: Every job, for the failure-day split.
        sampling: The jobs and cache sources' sampling note.

    Returns:
        The finding, or ``None``.
    """
    window = timedelta(hours=PARAMETERS["window_hours"])
    windows = [(m.at, m.at + window) for m in merges]
    inside = [b for b in cached if any(a <= b.at < z for a, z in windows)]
    outside = [b for b in cached if not any(a <= b.at < z for a, z in windows)]
    before, after = _rate(outside), _rate(inside)
    if before is None or after is None:
        return None
    drop = before - after
    if drop < PARAMETERS["min_drop"]:
        return None

    midpoint = (before + after) / 2
    consistent = 0
    for start, end in windows:
        own = _rate([b for b in cached if start <= b.at < end])
        consistent += own is not None and own < midpoint
    stability = consistent / len(merges)
    recovery = _recovery_median(merges, cached, before)
    split = _failure_split(merges, jobs)

    occurrences = len(merges)
    score = (
        100
        * stability
        * min(1.0, occurrences / (2 * PARAMETERS["min_occurrences"]))
        * min(1.0, drop / (2 * PARAMETERS["min_drop"]))
    )
    return Finding(
        analyzer=CacheWindowAnalyzer.id,
        analyzer_version=CacheWindowAnalyzer.version,
        finding_type="cache_window",
        subject_key=name,
        data={
            "trigger": name,
            "trigger_pattern": pattern,
            "hit_rate_before": round_half(before, 2),
            "hit_rate_after": round_half(after, 2),
            "window_hours": PARAMETERS["window_hours"],
            "occurrences": occurrences,
            "builds_in_window": len(inside),
            "share": round_half(len(inside) / len(cached), 2),
            "recovery_hours_median": recovery,
            **split,
            "sampling": sampling,
        },
        evidence_refs=[EvidenceRef(kind=EvidenceKind.MERGE, id=m.sha) for m in merges],
        confidence=int(round_half(score, 0)),
        confidence_basis=ConfidenceBasis(
            method=CONFIDENCE_METHOD,
            sample_size=len(cached),
            effect_size=round_half(drop, 3),
            stability=round_half(stability, 3),
        ),
    )


def _recovery_median(
    merges: list[_Merge], cached: list[_Cached], before: float
) -> float | None:
    """The median hours until a build's own hit rate is back near the usual rate.

    Args:
        merges: The class's merges.
        cached: Every cached build, in queue order.
        before: The usual (outside-window) rate.

    Returns:
        The median recovery in hours to one place, or ``None`` when no merge recovered
        within the horizon.
    """
    horizon = timedelta(hours=PARAMETERS["recovery_horizon_hours"])
    target = before - PARAMETERS["recovery_tolerance"]
    hours = []
    for merge in merges:
        for build in cached:
            if (
                merge.at <= build.at < merge.at + horizon
                and build.hits / build.objects >= target
            ):
                hours.append((build.at - merge.at).total_seconds() / 3600)
                break
    return round_half(statistics.median(hours), 1) if hours else None


def _failure_split(merges: list[_Merge], jobs: list[BuildJob]) -> dict[str, Any]:
    """Failure rates on the merges' days against every other day — BK.5's line (#446).

    Args:
        merges: The class's merges.
        jobs: Every job.

    Returns:
        ``trigger_days``, ``failure_rate_trigger_days``, ``failure_rate_other_days`` and
        ``failures_cluster``.
    """
    days: set[date] = {m.at.date() for m in merges}
    on = [j for j in jobs if j.day in days]
    off = [j for j in jobs if j.day not in days]
    rate_on = sum(j.status in _FAILED for j in on) / len(on) if on else 0.0
    rate_off = sum(j.status in _FAILED for j in off) / len(off) if off else 0.0
    if rate_off > 0:
        clusters = rate_on >= PARAMETERS["failure_cluster_ratio"] * rate_off
    else:
        clusters = rate_on > 0
    return {
        "trigger_days": [day.isoformat() for day in sorted(days)],
        "failure_rate_trigger_days": round_half(rate_on, 3),
        "failure_rate_other_days": round_half(rate_off, 3),
        "failures_cluster": clusters,
    }
