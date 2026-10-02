"""The pattern analyzers over mockup 18's corpus — goldens, determinism, budgets (#512).

Each analyzer is run in-process against ``mockup_corpus()`` and must emit exactly its committed
golden file; then every built-in runs in its sandbox, under two hash seeds, within budget.
"""

import json
import random
import time

import pytest

from analysis_patterns_golden import (
    PATTERN_ANALYZERS,
    emitted_json,
    golden_path,
    mockup_corpus,
)
from ouroboros_engine.analysis.contract import Corpus, findings_json
from ouroboros_engine.analysis.harness import run_analysis
from ouroboros_engine.analysis.registry import default_registry


@pytest.fixture(scope="module")
def corpus() -> Corpus:
    return mockup_corpus()


@pytest.mark.parametrize("analyzer_id", sorted(PATTERN_ANALYZERS))
def test_each_analyzer_emits_its_golden_findings(
    analyzer_id: str, corpus: Corpus
) -> None:
    golden = golden_path(analyzer_id).read_text(encoding="utf-8")
    assert emitted_json(analyzer_id, corpus) == golden, (
        f"{analyzer_id} drifted from its golden; if intended, bump its version and run "
        "`uv run python tests/analysis_patterns_golden.py`"
    )


@pytest.mark.parametrize("analyzer_id", sorted(PATTERN_ANALYZERS))
def test_record_order_does_not_change_a_finding(
    analyzer_id: str, corpus: Corpus
) -> None:
    # Determinism discipline 3: an analyzer sorts what it reads. Shuffling every source must
    # leave the canonical bytes unchanged.
    rng = random.Random(512)  # noqa: S311 — a fixture shuffle, not security
    shuffled = {}
    for name in ("jobs", "log_tails", "cache", "tests", "loops", "waivers", "pools"):
        rows = list(getattr(corpus, name))
        rng.shuffle(rows)
        shuffled[name] = rows
    reordered = corpus.model_copy(update=shuffled)

    analyzer = PATTERN_ANALYZERS[analyzer_id]()
    assert findings_json(analyzer.analyze(reordered)) == findings_json(
        analyzer.analyze(corpus)
    )


@pytest.mark.parametrize("analyzer_id", sorted(PATTERN_ANALYZERS))
def test_every_finding_cites_what_its_data_cites(
    analyzer_id: str, corpus: Corpus
) -> None:
    for finding in PATTERN_ANALYZERS[analyzer_id]().analyze(corpus):
        evidence = set(finding.evidence_refs)
        for ref in finding.data.get("sample_refs", []):
            assert any(e.model_dump(mode="json") == ref for e in evidence)
        assert finding.identity_key.startswith(f"{analyzer_id}@v1/")
        assert "sampling" in finding.data


def test_every_built_in_completes_in_its_sandbox_within_budget(corpus: Corpus) -> None:
    started = time.monotonic()
    first = run_analysis(default_registry(), corpus, hash_seed="0")
    elapsed = time.monotonic() - started
    second = run_analysis(default_registry(), corpus, hash_seed="4242")

    statuses = {o.analyzer: o.status for o in first.outcomes}
    # change_point reads the duration series, which this corpus does not carry.
    assert statuses.pop("change_point") == "skipped"
    assert set(statuses.values()) == {"completed"} and len(statuses) == 6
    for outcome in first.outcomes:
        if outcome.status == "completed":
            budget = PATTERN_ANALYZERS[outcome.analyzer].budget.time_seconds
            assert outcome.elapsed_seconds < budget
    assert not first.budget_exceeded and elapsed < 120

    # Identical corpus, different PYTHONHASHSEED: byte-identical findings, equal to the goldens.
    assert first.findings_json() == second.findings_json()
    goldens = [
        finding
        for analyzer_id in sorted(PATTERN_ANALYZERS)
        for finding in json.loads(golden_path(analyzer_id).read_text(encoding="utf-8"))
    ]
    assert json.loads(first.findings_json()) == goldens
