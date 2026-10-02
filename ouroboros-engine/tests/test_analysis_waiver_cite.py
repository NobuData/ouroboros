"""The waiver-cite analyzer — BA-3's thermal-chamber waivers (#512)."""

from datetime import timedelta

import pytest

from analysis_pattern_fixtures import TO, corpus
from analysis_patterns_golden import mockup_corpus, uid
from ouroboros_engine.analysis.contract import EvidenceKind, Finding
from ouroboros_engine.analysis.patterns.waiver_cite import (
    PARAMETERS,
    WaiverCiteAnalyzer,
    tokens_of,
)


@pytest.fixture(scope="module")
def mockup() -> Finding:
    (finding,) = WaiverCiteAnalyzer().analyze(mockup_corpus())
    return finding


def test_three_waivers_in_60_days_cite_thermal_chamber_availability(
    mockup: Finding,
) -> None:
    assert mockup.data["topic"] == "thermal chamber availability"
    assert (mockup.data["waiver_count"], mockup.data["window_days"]) == (3, 60)
    assert [r.kind for r in mockup.evidence_refs] == [EvidenceKind.WAIVER] * 3
    # The older thermal waiver is outside the sixty days and is not one of them.
    assert uid("waiver", 1) not in {r.id for r in mockup.evidence_refs}


def test_the_identity_is_the_shared_tokens_sorted(mockup: Finding) -> None:
    assert mockup.subject_key == "availability chamber thermal"


def test_reasons_are_normalised_to_content_tokens() -> None:
    assert tokens_of(
        "Waived: Thermal chamber (rig 02, 5eed0512-0006-4000-8000-000000000001)"
    ) == [
        "thermal",
        "chamber",
        "rig",
    ]


def _waivers(*reasons: str, days_ago: int = 1) -> list[dict]:
    on = TO - timedelta(days=days_ago)
    return [
        {
            "waiver_id": uid("waiver", n + 1),
            "run_id": uid("loop", n + 1),
            "day": on.isoformat(),
            "case_keys": [f"t::{n}"],
            "reason": reason,
        }
        for n, reason in enumerate(reasons)
    ]


def test_a_cluster_inside_a_larger_one_adds_nothing() -> None:
    findings = WaiverCiteAnalyzer().analyze(
        corpus(
            waivers=_waivers(
                "thermal chamber booked",
                "thermal chamber booked again",
                "thermal chamber booked solid",
                "thermal soak only",
            )
        )
    )
    # "thermal" (4 waivers) holds "chamber"/"booked" (3) — one finding, the larger.
    assert [(f.data["topic"], f.data["waiver_count"]) for f in findings] == [
        ("thermal", 4)
    ]


def test_too_few_waivers_are_not_a_pattern() -> None:
    reasons = ["thermal chamber"] * (PARAMETERS["min_waivers"] - 1)
    assert WaiverCiteAnalyzer().analyze(corpus(waivers=_waivers(*reasons))) == []


def test_waivers_outside_the_window_do_not_count() -> None:
    old = _waivers("thermal chamber", "thermal chamber", "thermal chamber", days_ago=29)
    assert len(WaiverCiteAnalyzer().analyze(corpus(waivers=old))) == 1
    stale = corpus(waivers=old).model_copy(
        update={
            "window": corpus().window.model_copy(update={"to": TO + timedelta(days=60)})
        }
    )
    assert WaiverCiteAnalyzer().analyze(stale) == []
