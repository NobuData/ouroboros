"""``POST /v0/dry-runs`` over HTTP: the stream, the body it refuses, what it logs (CD.2, #560)."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from dryrun_fakes import DRY_RUN, TOKEN, Bench, request
from ouroboros_engine.api.dryruns import DRY_RUNS_ROUTE, NDJSON_MEDIA_TYPE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.dryrun.contract import (
    HARNESS_VERSION,
    DryRunRequest,
    DryRunResult,
    StageResult,
)
from ouroboros_engine.dryrun.harness import DryRunHarness

PATH = f"{V0_PREFIX}{DRY_RUNS_ROUTE}"


def body(**overrides) -> dict:
    return json.loads(request(**overrides).model_dump_json())


@pytest.fixture
def served(client: TestClient) -> tuple[TestClient, Bench]:
    bench = Bench()
    client.app.state.dry_runs = bench.harness
    return client, bench


def test_the_route_is_under_the_versioned_prefix():
    assert PATH == "/v0/dry-runs"


def test_the_application_installs_a_harness(client: TestClient):
    assert isinstance(client.app.state.dry_runs, DryRunHarness)


def test_a_dry_run_streams_ndjson_and_ends_with_the_whole_result(served):
    client, _ = served

    response = client.post(PATH, json=body())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(NDJSON_MEDIA_TYPE)
    lines = [json.loads(line) for line in response.text.splitlines()]
    assert [line["kind"] for line in lines[:3]] == [
        "stage_started",
        "stage_finished",
        "stage_started",
    ]
    assert lines[-1]["kind"] == "done"
    assert [line["kind"] for line in lines].count("done") == 1
    done = DryRunResult.model_validate(lines[-1]["result"])
    assert (done.dry_run, done.harness, done.status) == (
        DRY_RUN,
        HARNESS_VERSION,
        "complete",
    )
    assert len(done.stages) == 8
    # Every streamed row is one of the result's rows.
    streamed = [
        StageResult.model_validate(x["stage"])
        for x in lines
        if x["kind"] == "stage_finished"
    ]
    assert streamed == done.stages


def test_the_token_is_never_echoed(served):
    client, _ = served

    response = client.post(PATH, json=body())

    assert TOKEN not in response.text


def test_the_log_line_names_the_run_and_none_of_its_text(served, caplog):
    client, _ = served

    with caplog.at_level(logging.INFO, logger="ouroboros_engine.api.dryruns"):
        client.post(PATH, json=body())

    record = next(r for r in caplog.records if r.getMessage() == "dry run")
    assert (record.dry_run, record.repository, record.status, record.stages) == (
        DRY_RUN,
        "acme-robotics/helios-firmware",
        "complete",
        8,
    )
    assert record.guards_clean is True
    logged = json.dumps({k: str(v) for k, v in record.__dict__.items()})
    assert TOKEN not in logged
    assert "CAN arbitration retries flood the bus" not in logged


def test_the_key_is_required(anonymous_client: TestClient):
    assert anonymous_client.post(PATH, json=body()).status_code == 401


@pytest.mark.parametrize(
    "change",
    [
        {"dry_run": "RS-1"},
        {"repository": {"slug": "no-owner", "pinned_sha": "a" * 40}},
        {"repository": {"slug": "o/r", "pinned_sha": "main"}},
        {
            "repository": {
                "slug": "o/r",
                "pinned_sha": "a" * 40,
                "api_url": "http://api.github.com",
            }
        },
        {
            "repository": {
                "slug": "o/r",
                "pinned_sha": "a" * 40,
                "api_url": "https://u:p@host",
            }
        },
        {
            "repository": {
                "slug": "o/r",
                "pinned_sha": "a" * 40,
                "api_url": "file:///etc",
            }
        },
        {"stages": {"Not A Slug": {"alias": "x"}}},
        {"stages": {"plan": {"alias": "Not An Alias"}}},
        {"stages": {"plan": {"alias": "coder", "model": "gpt"}}},
        {"budget": {"run_tokens": -1}},
        {"budget": {"monthly": 5}},
        {
            "ticket": {
                "external_key": "#1",
                "source": "github",
                "labels": [],
                "estimate": None,
            }
        },
        {"unknown": True},
    ],
)
def test_a_malformed_body_is_refused_before_anything_runs(served, change):
    client, bench = served
    raw = body()
    raw.update(change)

    response = client.post(PATH, json=raw)

    assert response.status_code == 422
    assert bench.model.calls == []
    assert bench.repositories == []


def test_the_request_defaults_are_githubs_api_and_no_caps():
    parsed = DryRunRequest.model_validate(
        {
            "dry_run": DRY_RUN,
            "definition": {},
            "ticket": {
                "external_key": "#1",
                "source": "github",
                "labels": [],
                "estimate": None,
                "title": "t",
            },
            "repository": {"slug": "o/r", "pinned_sha": "a" * 40},
        }
    )

    assert parsed.repository.api_url == "https://api.github.com"
    assert parsed.repository.token is None
    assert parsed.stages == {}
    assert parsed.budget.model_dump() == {
        "run_cost_cents": None,
        "stage_cost_cents": None,
        "run_tokens": None,
        "stage_tokens": None,
    }
    assert parsed.ticket.body == ""


def test_an_enterprise_api_origin_is_accepted():
    parsed = request(
        repository={
            "slug": "o/r",
            "pinned_sha": "a" * 40,
            "api_url": "https://ghe.example.com/api/v3",
        }
    )

    assert parsed.repository.api_url == "https://ghe.example.com/api/v3"


def test_an_invalid_definition_still_answers_200_with_a_failed_result(served):
    client, _ = served

    response = client.post(PATH, json=body(definition={"dsl_version": "9.9"}))

    lines = [json.loads(line) for line in response.text.splitlines()]
    assert response.status_code == 200
    assert [line["kind"] for line in lines] == ["done"]
    assert lines[0]["result"]["status"] == "failed"
    assert lines[0]["result"]["findings"]
