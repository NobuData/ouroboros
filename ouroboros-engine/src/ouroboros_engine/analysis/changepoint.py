"""The change-point analyzer — the duration chart's chips (mockup 18, option 1-A).

BV.2 (`#511 <https://github.com/NobuData/ouroboros/issues/511>`_). Three steps, each one a
documented rule a reviewer can argue with:

**1. Detect — PELT over daily medians.** Each UTC day's builds become one number, the day's
**median** duration: one pathological four-hour build must not create a phantom breakpoint,
and a mean would let it. ``ruptures``' PELT (``l2`` cost) then finds an unknown number of
breakpoints under the penalty

    pen = penalty_factor · sigma-hat² · ln(n)

where ``n`` is the number of observed days and sigma-hat is a robust noise estimate — 1.4826 * the
median absolute deviation of day-to-day differences, / √2, floored at ``min_noise_seconds``.
That is a BIC-style penalty scaled to the series' own noise, so a quiet farm and a noisy one
are held to the same standard. ``penalty_factor = 4`` was chosen on simulated 90-day series
(3-20 builds a day, sigma = 25 s per build, 5 % of days carrying a 3600 s outlier): about 1 %
of noise-only series showed any breakpoint, against about 3 % at 3 and 9 % at 2, with no
loss of the planted +90 s / -130 s / +40 s shifts. ``min_segment_days = 5`` is PELT's minimum
segment length: no shift lasting under five observed days is a change-point. Both are in
:data:`PARAMETERS`, pinned by the ledger — changing either means a new version.

**2. Measure — per-segment medians.** Each segment's level is the median of its daily
medians, and a breakpoint's delta is ``after - before``, in whole seconds: ``+90``, ``-130``,
``+40``.

**3. Attribute — a ranking, never a verdict.** Every corpus event within
``attribution_window_days`` (±3) of the breakpoint day is a candidate, scored

    score = proximity * prior,   proximity = 1 - |days from breakpoint| / (window + 1)

so the same day is 1.0, a day away 0.75, three days away 0.25; ``prior`` is the event kind's
documented plausibility (:data:`PARAMETERS` ``priors``). Candidates are emitted **ranked**,
best first, with every score component exposed. The chip names the top one; the Details sheet
shows them all, and a person who knows better can disagree. A breakpoint with no event in
reach is still a finding: its single candidate says so (``unattributed``, score 0, citing the
first build after the shift), because hiding a detected shift for want of an explanation is
the dishonest option.

**Confidence** is ``100 * stability * (1 - e^(-effect/2)) * coverage``, rounded:

* ``effect`` — |delta| / the within-segment noise of the two adjacent segments (1.4826 * the
  MAD of each day's distance from its segment's median, floored at ``min_noise_seconds``);
* ``stability`` — the share of days in the two segments that sit on their own segment's side
  of the midpoint between the two levels;
* ``coverage`` — min(1, shorter segment's days / (2 * ``min_segment_days``)), so a shift seen
  for five days is held below one seen for ten;
* ``sample_size`` — the builds in the two segments.
"""

import math
from collections import defaultdict
from datetime import date
from itertools import pairwise
from typing import Any, ClassVar

import numpy as np
import ruptures

from ouroboros_engine.analysis.common import round_half as _round
from ouroboros_engine.analysis.contract import (
    BuildSample,
    CandidateEvent,
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

#: The documented tuning. Pinned in the ledger: a change here without a version bump is
#: refused at registration.
PARAMETERS: dict[str, Any] = {
    "metric": "build.duration_median",
    "cost_model": "l2",
    "penalty_factor": 4,
    "min_segment_days": 5,
    "min_noise_seconds": 1.0,
    "attribution_window_days": 3,
    "max_candidates": 5,
    "priors": {
        "config_version": 0.8,
        "env_recipe_version": 0.8,
        "merge": 0.7,
        "infra_event": 0.6,
        "policy_version": 0.4,
    },
}

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "change_point v1: 100 * stability * (1 - e^(-effect/2)) * "
    "min(1, shorter segment days / (2 * min_segment_days))"
)

#: The label of the candidate a breakpoint with no event in reach carries.
UNATTRIBUTED_LABEL = "no recorded change within ±{window} days"

_MAD_TO_SIGMA = 1.4826


def _robust_sigma(values: np.ndarray, floor: float) -> float:
    """1.4826 * the median absolute deviation of ``values`` from their median, floored.

    Args:
        values: The values.
        floor: The smallest sigma returned.

    Returns:
        The robust standard deviation estimate.
    """
    if values.size == 0:
        return floor
    mad = float(np.median(np.abs(values - np.median(values))))
    return max(_MAD_TO_SIGMA * mad, floor)


class ChangePointAnalyzer(Analyzer):
    """Shifts in the daily median build duration, each with ranked candidate causes."""

    id: ClassVar[str] = "change_point"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {
            CorpusRequirement(source=CorpusSource.BUILDS, grain=Grain.BUILD),
            CorpusRequirement(source=CorpusSource.EVENTS, grain=Grain.EVENT),
        }
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Detect, measure and attribute every shift in the corpus's build durations.

        Args:
            corpus: A corpus carrying ``builds`` and ``events``.

        Returns:
            One ``change_point`` finding per breakpoint, in date order.
        """
        builds = corpus.builds or []
        events = corpus.events or []
        days, medians, by_day = _daily_medians(builds)
        breakpoints = _detect(medians)

        bounds = [0, *breakpoints, len(days)]
        levels = [
            float(np.median(medians[start:end])) for start, end in pairwise(bounds)
        ]

        findings = []
        for index, at in enumerate(breakpoints):
            before = (bounds[index], at)
            after = (at, bounds[index + 2])
            finding = _finding(
                days, medians, by_day, events, before, after, levels[index : index + 2]
            )
            if finding is not None:
                findings.append(finding)
        return findings


def _daily_medians(
    builds: list[BuildSample],
) -> tuple[list[date], np.ndarray, dict[date, list[BuildSample]]]:
    """Group builds by UTC day and take each day's median duration.

    Args:
        builds: The corpus's builds, in any order.

    Returns:
        The observed days in order, their medians, and each day's builds sorted by id.
    """
    by_day: dict[date, list[BuildSample]] = defaultdict(list)
    for build in builds:
        by_day[build.day].append(build)
    days = sorted(by_day)
    for day in days:
        by_day[day].sort(key=lambda b: b.build_id)
    medians = np.array(
        [float(np.median([b.duration_seconds for b in by_day[day]])) for day in days],
        dtype=float,
    )
    return days, medians, dict(by_day)


def _detect(medians: np.ndarray) -> list[int]:
    """Run PELT over the daily medians under the documented penalty.

    Args:
        medians: One value per observed day.

    Returns:
        The index of the first day of each new segment, ascending; empty for a series too
        short to hold two segments.
    """
    min_size = PARAMETERS["min_segment_days"]
    if medians.size < 2 * min_size:
        return []
    sigma = _robust_sigma(np.diff(medians), 0.0) / math.sqrt(2)
    sigma = max(sigma, PARAMETERS["min_noise_seconds"])
    penalty = PARAMETERS["penalty_factor"] * sigma**2 * math.log(medians.size)
    detector = ruptures.Pelt(model=PARAMETERS["cost_model"], min_size=min_size, jump=1)
    ends = detector.fit(medians.reshape(-1, 1)).predict(pen=penalty)
    return [int(end) for end in ends[:-1]]


def _finding(
    days: list[date],
    medians: np.ndarray,
    by_day: dict[date, list[BuildSample]],
    events: list[CandidateEvent],
    before: tuple[int, int],
    after: tuple[int, int],
    levels: list[float],
) -> Finding | None:
    """Build the finding for one breakpoint.

    Args:
        days: The observed days.
        medians: Their medians.
        by_day: Each day's builds, sorted by id.
        events: The corpus's candidate events.
        before: The ``[start, end)`` day indexes of the segment before the breakpoint.
        after: The same for the segment from it.
        levels: The two segments' medians.

    Returns:
        The finding, or ``None`` when the shift rounds to zero seconds.
    """
    delta = _round(levels[1] - levels[0], 0)
    if delta == 0:
        return None
    breakpoint_day = days[after[0]]
    first_after = by_day[breakpoint_day][0]
    last_before = by_day[days[before[1] - 1]][-1]

    candidates = _rank(breakpoint_day, events, first_after)
    refs: list[EvidenceRef] = []
    for ref in [
        *(EvidenceRef.model_validate(c["ref"]) for c in candidates),
        EvidenceRef(kind=EvidenceKind.BUILD, id=last_before.build_id),
        EvidenceRef(kind=EvidenceKind.BUILD, id=first_after.build_id),
    ]:
        if ref not in refs:
            refs.append(ref)

    confidence, basis = _confidence(medians, by_day, days, before, after, levels, delta)
    metric = PARAMETERS["metric"]
    return Finding(
        analyzer=ChangePointAnalyzer.id,
        analyzer_version=ChangePointAnalyzer.version,
        finding_type="change_point",
        subject_key=f"{metric}@{breakpoint_day.isoformat()}",
        data={
            "date": breakpoint_day.isoformat(),
            "metric": metric,
            "delta_seconds": int(delta),
            "before_median_seconds": _round(levels[0], 1),
            "after_median_seconds": _round(levels[1], 1),
            "candidates": candidates,
        },
        evidence_refs=refs,
        confidence=confidence,
        confidence_basis=basis,
    )


def _rank(
    breakpoint_day: date, events: list[CandidateEvent], first_after: BuildSample
) -> list[dict[str, Any]]:
    """Score every event in reach of a breakpoint and rank them, best first.

    Args:
        breakpoint_day: The first day of the new segment.
        events: The corpus's events.
        first_after: The first build on the breakpoint day — the unattributed candidate's
            evidence.

    Returns:
        At most ``max_candidates`` candidates ``{label, score, ref, event_kind, date,
        days_from_breakpoint, proximity, prior}``, non-increasing in score — or the single
        unattributed candidate when no event is in reach.
    """
    window = PARAMETERS["attribution_window_days"]
    scored = []
    for event in events:
        offset = (event.day - breakpoint_day).days
        if abs(offset) > window:
            continue
        proximity = 1 - abs(offset) / (window + 1)
        prior = PARAMETERS["priors"][event.kind.value]
        scored.append(
            {
                "label": event.label,
                "score": _round(proximity * prior, 4),
                "ref": event.ref.model_dump(mode="json"),
                "event_kind": event.kind.value,
                "date": event.day.isoformat(),
                "days_from_breakpoint": offset,
                "proximity": _round(proximity, 4),
                "prior": prior,
            }
        )
    if not scored:
        return [
            {
                "label": UNATTRIBUTED_LABEL.format(window=window),
                "score": 0.0,
                "ref": {"kind": EvidenceKind.BUILD.value, "id": first_after.build_id},
                "event_kind": None,
                "date": breakpoint_day.isoformat(),
                "days_from_breakpoint": 0,
                "proximity": 0.0,
                "prior": 0.0,
            }
        ]
    scored.sort(
        key=lambda c: (
            -c["score"],
            abs(c["days_from_breakpoint"]),
            c["event_kind"],
            c["ref"]["kind"],
            c["ref"]["id"],
            c["label"],
        )
    )
    return scored[: PARAMETERS["max_candidates"]]


def _confidence(
    medians: np.ndarray,
    by_day: dict[date, list[BuildSample]],
    days: list[date],
    before: tuple[int, int],
    after: tuple[int, int],
    levels: list[float],
    delta: float,
) -> tuple[int, ConfidenceBasis]:
    """Score how sure the analyzer is of one breakpoint — see the module docstring.

    Args:
        medians: The daily medians.
        by_day: Each day's builds.
        days: The observed days.
        before: The segment before, as ``[start, end)``.
        after: The segment from the breakpoint.
        levels: The two segments' medians.
        delta: The rounded shift.

    Returns:
        The confidence (0-100) and the basis the popover renders.
    """
    floor = PARAMETERS["min_noise_seconds"]
    left = medians[before[0] : before[1]]
    right = medians[after[0] : after[1]]
    noise = _robust_sigma(np.concatenate([left - levels[0], right - levels[1]]), floor)
    effect = abs(delta) / noise

    midpoint = (levels[0] + levels[1]) / 2
    side = 1 if levels[1] > levels[0] else -1
    stable = int(np.sum(np.sign(left - midpoint) == -side)) + int(
        np.sum(np.sign(right - midpoint) == side)
    )
    stability = stable / (left.size + right.size)

    shorter = min(left.size, right.size)
    coverage = min(1.0, shorter / (2 * PARAMETERS["min_segment_days"]))
    score = 100 * stability * (1 - math.exp(-effect / 2)) * coverage
    sample = sum(len(by_day[days[i]]) for i in range(before[0], after[1]))

    basis = ConfidenceBasis(
        method=CONFIDENCE_METHOD,
        sample_size=sample,
        effect_size=_round(effect, 3),
        stability=_round(stability, 3),
    )
    return int(_round(score, 0)), basis
