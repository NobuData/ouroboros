"""The analyzer goldens, through the real dispatch path (BV.6, #515).

Every golden elsewhere is asserted against an analyzer called in-process. That leaves the path
ouroboros-rest actually uses unproven: the corpus serialised onto the wire, validated by the route,
handed to the harness, each analyzer run in its sandbox, and its findings streamed back as NDJSON.
An analyzer that silently stopped running there would still pass every in-process golden — the run
would simply return a shorter list.

So here each committed golden file is reproduced through ``POST /v0/analysis/runs`` with the
installed registry, unmocked: mockup 18's corpus for the six pattern analyzers, and the planted
ninety days for the change-point analyzer.
"""

import json

from fastapi.testclient import TestClient

from analysis_golden import golden_path as change_point_golden
from analysis_golden import planted_corpus
from analysis_patterns_golden import PATTERN_ANALYZERS, golden_path, mockup_corpus
from ouroboros_engine.analysis.contract import Corpus, canonical_json
from ouroboros_engine.api.analysis import RUNS_ROUTE
from ouroboros_engine.api.v0 import V0_PREFIX

RUNS_PATH = f"{V0_PREFIX}{RUNS_ROUTE}"

_RUN_ID = "5eed0065-0000-4000-8000-000000000002"


def _dispatch(client: TestClient, corpus: Corpus) -> dict[str, dict]:
    """Run a corpus through the route and collect each analyzer's outcome.

    Args:
        client: The authenticated client.
        corpus: The corpus, serialised as ouroboros-rest sends it.

    Returns:
        Each analyzer's outcome event, by analyzer id — after asserting the stream ended in a
        report, so a cut-off run cannot pass.
    """
    body = {
        "run_id": _RUN_ID,
        "corpus": json.loads(corpus.model_dump_json(by_alias=True)),
    }
    with client.stream("POST", RUNS_PATH, json=body) as response:
        assert response.status_code == 200
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert events[-1]["event"] == "report"
    return {
        e["outcome"]["analyzer"]: e["outcome"]
        for e in events
        if e["event"] == "outcome"
    }


def _canonical(findings: list[dict]) -> list[dict]:
    """Findings in the golden files' canonical order and form.

    Args:
        findings: Findings as JSON.

    Returns:
        The same findings, canonicalised.
    """
    return json.loads(canonical_json(sorted(findings, key=canonical_json)))


def test_every_pattern_golden_reproduces_through_the_route(client: TestClient) -> None:
    # One run of the whole installed set, as a real analysis is — each analyzer's outcome then
    # held to its own golden file. A missing outcome is a KeyError, so an analyzer that stopped
    # running fails rather than shortening the list.
    outcomes = _dispatch(client, mockup_corpus())

    for analyzer_id in sorted(PATTERN_ANALYZERS):
        outcome = outcomes[analyzer_id]
        assert outcome["status"] == "completed", analyzer_id
        golden = json.loads(golden_path(analyzer_id).read_text(encoding="utf-8"))
        assert _canonical(outcome["findings"]) == _canonical(golden), analyzer_id


def test_the_change_point_golden_reproduces_through_the_route(
    client: TestClient,
) -> None:
    outcome = _dispatch(client, planted_corpus())["change_point"]

    assert outcome["status"] == "completed"
    golden = json.loads(change_point_golden("planted").read_text(encoding="utf-8"))
    assert _canonical(outcome["findings"]) == _canonical(golden)
