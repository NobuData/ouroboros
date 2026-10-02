"""The execution harness — isolation, budgets, the network ban, reproducibility (#511).

Every case here starts real sandbox processes, so each costs about half a second.
"""

import json
import logging
import time

import numpy as np
import pytest

from analysis_fakes import (
    ChattyAnalyzer,
    DialsOutAnalyzer,
    HogsMemoryAnalyzer,
    ImpersonatesAnalyzer,
    NeedsEventsAnalyzer,
    RaisesAnalyzer,
    SleepsAnalyzer,
    SpawnsAnalyzer,
    SwallowsViolationAnalyzer,
    ledger_for,
    path_of,
)
from analysis_golden import PLANTED, golden_path, planted_corpus
from ouroboros_engine.analysis.contract import Corpus
from ouroboros_engine.analysis.harness import (
    AnalysisReport,
    AnalyzerOutcome,
    run_analysis,
    sandbox_environment,
)
from ouroboros_engine.analysis.ledger import PARAMETER_LEDGER
from ouroboros_engine.analysis.registry import AnalyzerRegistry, default_registry
from ouroboros_engine.analysis.spi import ANALYSIS_SEED, AnalyzerBudget

CHANGE_POINT = "ouroboros_engine.analysis.changepoint:ChangePointAnalyzer"


@pytest.fixture(scope="module")
def corpus() -> Corpus:
    return planted_corpus()


def _registry(*fakes: type, change_point: bool = False) -> AnalyzerRegistry:
    registry = AnalyzerRegistry({**PARAMETER_LEDGER, **ledger_for(*fakes)})
    if change_point:
        registry.register(CHANGE_POINT)
    for fake in fakes:
        registry.register(path_of(fake))
    return registry


def _outcome(report: AnalysisReport, analyzer: str) -> AnalyzerOutcome:
    (outcome,) = [o for o in report.outcomes if o.analyzer == analyzer]
    return outcome


def test_the_change_point_analyzer_completes_in_its_sandbox(corpus: Corpus) -> None:
    started = time.monotonic()
    report = run_analysis(default_registry(), corpus, compute_ceiling_seconds=60)
    elapsed = time.monotonic() - started

    outcome = _outcome(report, "change_point")
    assert (outcome.status, outcome.error) == ("completed", None)
    # The pattern analyzers (#512) need sources this duration corpus does not carry.
    assert {o.analyzer for o in report.outcomes if o.status == "skipped"} == {
        "cache_window",
        "config_usage",
        "log_signature",
        "queue_correlation",
        "waiver_cite",
        "workflow_outcome",
    }
    assert [f.data["date"] for f in report.findings] == list(PLANTED)
    assert not report.budget_exceeded and report.failed == []
    # The fixture corpus is analysed well inside the run's compute budget.
    assert elapsed < 60 and outcome.elapsed_seconds < 60


def test_one_analyzer_raising_does_not_take_down_the_run(
    corpus: Corpus, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="ouroboros_engine.analysis.harness"):
        report = run_analysis(_registry(RaisesAnalyzer, change_point=True), corpus)

    assert [(o.analyzer, o.status) for o in report.outcomes] == [
        ("change_point", "completed"),
        ("fake_raises", "failed"),
    ]
    assert report.failed == ["fake_raises"]
    assert len(report.findings) == len(PLANTED)

    error = _outcome(report, "fake_raises").error
    assert error is not None and error.type == "RuntimeError"
    assert "malformed slice of acme/helios-firmware" in error.message
    # The report carries a reference; the log carries the traceback under it.
    (record,) = [
        r for r in caplog.records if getattr(r, "analyzer", None) == "fake_raises"
    ]
    assert record.traceback_ref == error.traceback_ref
    assert (
        "RuntimeError" in record.traceback and "analysis_fakes.py" in record.traceback
    )


def test_an_analyzer_over_its_time_budget_is_stopped(corpus: Corpus) -> None:
    started = time.monotonic()
    report = run_analysis(
        _registry(SleepsAnalyzer),
        corpus,
        budgets={"fake_sleeps": AnalyzerBudget(time_seconds=2)},
    )

    outcome = _outcome(report, "fake_sleeps")
    assert outcome.status == "timed_out"
    assert outcome.reason == "exceeded its 2 s time budget"
    assert time.monotonic() - started < 10, "the sandbox is killed, not waited for"
    assert report.failed == ["fake_sleeps"]


def test_an_analyzer_over_its_memory_budget_is_stopped(corpus: Corpus) -> None:
    budget = AnalyzerBudget(memory_bytes=512 * 1024 * 1024)
    report = run_analysis(
        _registry(HogsMemoryAnalyzer), corpus, budgets={"fake_hogs_memory": budget}
    )

    outcome = _outcome(report, "fake_hogs_memory")
    assert outcome.status == "memory_exceeded"
    assert outcome.error is not None and outcome.error.type == "MemoryError"
    assert outcome.findings == []


@pytest.mark.parametrize("fake", [DialsOutAnalyzer, SpawnsAnalyzer])
def test_analyzer_code_cannot_reach_the_network_or_start_a_process(
    corpus: Corpus, fake: type
) -> None:
    report = run_analysis(_registry(fake), corpus)

    outcome = _outcome(report, fake.id)
    assert outcome.status == "failed"
    assert outcome.error is not None and outcome.error.type == "SandboxViolationError"


def test_a_swallowed_violation_still_voids_the_findings(corpus: Corpus) -> None:
    report = run_analysis(_registry(SwallowsViolationAnalyzer), corpus)

    outcome = _outcome(report, "fake_swallows")
    assert outcome.status == "failed"
    assert outcome.error is not None and "socket.getaddrinfo" in outcome.error.message
    assert outcome.findings == []


def test_the_sandbox_is_seeded_quiet_and_sees_no_secrets(
    corpus: Corpus, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OURO_ENGINE_SHARED_SECRET", "must-not-leak")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")

    report = run_analysis(_registry(ChattyAnalyzer), corpus)

    outcome = _outcome(report, "fake_chatty")
    assert outcome.status == "completed", "stdout chatter must not corrupt the result"
    (seen,) = outcome.findings
    assert seen.data["variables"] == sorted(sandbox_environment())
    assert "OURO_ENGINE_SHARED_SECRET" not in seen.data["variables"]
    assert "HTTPS_PROXY" not in seen.data["variables"]
    assert seen.data["builds"] == len(corpus.builds or [])
    expected = float(np.random.RandomState(ANALYSIS_SEED).random_sample())
    assert seen.data["draw"] == expected
    assert seen.data["hash_seed"] == "0"


def test_a_finding_claiming_another_analyzer_is_refused(corpus: Corpus) -> None:
    report = run_analysis(_registry(ImpersonatesAnalyzer), corpus)

    outcome = _outcome(report, "fake_impersonates")
    assert outcome.status == "failed"
    assert (
        outcome.error is not None and "claims change_point@v1" in outcome.error.message
    )


def test_an_analyzer_whose_inputs_are_absent_is_skipped_not_run(corpus: Corpus) -> None:
    no_events = corpus.model_copy(update={"events": None})

    report = run_analysis(_registry(NeedsEventsAnalyzer, change_point=True), no_events)

    assert [(o.analyzer, o.status, o.reason) for o in report.outcomes] == [
        ("change_point", "skipped", "the corpus lacks events@event"),
        ("fake_needs_events", "skipped", "the corpus lacks events@event"),
    ]
    assert report.failed == [] and report.findings == []


def test_the_runs_compute_ceiling_caps_the_sum(corpus: Corpus) -> None:
    report = run_analysis(
        _registry(SleepsAnalyzer, RaisesAnalyzer),
        corpus,
        budgets={"fake_sleeps": AnalyzerBudget(time_seconds=60)},
        compute_ceiling_seconds=2,
    )

    assert report.budget_exceeded
    raises, sleeps = report.outcomes
    assert (raises.analyzer, raises.status) == ("fake_raises", "failed")
    # fake_raises spent some of the two seconds; fake_sleeps gets only what is left.
    assert sleeps.status in {"timed_out", "not_run"}
    assert sleeps.reason in {
        "stopped at the run's compute ceiling",
        "the run's compute ceiling was reached",
    }


def test_identical_corpus_gives_byte_identical_findings_whatever_the_hash_seed(
    corpus: Corpus,
) -> None:
    # The acceptance bar: run twice, under two different PYTHONHASHSEEDs — an analyzer that
    # leaned on set or dict iteration order would differ here.
    first = run_analysis(default_registry(), corpus, hash_seed="0")
    second = run_analysis(default_registry(), corpus, hash_seed="4242")

    assert first.findings_json() == second.findings_json()
    golden = json.loads(golden_path("planted").read_text(encoding="utf-8"))
    assert json.loads(first.findings_json()) == golden
