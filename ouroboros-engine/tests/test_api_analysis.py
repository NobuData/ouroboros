"""``/v0/analysis`` — the analyzer set and the streamed run (BV.1, #510).

The harness itself is :mod:`tests.test_analysis_harness`'s. What is left for the route: that the
set it reports is the installed registry's in ``analysis_runs.analyzer_set``'s shape, that a run
streams one NDJSON event per line in the order the orchestrator relies on (started → outcome per
analyzer, report last), that a skipped analyzer never claims to have started, that a ceiling is
reported as ``budget_exceeded`` with the finished analyzers' findings kept, and that the route is
behind the internal key like every other.

Runs here start real sandboxes, so the registries are small.
"""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from analysis_fakes import (
    ChattyAnalyzer,
    NeedsEventsAnalyzer,
    SleepsAnalyzer,
    ledger_for,
    path_of,
)
from ouroboros_engine.analysis.registry import AnalyzerRegistry
from ouroboros_engine.analysis.spi import AnalyzerBudget
from ouroboros_engine.api.analysis import (
    ANALYZER_SET_LABEL,
    ANALYZERS_ROUTE,
    NDJSON_MEDIA_TYPE,
    RUNS_ROUTE,
)
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import VALIDATION_FAILED

ANALYZERS_PATH = f"{V0_PREFIX}{ANALYZERS_ROUTE}"
RUNS_PATH = f"{V0_PREFIX}{RUNS_ROUTE}"

_RUN_ID = "5eed0065-0000-4000-8000-000000000002"
_FROM = date(2026, 7, 1)


def _corpus(*, events: bool = False) -> dict:
    """A small corpus: three days, one build a day, events absent unless asked for.

    Args:
        events: Carry an (empty) events source.

    Returns:
        The corpus as the wire carries it.
    """
    corpus: dict = {
        "repo_ref": "acme-robotics/helios-firmware",
        "window": {"from": _FROM.isoformat(), "to": (_FROM + timedelta(2)).isoformat()},
        "builds": [
            {
                "build_id": f"5eed0062-0000-4000-8000-00000000000{n}",
                "day": (_FROM + timedelta(n)).isoformat(),
                "duration_seconds": 250.0,
            }
            for n in range(3)
        ],
    }
    if events:
        corpus["events"] = []
    return corpus


def _install(client: TestClient, *fakes: type) -> None:
    """Install a registry of fakes on the client's application.

    Args:
        client: The client whose application runs them.
        *fakes: The fake analyzers.
    """
    registry = AnalyzerRegistry(ledger_for(*fakes))
    for fake in fakes:
        registry.register(path_of(fake))
    client.app.state.analyzer_registry = registry


def _events(client: TestClient, body: dict) -> list[dict]:
    """Dispatch a run and parse its stream.

    Args:
        client: The client.
        body: The request.

    Returns:
        One dict per streamed line, in order.
    """
    response = client.post(RUNS_PATH, json=body)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(NDJSON_MEDIA_TYPE)
    assert response.text.endswith("\n")
    return [json.loads(line) for line in response.text.splitlines()]


# ---------------------------------------------------------------------------
# GET /v0/analysis/analyzers
# ---------------------------------------------------------------------------


def test_the_installed_set_is_reported_in_the_runs_provenance_shape(
    client: TestClient,
) -> None:
    response = client.get(ANALYZERS_PATH)

    assert response.status_code == 200
    assert response.json() == {
        "label": ANALYZER_SET_LABEL,
        "analyzers": [{"id": "change_point", "version": 1, "kind": "deterministic"}],
    }


def test_the_set_is_the_installed_registrys(client: TestClient) -> None:
    _install(client, NeedsEventsAnalyzer, ChattyAnalyzer)

    analyzers = client.get(ANALYZERS_PATH).json()["analyzers"]

    # Id order, as the harness runs them.
    assert [a["id"] for a in analyzers] == ["fake_chatty", "fake_needs_events"]


# ---------------------------------------------------------------------------
# POST /v0/analysis/runs
# ---------------------------------------------------------------------------


def test_a_run_streams_started_then_outcome_per_analyzer_and_the_report_last(
    client: TestClient,
) -> None:
    _install(client, ChattyAnalyzer, NeedsEventsAnalyzer)

    events = _events(client, {"run_id": _RUN_ID, "corpus": _corpus(events=True)})

    assert [
        (e["event"], e.get("analyzer") or e.get("outcome", {}).get("analyzer"))
        for e in events
    ] == [
        ("started", "fake_chatty"),
        ("outcome", "fake_chatty"),
        ("started", "fake_needs_events"),
        ("outcome", "fake_needs_events"),
        ("report", None),
    ]
    chatty = events[1]["outcome"]
    assert chatty["status"] == "completed" and chatty["version"] == 1
    assert chatty["findings"][0]["data"]["builds"] == 3
    assert events[-1] == {"event": "report", "budget_exceeded": False, "failed": []}


def test_a_skipped_analyzer_never_claims_to_have_started(client: TestClient) -> None:
    _install(client, NeedsEventsAnalyzer)

    events = _events(client, {"run_id": _RUN_ID, "corpus": _corpus()})

    assert [e["event"] for e in events] == ["outcome", "report"]
    outcome = events[0]["outcome"]
    assert outcome["status"] == "skipped"
    assert outcome["reason"] == "the corpus lacks events@event"


def test_a_ceiling_reports_budget_exceeded_and_keeps_the_finished_findings(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # fake_chatty finishes first; fake_sleeps then runs into the ceiling.
    monkeypatch.setattr(SleepsAnalyzer, "budget", AnalyzerBudget(time_seconds=30))
    _install(client, ChattyAnalyzer, SleepsAnalyzer)

    events = _events(
        client,
        {"run_id": _RUN_ID, "corpus": _corpus(), "compute_ceiling_seconds": 2.5},
    )

    outcomes = {
        e["outcome"]["analyzer"]: e["outcome"]
        for e in events
        if e["event"] == "outcome"
    }
    assert outcomes["fake_chatty"]["status"] == "completed"
    assert outcomes["fake_chatty"]["findings"]
    assert outcomes["fake_sleeps"]["status"] == "timed_out"
    assert outcomes["fake_sleeps"]["reason"] == "stopped at the run's compute ceiling"
    assert events[-1]["event"] == "report" and events[-1]["budget_exceeded"] is True


def test_the_change_point_analyzer_runs_through_the_route(client: TestClient) -> None:
    # The installed registry, end to end: a three-day corpus is too short to segment, so
    # change_point completes with no findings rather than failing.
    events = _events(client, {"run_id": _RUN_ID, "corpus": _corpus(events=True)})

    assert [e["event"] for e in events] == ["started", "outcome", "report"]
    assert events[1]["outcome"]["status"] == "completed"


def test_a_harness_failure_ends_the_stream_without_a_report(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ouroboros_engine.api import analysis

    def explodes(*_args: object, **_kwargs: object):
        yield from ()
        raise RuntimeError("the harness broke")

    monkeypatch.setattr(analysis, "iter_analysis", explodes)

    response = client.post(RUNS_PATH, json={"run_id": _RUN_ID, "corpus": _corpus()})

    # The status is already sent when the generator fails; the missing report is the signal.
    assert response.status_code == 200
    assert response.text == ""


@pytest.mark.parametrize(
    "change",
    [
        {"run_id": "not-a-uuid"},
        {"compute_ceiling_seconds": 0},
        {"unexpected": True},
        {
            "corpus": {
                **_corpus(),
                "builds": [{**_corpus()["builds"][0], "day": "2026-08-01"}],
            }
        },
    ],
    ids=["run-id", "ceiling", "extra-key", "outside-window"],
)
def test_a_request_that_does_not_validate_is_a_422_before_anything_runs(
    client: TestClient, change: dict
) -> None:
    response = client.post(
        RUNS_PATH, json={"run_id": _RUN_ID, "corpus": _corpus(), **change}
    )

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED


@pytest.mark.parametrize(
    ("method", "path"), [("GET", ANALYZERS_PATH), ("POST", RUNS_PATH)]
)
def test_both_routes_are_behind_the_internal_key(
    anonymous_client: TestClient, method: str, path: str
) -> None:
    response = anonymous_client.request(
        method, path, json={"run_id": _RUN_ID, "corpus": _corpus()}
    )

    assert response.status_code == 401
