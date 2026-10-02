"""The workflow-outcome analyzer — what stages catch, and what correlates with what (mockup 18).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). Three computations, each a
``workflow_outcome`` finding with a ``metric``:

**1. ``failed_builds_flagged_by_review``** — *"34% of failed builds were later flagged by
self-review"*. Per workflow, the loops in which a build stage (``build_stage_pattern`` over the
stage key) ended ``failed`` and a *later* review stage (``review_stage_pattern``) has a known
outcome; the value is the share of those whose review ended ``flagged``. Stages with no outcome
are unknown and are not counted either way. Cites the workflow versions the loops ran.

**2. ``flake_ratio_<N>d``** — *"loops touching drivers/can/ are 3.1x more likely to flake (21
cases)"*. An **observed association, not a cause**. The unit is a merged loop (``merge_sha`` and
``paths_touched`` known). It *flaked* when the ``tests`` source holds a ``flaky`` result, within
``flake_window_days`` of the loop's day, on a build of the merged commit. For each directory
prefix (the first ``path_depth`` directories of a touched path) the loops touching it are the
**cases**, every other merged loop of the workflow the **baseline**, and the value is the
cases' flake rate over the baseline's. Every finding carries the ratio, the case count, the
flaked count **and** the baseline rate. **Minimum support is part of the analyzer:** fewer than
``min_support_cases`` cases (or baseline loops), a zero baseline, or a ratio under ``min_ratio``
emits nothing — 3.1x over 3 cases is noise. Needs ``tests``; skipped without it.

**3. ``unique_failures``** — *"qemu_cortex_m3 caught 0 unique failures in 214 builds; HIL caught
9 — all at merge gates"*, the test-gate split's load-bearing number. Per stage (job ``label``):
``sample`` is its jobs, ``failures`` its failed (or retried) ones, and a failure is **unique**
when no *other* job of the **same commit** failed — the stages of one change are separate farm
jobs of its commit. ``at_merge_gate`` counts the unique failures built on a merge-queue ref
(``merge_gate_ref_prefix``). Stages with fewer than ``min_stage_sample`` jobs are not reported.
Zero is a finding, not an absence: *"caught 0 unique"* is the point. The workflow is
``farm_workflow`` — farm jobs are not attributed to loops (decision B6).

**Confidence** (every method is in the basis):

* review share: ``100 * (1 - e^(-n/25))``; stability ``1 - 1.96 * sqrt(p(1-p)/n)``;
* flake ratio: ``100 * (1 - e^(-cases/20)) * min(1, (ratio - 1) / 2)``; stability
  ``min(1, cases / (2 * min_support_cases))``;
* unique failures: ``100 * (1 - e^(-sample/50)) * coverage``, where ``coverage`` — also the
  stability — is the share of the stage's jobs whose commit had another stage built at all, the
  share for which uniqueness could be judged.

**Measured inputs (BV.4, #513)** — what the composer's impact formulas read: the review share
carries ``attempt_seconds`` (the failed build stage's mean seconds per attempt) and the
``build_stage``/``review_stage`` keys; a flake ratio carries ``suite`` (the cases' most frequent
flaky suite); a stage's unique failures carry ``pr_seconds_per_commit`` (its seconds on refs other
than the merge gate, per commit — what a PR stops paying if the stage moves to the gate) and
``co_stages`` (the other stages built on every one of its commits).

Requires ``jobs`` and ``loops``; reads ``tests`` when present.
"""

import math
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, ClassVar

from ouroboros_engine.analysis.common import (
    build_ref,
    distinct_refs,
    round_half,
    sampling_note,
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
    LoopRecord,
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "build_stage_pattern": "^(?:build|compile)",
    "review_stage_pattern": "review",
    "min_support_cases": 10,
    "min_ratio": 1.5,
    "flake_window_days": 7,
    "path_depth": 2,
    "merge_gate_ref_prefix": "refs/heads/gh-readonly-queue/",
    "farm_workflow": "build farm",
    "min_stage_sample": 20,
    "max_evidence": 200,
}

#: How each metric's confidence is computed, as the scoring popover states it.
METHODS = {
    "review": "workflow_outcome v1: loops whose failed build stage a later review stage "
    "flagged; 100 * (1 - e^(-n/25)), stability 1 - 1.96 * sqrt(p(1-p)/n)",
    "flake": "workflow_outcome v1: flake rate within the window of merges touching the path "
    "over the other merges (observed association); 100 * (1 - e^(-cases/20)) * "
    "min(1, (ratio - 1) / 2), suppressed below minimum support",
    "unique": "workflow_outcome v1: failures a stage caught that no other stage of the same "
    "commit did; 100 * (1 - e^(-sample/50)) * coverage",
}

_FAILED = frozenset({"failed", "retried"})
_BUILD = re.compile(PARAMETERS["build_stage_pattern"])
_REVIEW = re.compile(PARAMETERS["review_stage_pattern"])


class WorkflowOutcomeAnalyzer(Analyzer):
    """Stage-outcome correlations and per-stage unique-failure attribution."""

    id: ClassVar[str] = "workflow_outcome"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {
            CorpusRequirement(source=CorpusSource.JOBS, grain=Grain.BUILD),
            CorpusRequirement(source=CorpusSource.LOOPS, grain=Grain.LOOP),
        }
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Run the three computations.

        Args:
            corpus: A corpus carrying ``jobs`` and ``loops`` (and optionally ``tests``).

        Returns:
            The findings, review shares then flake ratios then unique failures.
        """
        loops = sorted(corpus.loops or [], key=lambda loop: (loop.day, loop.run_id))
        jobs = sorted(corpus.jobs or [], key=lambda j: (j.finished_at, j.build_id))
        return [
            *review_findings(loops, sampling_note(corpus, [CorpusSource.LOOPS])),
            *flake_findings(corpus, loops, jobs),
            *unique_failure_findings(jobs, sampling_note(corpus, [CorpusSource.JOBS])),
        ]


# ---------------------------------------------------------------------------
# 1. Failed builds later flagged by review.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Judged:
    """One judged loop: whether review flagged its failed build, and the stages involved."""

    flagged: bool
    build_stage: str
    review_stage: str
    attempt_seconds: float


def _review_outcome(loop: LoopRecord) -> _Judged | None:
    """Whether a loop's failed build was later flagged by review.

    Args:
        loop: The loop.

    Returns:
        ``None`` when the loop has no failed build stage followed by a review stage with a
        known outcome; otherwise whether such a review stage ended ``flagged``, the two
        stages' keys (the flagging review, else the first judged one) and the failed build
        stage's seconds per attempt.
    """
    stages = loop.stages
    for index, stage in enumerate(stages):
        if not (_BUILD.search(stage.key) and stage.outcome == "failed"):
            continue
        reviews = [
            later
            for later in stages[index + 1 :]
            if _REVIEW.search(later.key) and later.outcome is not None
        ]
        if reviews:
            flagging = [r for r in reviews if r.outcome == "flagged"]
            return _Judged(
                flagged=bool(flagging),
                build_stage=stage.key,
                review_stage=(flagging or reviews)[0].key,
                attempt_seconds=stage.seconds / stage.attempts,
            )
    return None


def _most_common(values: list[str]) -> str:
    """The most frequent value, the smallest on a tie.

    Args:
        values: At least one value.

    Returns:
        The value.
    """
    counts = Counter(values)
    return min(counts, key=lambda value: (-counts[value], value))


def review_findings(loops: list[LoopRecord], sampling: dict[str, Any]) -> list[Finding]:
    """The failed-builds-flagged-by-review share, per workflow.

    Args:
        loops: The corpus's loops, oldest first.
        sampling: The loops source's sampling note.

    Returns:
        One finding per workflow with at least ``min_support_cases`` judged loops and a
        cited workflow version, in workflow order.
    """
    judged: dict[str, list[tuple[LoopRecord, _Judged]]] = defaultdict(list)
    for loop in loops:
        outcome = _review_outcome(loop)
        if loop.workflow is not None and outcome is not None:
            judged[loop.workflow].append((loop, outcome))
    findings = []
    for workflow in sorted(judged):
        rows = judged[workflow]
        versions = sorted(
            {loop.workflow_version_id for loop, _ in rows if loop.workflow_version_id}
        )
        n = len(rows)
        if n < PARAMETERS["min_support_cases"] or not versions:
            continue
        flagged = sum(outcome.flagged for _, outcome in rows)
        share = flagged / n
        half_width = 1.96 * math.sqrt(share * (1 - share) / n)
        findings.append(
            Finding(
                analyzer=WorkflowOutcomeAnalyzer.id,
                analyzer_version=WorkflowOutcomeAnalyzer.version,
                finding_type="workflow_outcome",
                subject_key=f"{workflow}/stage build→review/failed_builds_flagged_by_review",
                data={
                    "workflow": workflow,
                    "scope": "stage build → review",
                    "metric": "failed_builds_flagged_by_review",
                    "value": round_half(share, 2),
                    "unit": "share",
                    "sample": n,
                    "flagged": flagged,
                    "build_stage": _most_common([o.build_stage for _, o in rows]),
                    "review_stage": _most_common([o.review_stage for _, o in rows]),
                    "attempt_seconds": round_half(
                        statistics.mean(o.attempt_seconds for _, o in rows), 0
                    ),
                    "sampling": sampling,
                },
                evidence_refs=[
                    EvidenceRef(kind=EvidenceKind.WORKFLOW_VERSION, id=version)
                    for version in versions
                ],
                confidence=int(round_half(100 * (1 - math.exp(-n / 25)), 0)),
                confidence_basis=ConfidenceBasis(
                    method=METHODS["review"],
                    sample_size=n,
                    effect_size=round_half(share, 3),
                    stability=round_half(max(0.0, 1 - half_width), 3),
                ),
            )
        )
    return findings


# ---------------------------------------------------------------------------
# 2. Path touched x subsequent flake.
# ---------------------------------------------------------------------------


def path_prefix(path: str) -> str | None:
    """The directory prefix a touched path counts under.

    Args:
        path: A repository path, ``/``-separated.

    Returns:
        Its first ``path_depth`` directories with a trailing ``/`` (``drivers/can/``), or
        ``None`` for a file at the repository root.
    """
    directories = [part for part in path.strip("/").split("/")[:-1] if part]
    if not directories:
        return None
    return "/".join(directories[: PARAMETERS["path_depth"]]) + "/"


def _flake_days(
    corpus: Corpus, jobs: list[BuildJob]
) -> dict[str, list[tuple[date, str]]]:
    """The flaky results each commit's builds produced.

    Args:
        corpus: The corpus, for its ``tests``.
        jobs: Its jobs.

    Returns:
        Commit sha → its ``flaky`` results as sorted ``(day, suite)`` pairs.
    """
    commit_of = {job.build_id: job.commit_sha for job in jobs}
    found: dict[str, set[tuple[date, str]]] = defaultdict(set)
    for result in corpus.tests or []:
        if result.status == "flaky" and result.build_id in commit_of:
            found[commit_of[result.build_id]].add((result.day, result.suite))
    return {sha: sorted(results) for sha, results in found.items()}


def flake_findings(
    corpus: Corpus, loops: list[LoopRecord], jobs: list[BuildJob]
) -> list[Finding]:
    """Path-prefix flake ratios against the baseline, minimum-support gated.

    Args:
        corpus: The corpus — skipped entirely without ``tests``.
        loops: Its loops, oldest first.
        jobs: Its jobs.

    Returns:
        One finding per (workflow, prefix) that clears every gate, in that order.
    """
    if corpus.tests is None:
        return []
    window = PARAMETERS["flake_window_days"]
    flakes = _flake_days(corpus, jobs)
    sampling = sampling_note(
        corpus, [CorpusSource.LOOPS, CorpusSource.JOBS, CorpusSource.TESTS]
    )
    merged: dict[str, list[tuple[LoopRecord, frozenset[str], list[str]]]] = defaultdict(
        list
    )
    for loop in loops:
        if (
            loop.workflow is None
            or loop.merge_sha is None
            or loop.paths_touched is None
        ):
            continue
        prefixes = frozenset(
            p for p in (path_prefix(path) for path in loop.paths_touched) if p
        )
        until = loop.day + timedelta(days=window)
        suites = [
            suite
            for day, suite in flakes.get(loop.merge_sha, [])
            if loop.day <= day <= until
        ]
        merged[loop.workflow].append((loop, prefixes, suites))

    findings = []
    for workflow in sorted(merged):
        rows = merged[workflow]
        for prefix in sorted({p for _, prefixes, _ in rows for p in prefixes}):
            finding = _flake_finding(workflow, prefix, rows, window, sampling)
            if finding is not None:
                findings.append(finding)
    return findings


def _flake_finding(
    workflow: str,
    prefix: str,
    rows: list[tuple[LoopRecord, frozenset[str], list[str]]],
    window: int,
    sampling: dict[str, Any],
) -> Finding | None:
    """One prefix's ratio, or nothing when a gate refuses it.

    Args:
        workflow: The workflow.
        prefix: The directory prefix.
        rows: The workflow's merged loops, their prefixes and the suites of the flaky
            results within the window (empty: it did not flake).
        window: The flake window in days.
        sampling: The sources' sampling note.

    Returns:
        The finding, or ``None``.
    """
    support = PARAMETERS["min_support_cases"]
    cases = [(loop, suites) for loop, prefixes, suites in rows if prefix in prefixes]
    others = [bool(suites) for _, prefixes, suites in rows if prefix not in prefixes]
    if len(cases) < support or len(others) < support:
        return None
    flaked = sum(bool(suites) for _, suites in cases)
    baseline_flaked = sum(others)
    if baseline_flaked == 0:
        return None
    rate = flaked / len(cases)
    baseline = baseline_flaked / len(others)
    ratio = rate / baseline
    if ratio < PARAMETERS["min_ratio"]:
        return None
    merges = sorted({(loop.day, loop.merge_sha) for loop, _ in cases if loop.merge_sha})
    score = 100 * (1 - math.exp(-len(cases) / 20)) * min(1.0, (ratio - 1) / 2)
    metric = f"flake_ratio_{window}d"
    return Finding(
        analyzer=WorkflowOutcomeAnalyzer.id,
        analyzer_version=WorkflowOutcomeAnalyzer.version,
        finding_type="workflow_outcome",
        subject_key=f"{workflow}/{prefix}{metric}",
        data={
            "workflow": workflow,
            "scope": f"merges touching {prefix}",
            "metric": metric,
            "value": round_half(ratio, 1),
            "unit": "ratio",
            "sample": len(cases),
            "flaked": flaked,
            "rate": round_half(rate, 3),
            "baseline": round_half(baseline, 3),
            "baseline_sample": len(others),
            "baseline_flaked": baseline_flaked,
            "suite": _most_common([suite for _, suites in cases for suite in suites]),
            "sampling": sampling,
        },
        evidence_refs=distinct_refs(
            (EvidenceRef(kind=EvidenceKind.MERGE, id=sha) for _, sha in merges),
            PARAMETERS["max_evidence"],
        ),
        confidence=int(round_half(score, 0)),
        confidence_basis=ConfidenceBasis(
            method=METHODS["flake"],
            sample_size=len(cases),
            effect_size=round_half(ratio, 3),
            stability=round_half(min(1.0, len(cases) / (2 * support)), 3),
        ),
    )


# ---------------------------------------------------------------------------
# 3. Unique-failure attribution.
# ---------------------------------------------------------------------------


def unique_failure_findings(
    jobs: list[BuildJob], sampling: dict[str, Any]
) -> list[Finding]:
    """Per stage, the failures no other stage of the same commit caught.

    Args:
        jobs: The corpus's jobs, oldest first.
        sampling: The jobs source's sampling note.

    Returns:
        One finding per stage with at least ``min_stage_sample`` jobs, in label order.
    """
    by_commit: dict[str, list[BuildJob]] = defaultdict(list)
    by_label: dict[str, list[BuildJob]] = defaultdict(list)
    for job in jobs:
        by_commit[job.commit_sha].append(job)
        by_label[job.label].append(job)
    gate = PARAMETERS["merge_gate_ref_prefix"]

    findings = []
    for label in sorted(by_label):
        stage = by_label[label]
        if len(stage) < PARAMETERS["min_stage_sample"]:
            continue
        failed = [job for job in stage if job.status in _FAILED]
        unique = [
            job
            for job in failed
            if not any(
                other.build_id != job.build_id and other.status in _FAILED
                for other in by_commit[job.commit_sha]
            )
        ]
        at_gate = sum(job.git_ref.startswith(gate) for job in unique)
        pre_merge = [job for job in stage if not job.git_ref.startswith(gate)]
        commits = {job.commit_sha for job in stage}
        co_stages = sorted(
            other
            for other in by_label
            if other != label
            and all(
                any(peer.label == other for peer in by_commit[sha]) for sha in commits
            )
        )
        judged = sum(
            any(other.build_id != job.build_id for other in by_commit[job.commit_sha])
            for job in stage
        )
        coverage = judged / len(stage)
        score = 100 * (1 - math.exp(-len(stage) / 50)) * coverage
        refs = distinct_refs(
            [*(build_ref(j.build_id) for j in [*unique, *failed])],
            PARAMETERS["max_evidence"],
        ) or [build_ref(stage[-1].build_id)]
        findings.append(
            Finding(
                analyzer=WorkflowOutcomeAnalyzer.id,
                analyzer_version=WorkflowOutcomeAnalyzer.version,
                finding_type="workflow_outcome",
                subject_key=f"{PARAMETERS['farm_workflow']}/stage {label}/unique_failures",
                data={
                    "workflow": PARAMETERS["farm_workflow"],
                    "scope": f"stage {label}",
                    "metric": "unique_failures",
                    "value": len(unique),
                    "unit": "count",
                    "sample": len(stage),
                    "failures": len(failed),
                    "shared_failures": len(failed) - len(unique),
                    "at_merge_gate": at_gate,
                    "pr_seconds_per_commit": round_half(
                        sum(_seconds(job) for job in pre_merge)
                        / max(1, len({job.commit_sha for job in pre_merge})),
                        0,
                    ),
                    "co_stages": co_stages,
                    "sampling": sampling,
                },
                evidence_refs=refs,
                confidence=int(round_half(score, 0)),
                confidence_basis=ConfidenceBasis(
                    method=METHODS["unique"],
                    sample_size=len(stage),
                    effect_size=round_half(len(unique) / len(stage), 3),
                    stability=round_half(coverage, 3),
                ),
            )
        )
    return findings


def _seconds(job: BuildJob) -> float:
    """How long a job ran (from its start, or its queueing if it never recorded one).

    Args:
        job: The job.

    Returns:
        Seconds.
    """
    return (job.finished_at - (job.started_at or job.queued_at)).total_seconds()
