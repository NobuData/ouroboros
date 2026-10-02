"""The workflow-outcome analyzer — 34%, 3.1x over 21 cases, and unique failures (#512)."""

from datetime import timedelta

import pytest

from analysis_pattern_fixtures import FROM, corpus, job
from analysis_patterns_golden import mockup_corpus, sha, uid
from ouroboros_engine.analysis.contract import EvidenceKind, Finding
from ouroboros_engine.analysis.patterns.workflow_outcome import (
    PARAMETERS,
    WorkflowOutcomeAnalyzer,
    path_prefix,
)

GATE = "refs/heads/gh-readonly-queue/main/pr-7"


@pytest.fixture(scope="module")
def mockup() -> dict[str, Finding]:
    return {
        f.subject_key: f for f in WorkflowOutcomeAnalyzer().analyze(mockup_corpus())
    }


def test_34_percent_of_failed_builds_were_later_flagged_by_review(
    mockup: dict[str, Finding],
) -> None:
    finding = mockup["standard-fix/stage build→review/failed_builds_flagged_by_review"]
    assert (finding.data["value"], finding.data["unit"]) == (0.34, "share")
    assert (finding.data["sample"], finding.data["flagged"]) == (50, 17)
    assert [r.kind for r in finding.evidence_refs] == [EvidenceKind.WORKFLOW_VERSION]


def test_drivers_can_merges_are_3_1x_as_likely_to_flake_over_21_cases(
    mockup: dict[str, Finding],
) -> None:
    finding = mockup["standard-fix/drivers/can/flake_ratio_7d"]
    data = finding.data
    assert (data["value"], data["unit"], data["sample"]) == (3.1, "ratio", 21)
    # The ratio never travels without its case count and its baseline.
    assert (data["flaked"], data["rate"]) == (13, 0.619)
    assert (data["baseline"], data["baseline_sample"], data["baseline_flaked"]) == (
        0.203,
        79,
        16,
    )
    assert len(finding.evidence_refs) == 21
    assert {r.kind for r in finding.evidence_refs} == {EvidenceKind.MERGE}


def test_qemu_caught_0_unique_failures_in_214_builds(
    mockup: dict[str, Finding],
) -> None:
    data = mockup["build farm/stage qemu_cortex_m3/unique_failures"].data
    assert (data["value"], data["sample"]) == (0, 214)
    assert (data["failures"], data["shared_failures"]) == (12, 12)


def test_hil_caught_9_unique_failures_all_at_merge_gates(
    mockup: dict[str, Finding],
) -> None:
    data = mockup["build farm/stage HIL test rig/unique_failures"].data
    assert (data["value"], data["at_merge_gate"]) == (9, 9)
    assert data["shared_failures"] == 2


def test_paths_count_under_their_first_two_directories() -> None:
    assert path_prefix("drivers/can/can_mcan.c") == "drivers/can/"
    assert path_prefix("drivers/can/fd/x.c") == "drivers/can/"
    assert path_prefix("boards/x.dts") == "boards/"
    assert path_prefix("README.md") is None


# ---------------------------------------------------------------------------
# Minimum support and baselines.
# ---------------------------------------------------------------------------


def _merged(cases: int, flaked: int, others: int, others_flaked: int) -> dict:
    """Merged loops: ``cases`` touching drivers/can (``flaked`` of them flaking)."""
    jobs, tests, loops = [], [], []
    for i in range(cases + others):
        on = FROM + timedelta(days=i % 20)
        commit = sha(f"m{i}")
        jobs.append(job(i + 1, on=on, commit=commit, ref="refs/heads/main"))
        is_case = i < cases
        did_flake = i < flaked if is_case else i - cases < others_flaked
        tests.append(
            {
                "test_run_id": uid("test_run", i + 1),
                "build_id": uid("job", i + 1),
                "day": on.isoformat(),
                "suite": "telemetry",
                "platform": None,
                "case_key": "t::x",
                "status": "flaky" if did_flake else "passed",
                "failure": None,
            }
        )
        loops.append(
            {
                "run_id": uid("loop", i + 1),
                "day": on.isoformat(),
                "status": "merged",
                "stages": [],
                "events": 1,
                "event_bytes": 1,
                "workflow": "standard-fix",
                "merge_sha": commit,
                "paths_touched": ["drivers/can/a.c" if is_case else "lib/x/b.c"],
            }
        )
    return {"jobs": jobs, "tests": tests, "loops": loops}


def _flake_findings(**sources: list) -> list[Finding]:
    return [
        f
        for f in WorkflowOutcomeAnalyzer().analyze(corpus(**sources))
        if f.data["metric"].startswith("flake_ratio")
    ]


def test_a_3_case_correlation_produces_nothing() -> None:
    # 3 of 3 flaked against 2 of 30: a 15x "ratio" that is three data points.
    assert _flake_findings(**_merged(3, 3, 30, 2)) == []


def test_the_same_rates_at_minimum_support_produce_a_finding() -> None:
    support = PARAMETERS["min_support_cases"]
    (finding,) = _flake_findings(**_merged(support, support, 30, 2))
    assert finding.data["sample"] == support
    assert finding.data["baseline"] == round(2 / 30, 3)


def test_a_zero_baseline_produces_nothing() -> None:
    assert _flake_findings(**_merged(12, 6, 30, 0)) == []


def test_a_ratio_under_the_minimum_produces_nothing() -> None:
    assert _flake_findings(**_merged(12, 3, 30, 6)) == []


def test_without_test_results_flake_ratios_are_skipped() -> None:
    sources = _merged(12, 12, 30, 2)
    sources.pop("tests")
    assert _flake_findings(**sources) == []


def test_a_review_share_below_minimum_support_produces_nothing() -> None:
    loops = [
        {
            "run_id": uid("loop", n + 1),
            "day": FROM.isoformat(),
            "status": "merged",
            "stages": [
                {"key": "build", "attempts": 1, "seconds": 1, "outcome": "failed"},
                {"key": "review", "attempts": 1, "seconds": 1, "outcome": "flagged"},
            ],
            "events": 1,
            "event_bytes": 1,
            "workflow": "standard-fix",
            "workflow_version_id": uid("version", 1),
        }
        for n in range(PARAMETERS["min_support_cases"] - 1)
    ]
    assert WorkflowOutcomeAnalyzer().analyze(corpus(jobs=[], loops=loops)) == []


# ---------------------------------------------------------------------------
# Unique-failure attribution.
# ---------------------------------------------------------------------------


def _stages(qemu_failures: list[tuple[bool, str]], size: int = 25) -> list[dict]:
    """``size`` commits, each a native_sim and a qemu job.

    ``qemu_failures[i]`` fails commit ``i``'s qemu job: (whether native_sim failed too, ref).
    """
    rows = []
    for i in range(size):
        commit = sha(f"s{i}")
        shared, ref = (
            qemu_failures[i] if i < len(qemu_failures) else (False, "refs/heads/pr")
        )
        failed_qemu = i < len(qemu_failures)
        rows.append(
            job(2 * i + 1, label="native_sim", commit=commit, ref=ref,
                status="failed" if failed_qemu and shared else "succeeded")
        )  # fmt: skip
        rows.append(
            job(2 * i + 2, label="qemu_cortex_m3", commit=commit, ref=ref,
                status="failed" if failed_qemu else "succeeded")
        )  # fmt: skip
    return rows


def _unique(jobs: list[dict]) -> dict[str, dict]:
    return {
        f.data["scope"]: f.data
        for f in WorkflowOutcomeAnalyzer().analyze(corpus(jobs=jobs, loops=[]))
        if f.data["metric"] == "unique_failures"
    }


def test_a_stage_whose_failures_are_all_shared_caught_0_unique() -> None:
    data = _unique(_stages([(True, "refs/heads/pr")] * 6))["stage qemu_cortex_m3"]
    assert (data["value"], data["failures"], data["shared_failures"]) == (0, 6, 6)


def test_a_stage_with_failures_of_its_own_caught_them_uniquely() -> None:
    failures = (
        [(True, "refs/heads/pr")] * 2 + [(False, GATE)] * 3 + [(False, "refs/heads/pr")]
    )
    data = _unique(_stages(failures))["stage qemu_cortex_m3"]
    assert (data["value"], data["at_merge_gate"], data["shared_failures"]) == (4, 3, 2)


def test_a_retried_build_counts_as_a_failure_of_its_commit() -> None:
    rows = _stages([(False, "refs/heads/pr")])
    rows[0]["status"] = "retried"  # the commit's native_sim failed and was run again
    data = _unique(rows)["stage qemu_cortex_m3"]
    assert (data["value"], data["shared_failures"]) == (0, 1)


def test_a_stage_with_no_failures_still_reports_zero_and_cites_a_build() -> None:
    findings = [
        f
        for f in WorkflowOutcomeAnalyzer().analyze(corpus(jobs=_stages([]), loops=[]))
        if f.data["scope"] == "stage qemu_cortex_m3"
    ]
    (finding,) = findings
    assert finding.data["value"] == 0 and len(finding.evidence_refs) == 1


def test_a_stage_below_the_minimum_sample_is_not_reported() -> None:
    small = _stages([(False, "refs/heads/pr")], size=PARAMETERS["min_stage_sample"] - 1)
    assert _unique(small) == {}
