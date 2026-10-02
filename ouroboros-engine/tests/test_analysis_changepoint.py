"""The change-point analyzer — detection, measurement and ranked attribution (#511).

Run in-process here, for the statistics; ``test_analysis_harness.py`` runs it in its sandbox.
"""

import math
import re
from datetime import date, timedelta
from itertools import pairwise

import pytest

from analysis_golden import (
    PLANTED,
    WINDOW_FROM,
    WINDOW_TO,
    golden_path,
    noise_corpus,
    planted_builds,
    planted_corpus,
    planted_events,
    render,
)
from ouroboros_engine.analysis.changepoint import (
    PARAMETERS,
    UNATTRIBUTED_LABEL,
    ChangePointAnalyzer,
)
from ouroboros_engine.analysis.contract import (
    BuildSample,
    Corpus,
    DayWindow,
    Finding,
    findings_json,
)


def _analyze(corpus: Corpus) -> list[Finding]:
    return ChangePointAnalyzer().analyze(corpus)


@pytest.fixture(scope="module")
def planted() -> list[Finding]:
    return _analyze(planted_corpus())


def test_the_planted_shifts_are_found_on_their_dates_with_their_deltas(
    planted: list[Finding],
) -> None:
    assert {f.data["date"]: f.data["delta_seconds"] for f in planted} == {
        day: delta for day, (delta, _) in PLANTED.items()
    }


def test_each_chip_reads_date_top_candidate_and_delta(planted: list[Finding]) -> None:
    chips = [
        (f.data["date"], f.data["candidates"][0]["label"], f.data["delta_seconds"])
        for f in planted
    ]
    assert chips == [(day, label, delta) for day, (delta, label) in PLANTED.items()]


def test_the_planted_anchors_outrank_every_near_miss(planted: list[Finding]) -> None:
    for f in planted:
        candidates = f.data["candidates"]
        anchor = PLANTED[f.data["date"]][1]
        assert candidates[0]["label"] == anchor
        assert all(c["score"] < candidates[0]["score"] for c in candidates[1:])
        assert len(candidates) >= 3, (
            "the near misses are still listed, below the anchor"
        )


def test_candidates_are_ranked_with_every_score_component_exposed(
    planted: list[Finding],
) -> None:
    window = PARAMETERS["attribution_window_days"]
    for f in planted:
        scores = [c["score"] for c in f.data["candidates"]]
        assert scores == sorted(scores, reverse=True)
        for c in f.data["candidates"]:
            assert abs(c["days_from_breakpoint"]) <= window
            assert c["proximity"] == pytest.approx(
                1 - abs(c["days_from_breakpoint"]) / (window + 1)
            )
            assert c["prior"] == PARAMETERS["priors"][c["event_kind"]]
            assert c["score"] == pytest.approx(c["proximity"] * c["prior"], abs=1e-4)
            assert 0 <= c["score"] <= 1


def test_an_event_out_of_reach_is_never_a_candidate(planted: list[Finding]) -> None:
    labels = {c["label"] for f in planted for c in f.data["candidates"]}
    assert "unrelated refactor" not in labels


def test_every_candidate_ref_is_cited_as_evidence(planted: list[Finding]) -> None:
    # BU.2's analysis_findings_data_refs_cited: data may only cite what evidence_refs lists.
    for f in planted:
        refs = {(r.kind.value, r.id) for r in f.evidence_refs}
        for c in f.data["candidates"]:
            assert (c["ref"]["kind"], c["ref"]["id"]) in refs
        assert {r.kind.value for r in f.evidence_refs} >= {"build"}


def test_findings_match_bu2s_change_point_contract(planted: list[Finding]) -> None:
    for f in planted:
        assert f.finding_type == "change_point"
        assert f.subject_key == f"build.duration_median@{f.data['date']}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", f.data["date"])
        assert re.fullmatch(r"^[a-z][a-z0-9_.]{0,127}$", f.data["metric"])
        assert isinstance(f.data["delta_seconds"], int) and f.data["delta_seconds"] != 0
        assert f.data["candidates"]
        assert "cause" not in f.data


def test_segment_levels_are_the_planted_medians(planted: list[Finding]) -> None:
    levels = [
        (f.data["before_median_seconds"], f.data["after_median_seconds"])
        for f in planted
    ]
    assert levels == [(252.0, 342.0), (342.0, 212.0), (212.0, 252.0)]


def test_confidence_follows_its_documented_formula(planted: list[Finding]) -> None:
    for f in planted:
        basis = f.confidence_basis
        assert basis.method.startswith("change_point v1:")
        assert 0 <= f.confidence <= 100
        assert basis.stability == 1.0
        assert basis.sample_size > 0
    by_date = {f.data["date"]: f for f in planted}
    # The +40 s shift is seen for seven days — coverage 7 / 10 holds it below the others.
    short = by_date["2026-07-30"]
    expected = 100 * 1.0 * (1 - math.exp(-short.confidence_basis.effect_size / 2)) * 0.7
    assert short.confidence == round(expected)
    assert short.confidence < by_date["2026-06-22"].confidence


@pytest.mark.parametrize("seed", range(8))
def test_noise_alone_produces_no_change_point(seed: int) -> None:
    # The false-positive guard — as important as detection.
    assert _analyze(noise_corpus(seed)) == []


def test_one_pathological_build_is_not_a_change_point() -> None:
    builds = list(noise_corpus(3).builds or [])
    day = WINDOW_FROM + timedelta(days=40)
    outliers = [
        BuildSample(
            build_id=f"000000d0-0000-0000-0000-{i:012x}", day=day, duration_seconds=7200
        )
        for i in range(2)
    ]
    corpus = noise_corpus(3).model_copy(update={"builds": [*builds, *outliers]})

    assert _analyze(corpus) == []


def test_a_shift_with_no_event_in_reach_is_reported_unattributed() -> None:
    findings = _analyze(planted_corpus(events=False))

    assert [f.data["delta_seconds"] for f in findings] == [90, -130, 40]
    for f in findings:
        (only,) = f.data["candidates"]
        assert only["label"] == UNATTRIBUTED_LABEL.format(window=3)
        assert only["score"] == 0.0
        assert only["event_kind"] is None
        assert only["ref"]["kind"] == "build"


def test_too_few_days_hold_no_change_point() -> None:
    days = 2 * PARAMETERS["min_segment_days"] - 1
    builds = [b for b in planted_builds() if b.day < WINDOW_FROM + timedelta(days=days)]
    corpus = Corpus(
        repo_ref="acme/helios-firmware",
        window=DayWindow(from_=WINDOW_FROM, to=WINDOW_TO),
        builds=builds,
        events=[],
    )
    assert _analyze(corpus) == []


def test_no_segment_is_shorter_than_the_minimum() -> None:
    # A four-day +200 s excursion is real, so PELT may still report it — but only as
    # segments of at least min_segment_days observed days, never as a four-day segment.
    spike = {WINDOW_FROM + timedelta(days=d) for d in range(50, 54)}
    builds = [
        b.model_copy(update={"duration_seconds": b.duration_seconds + 200})
        if b.day in spike
        else b
        for b in noise_corpus(1).builds or []
    ]
    corpus = noise_corpus(1).model_copy(update={"builds": builds})

    edges = [
        WINDOW_FROM,
        *(date.fromisoformat(f.data["date"]) for f in _analyze(corpus)),
        WINDOW_TO + timedelta(days=1),
    ]
    assert len(edges) > 2
    assert all(
        (later - earlier).days >= PARAMETERS["min_segment_days"]
        for earlier, later in pairwise(edges)
    )


def test_at_most_max_candidates_are_listed() -> None:
    crowd = [
        e.model_copy(update={"label": f"merge {i}", "day": date(2026, 6, 22)})
        for i, e in enumerate(planted_events() * 2)
    ]
    corpus = planted_corpus().model_copy(update={"events": crowd})

    by_date = {f.data["date"]: f for f in _analyze(corpus)}
    assert len(by_date["2026-06-22"].data["candidates"]) == PARAMETERS["max_candidates"]


def test_findings_are_the_same_bytes_on_every_call() -> None:
    first = findings_json(_analyze(planted_corpus()))
    assert findings_json(_analyze(planted_corpus())) == first


def test_input_order_does_not_change_the_findings() -> None:
    corpus = planted_corpus()
    shuffled = corpus.model_copy(
        update={
            "builds": list(reversed(corpus.builds or [])),
            "events": list(reversed(corpus.events or [])),
        }
    )
    assert findings_json(_analyze(shuffled)) == findings_json(_analyze(corpus))


@pytest.mark.parametrize("name", ["planted", "planted-unattributed"])
def test_the_golden_findings_are_reproduced(name: str) -> None:
    corpus = planted_corpus() if name == "planted" else planted_corpus(events=False)
    assert render(corpus) == golden_path(name).read_text(encoding="utf-8"), (
        "regenerate with `uv run python tests/analysis_golden.py` — and bump the analyzer "
        "version — if the change was intended"
    )
