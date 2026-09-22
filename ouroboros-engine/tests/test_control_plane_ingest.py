"""The ingestion mirror, held to ``ouroboros-rest``'s internal document, and its client.

:mod:`ouroboros_engine.control_plane.ingest` is the ``runs`` tag of
``ouroboros-rest/openapi.internal.json`` written as Python. This file compares the two: the
paths and their methods, every closed vocabulary, every request's wire fields and every
response's required ones. A drift on either side fails here.
"""

import json
from http import HTTPStatus
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.contract import INTERNAL_KEY_HEADER
from ouroboros_engine.control_plane.ingest import (
    EVENT_ACTORS,
    FILE_STATUSES,
    GUARDRAIL_CHECKS,
    HUNK_LINE_KINDS,
    INGEST_ERRORS,
    INGEST_PATHS,
    MERGE_STRATEGIES,
    RETURN_KINDS,
    RETURN_REASONS,
    RUN_FILES_PATH,
    RUNS_PATH,
    STAGE_STATUSES,
    ChangeSet,
    CommitsAppended,
    EventsAppended,
    IngestCommit,
    IngestEvent,
    IngestEventsRequest,
    IngestFile,
    IngestHunk,
    IngestHunkLine,
    OpenRunRequest,
    ReportCommitsRequest,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageReturn,
    StageTransition,
    StageTransitionRequest,
    TicketReference,
    TokenSpend,
    WorkflowPin,
)

_DOCUMENT_PATH = (
    Path(__file__).resolve().parents[2] / "ouroboros-rest" / "openapi.internal.json"
)

BASE = "http://rest:4000"
SECRET = "test-simulator-secret-7c1d"
RUN = "5eed0009-0000-4000-8000-000000000482"


def _document() -> dict[str, Any]:
    assert _DOCUMENT_PATH.is_file(), f"{_DOCUMENT_PATH} is missing"
    return json.loads(_DOCUMENT_PATH.read_text(encoding="utf-8"))


def _schema(name: str) -> dict[str, Any]:
    return _document()["components"]["schemas"][name]


def _wire(model: type[BaseModel]) -> set[str]:
    return {field.alias or name for name, field in model.model_fields.items()}


# --- the mirror -----------------------------------------------------------------------------


def test_the_six_paths_are_the_documents_runs_family() -> None:
    documented = {
        path
        for path, item in _document()["paths"].items()
        if any("runs" in op.get("tags", []) for op in item.values())
    }

    assert set(INGEST_PATHS) == documented
    assert len(INGEST_PATHS) == 6


def test_the_change_set_report_is_the_one_put() -> None:
    methods = {path: set(item) for path, item in _document()["paths"].items()}

    assert methods[RUN_FILES_PATH] == {"put"}
    assert all(
        methods[path] == {"post"} for path in INGEST_PATHS if path != RUN_FILES_PATH
    )


@pytest.mark.parametrize(
    ("mirrored", "schema"),
    [
        (STAGE_STATUSES, "RunStageStatus"),
        (RETURN_KINDS, "RunStageReturnKind"),
        (RETURN_REASONS, "RunStageReturnReason"),
        (EVENT_ACTORS, "RunEventActor"),
        (FILE_STATUSES, "RunFileStatus"),
        (MERGE_STRATEGIES, "RunMergeStrategy"),
    ],
)
def test_every_vocabulary_is_the_published_one(
    mirrored: tuple[str, ...], schema: str
) -> None:
    assert list(mirrored) == _schema(schema)["enum"]


def test_the_hunk_line_kinds_and_guardrail_checks_are_the_published_ones() -> None:
    assert (
        list(HUNK_LINE_KINDS) == _schema("IngestHunkLine")["properties"]["kind"]["enum"]
    )
    assert (
        list(GUARDRAIL_CHECKS)
        == _schema("ChangeSet")["properties"]["guardrailFailures"]["items"]["enum"]
    )


@pytest.mark.parametrize(
    ("model", "schema"),
    [
        (TicketReference, "TicketReference"),
        (WorkflowPin, "WorkflowPin"),
        (OpenRunRequest, "OpenRunRequest"),
        (StageReturn, "StageReturn"),
        (StageTransitionRequest, "StageTransitionRequest"),
        (IngestEvent, "IngestEvent"),
        (IngestEventsRequest, "IngestEventsRequest"),
        (IngestFile, "IngestFile"),
        (IngestHunk, "IngestHunk"),
        (IngestHunkLine, "IngestHunkLine"),
        (ReportFilesRequest, "ReportFilesRequest"),
        (IngestCommit, "IngestCommit"),
        (ReportCommitsRequest, "ReportCommitsRequest"),
        (TokenSpend, "TokenSpend"),
        (ReportResourcesRequest, "ReportResourcesRequest"),
    ],
)
def test_a_request_sends_exactly_the_fields_the_document_declares(
    model: type[BaseModel], schema: str
) -> None:
    declared = _schema(schema)

    assert _wire(model) == set(declared["properties"])
    required = {
        field.alias or name
        for name, field in model.model_fields.items()
        if field.is_required()
    }
    assert required == set(declared.get("required", []))


@pytest.mark.parametrize(
    ("model", "schema"),
    [
        (RunOpened, "RunOpened"),
        (StageTransition, "StageTransition"),
        (EventsAppended, "EventsAppended"),
        (ChangeSet, "ChangeSet"),
        (CommitsAppended, "CommitsAppended"),
        (ResourcesReported, "ResourcesReported"),
    ],
)
def test_a_response_reads_every_field_the_document_requires(
    model: type[BaseModel], schema: str
) -> None:
    assert set(_schema(schema)["required"]) == _wire(model)


def test_no_body_can_claim_a_workspace_a_watermark_a_note_or_a_sequence() -> None:
    # The three absences AP.1's document calls the contract: the workspace is resolved,
    # `simulated` follows the principal, the note is composed and `seq` is allocated.
    assert "organizationId" not in _wire(OpenRunRequest)
    assert "simulated" not in _wire(OpenRunRequest)
    assert "note" not in _wire(StageTransitionRequest)
    assert {"seq", "simulated"}.isdisjoint(_wire(IngestEvent))


@pytest.mark.parametrize("code", INGEST_ERRORS)
def test_every_ingestion_refusal_named_here_is_documented(code: str) -> None:
    text = json.dumps({path: _document()["paths"][path] for path in INGEST_PATHS})

    assert code in text


def test_a_request_refuses_a_field_the_contract_does_not_define() -> None:
    with pytest.raises(ValidationError):
        StageTransitionRequest.model_validate(
            {
                "idempotencyKey": "k",
                "stageKey": "implement",
                "status": "active",
                "note": "a sentence the database composes",
            }
        )


@pytest.mark.parametrize("key", ["", " padded", "padded ", "x" * 129])
def test_an_idempotency_key_is_one_to_128_trimmed_characters(key: str) -> None:
    with pytest.raises(ValidationError):
        IngestEventsRequest(
            idempotency_key=key, events=[IngestEvent(hint=1, actor="system", body="x")]
        )


@pytest.mark.parametrize("sha", ["A41C9E2", "a41c9e", "g41c9e2", "a" * 41])
def test_a_commit_sha_is_7_to_40_lower_case_hex(sha: str) -> None:
    with pytest.raises(ValidationError):
        IngestCommit(sha=sha, message="m", committed_at="2026-09-22T14:30:12.000Z")


@pytest.mark.parametrize("cost", ["1.23456", "-1", "1e3", "12.", ""])
def test_a_cost_is_a_decimal_string_to_four_places(cost: str) -> None:
    with pytest.raises(ValidationError):
        TokenSpend(
            provider="anthropic", model="m", tokens_in=1, tokens_out=1, cost_cents=cost
        )


def test_a_response_ignores_a_field_a_later_control_plane_adds() -> None:
    appended = EventsAppended.model_validate(
        {
            "submitted": 1,
            "stored": 1,
            "firstSeq": 8,
            "lastSeq": 8,
            "hint": 22,
            "elided": False,
            "addedLater": True,
        }
    )

    assert appended.last_seq == 8


# --- the client -----------------------------------------------------------------------------


@pytest.fixture
def client() -> ControlPlaneClient:
    return ControlPlaneClient(BASE, SECRET)


def test_opening_a_run_posts_camel_case_with_the_key(
    client: ControlPlaneClient,
) -> None:
    request = client.open_run_request(
        OpenRunRequest(
            idempotency_key="sim-482-open",
            ticket=TicketReference(source="s", external_key="#482"),
            repository="r",
            workflow=WorkflowPin(tag="standard-fix", version=14),
            model="claude-fable-5",
        )
    )

    assert request.method == "POST"
    assert request.url == f"{BASE}{RUNS_PATH}"
    assert request.headers[INTERNAL_KEY_HEADER] == SECRET
    assert request.json == {
        "idempotencyKey": "sim-482-open",
        "ticket": {"source": "s", "externalKey": "#482"},
        "repository": "r",
        "workflow": {"tag": "standard-fix", "version": 14},
        "model": "claude-fable-5",
    }


def test_every_run_scoped_builder_addresses_the_run(client: ControlPlaneClient) -> None:
    requests = {
        "stage-transitions": client.transition_stage_request(
            RUN,
            StageTransitionRequest(
                idempotency_key="k", stage_key="implement", status="active"
            ),
        ),
        "events": client.append_events_request(
            RUN,
            IngestEventsRequest(
                idempotency_key="k",
                events=[IngestEvent(hint=1, actor="system", body="x")],
            ),
        ),
        "files": client.report_files_request(
            RUN, ReportFilesRequest(idempotency_key="k", files=[])
        ),
        "commits": client.report_commits_request(
            RUN,
            ReportCommitsRequest(
                idempotency_key="k",
                commits=[
                    IngestCommit(
                        sha="a41c9e2", message="m", committed_at="2026-09-22T14:30:12Z"
                    )
                ],
            ),
        ),
        "resources": client.report_resources_request(
            RUN, ReportResourcesRequest(idempotency_key="k")
        ),
    }

    for suffix, request in requests.items():
        assert request.url == f"{BASE}/internal/runs/{RUN}/{suffix}"
        assert request.headers[INTERNAL_KEY_HEADER] == SECRET
    assert requests["files"].method == "PUT"


def test_a_reservation_has_three_states_on_the_wire(client: ControlPlaneClient) -> None:
    unset = client.report_resources_request(
        RUN, ReportResourcesRequest(idempotency_key="k")
    )
    release = client.report_resources_request(
        RUN, ReportResourcesRequest(idempotency_key="k", reserved_build_job=None)
    )
    take = client.report_resources_request(
        RUN, ReportResourcesRequest(idempotency_key="k", reserved_build_job="job-1")
    )

    assert "reservedBuildJob" not in unset.json
    assert release.json["reservedBuildJob"] is None
    assert take.json["reservedBuildJob"] == "job-1"


def test_an_unpriced_spend_is_absent_not_null(client: ControlPlaneClient) -> None:
    request = client.report_resources_request(
        RUN,
        ReportResourcesRequest(
            idempotency_key="k",
            spend=TokenSpend(
                provider="ollama",
                model="qwen3",
                tokens_in=1,
                tokens_out=1,
                cost_cents=None,
            ),
        ),
    )

    assert "costCents" not in request.json["spend"]


def test_an_open_is_answered_with_201_and_anything_else_is_a_refusal(
    client: ControlPlaneClient,
) -> None:
    example = _document()["paths"][RUNS_PATH]["post"]["responses"]["201"]["content"][
        "application/json"
    ]["example"]

    opened = client.read_run_opened(HTTPStatus.CREATED, example)
    assert opened.simulated is True
    assert opened.loop_seq == 1847

    with pytest.raises(ControlPlaneError) as refused:
        client.read_run_opened(HTTPStatus.OK, example)
    assert refused.value.code == "unreadable_answer"


@pytest.mark.parametrize(
    ("path", "method", "reader"),
    [
        ("/internal/runs/{id}/stage-transitions", "post", "read_stage_transition"),
        ("/internal/runs/{id}/events", "post", "read_events_appended"),
        ("/internal/runs/{id}/files", "put", "read_change_set"),
        ("/internal/runs/{id}/commits", "post", "read_commits_appended"),
        ("/internal/runs/{id}/resources", "post", "read_resources_reported"),
    ],
)
def test_every_documented_example_is_an_answer_this_client_reads(
    client: ControlPlaneClient, path: str, method: str, reader: str
) -> None:
    responses = _document()["paths"][path][method]["responses"]
    example = responses["200"]["content"]["application/json"]["example"]

    parsed = getattr(client, reader)(HTTPStatus.OK, example)

    assert parsed.model_dump(by_alias=True, exclude_none=True).keys() <= set(example)


@pytest.mark.parametrize(
    ("path", "method", "status"),
    [
        ("/internal/runs/{id}/stage-transitions", "post", "409"),
        ("/internal/runs/{id}/events", "post", "409"),
        ("/internal/runs", "post", "404"),
    ],
)
def test_a_documented_refusal_arrives_as_its_own_code(
    client: ControlPlaneClient, path: str, method: str, status: str
) -> None:
    envelope = _document()["paths"][path][method]["responses"][status]["content"][
        "application/json"
    ]["example"]

    with pytest.raises(ControlPlaneError) as refused:
        client.read_stage_transition(int(status), envelope)

    assert refused.value.code == envelope["code"]
    assert refused.value.details == envelope["details"]
