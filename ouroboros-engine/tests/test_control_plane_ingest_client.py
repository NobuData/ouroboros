"""The engine's ingestion client (#91): keys, retry, the claim, and every report sent.

Driven through a recorded transport, so what is asserted is exactly what would go on the wire
and how each answer is read. The transport's own retry matrix is
``tests/test_simulator_transport.py``'s — it is the same class, moved into the package — and the
last tests here pin that the package's transport is that one and retries a keyed request whole.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from ouroboros_engine.control_plane import transport as package_transport
from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.ingest import (
    IngestEventsRequest,
    OpenRunRequest,
    ReportResourcesRequest,
    StageTransitionRequest,
    TokenSpend,
    WorkflowPin,
)
from ouroboros_engine.control_plane.ingest_client import (
    MAX_KEY_PREFIX,
    IdempotencyKeys,
    IngestClient,
)
from ouroboros_engine.control_plane.transport import (
    HttpTransport,
    Response,
    TransportError,
)
from ouroboros_simulator import transport as simulator_transport

REST = "http://rest.invalid"
RUN = "5eed0009-0000-4000-8000-000000000482"

CLAIMED = {
    "id": "5eed0008-0000-4000-8000-000000000001",
    "claimToken": "0b6a1c55-3f2e-4a7d-9c1e-2d8f4b6a9e10",
    "expiresAt": "2026-10-15T14:30:00.000Z",
    "organizationId": "org-acme",
    "repository": "5eed0003-0000-4000-8000-000000000001",
    "issueNumber": 482,
    "issueTitle": "Fix flaky CAN-bus telemetry test",
    "workflow": {"tag": "standard-fix", "version": 14},
    "playbookId": None,
    "ticket": {"source": "8f14e45f-ceea-467a-9f0a-4a1c7c3b2d55", "externalKey": "#482"},
}

OPENED = {
    "id": RUN,
    "loopSeq": 1847,
    "organizationId": "org-acme",
    "issueNumber": 482,
    "issueTitle": "Fix flaky CAN-bus telemetry test",
    "workflowTag": "standard-fix",
    "workflowVersionPin": 14,
    "branchName": None,
    "mergeStrategy": None,
    "model": "claude-fable-5",
    "simulated": False,
    "status": "coding",
    "startedAt": "2026-10-15T14:25:01.000Z",
}


class Recorded:
    """A transport that answers from a script and records every request it was given."""

    def __init__(self, *answers: Response) -> None:
        """Hold the answers, in order."""
        self.answers = list(answers)
        self.sent: list[Any] = []

    def send(self, outgoing: Any) -> Response:
        """Record the request and answer the next scripted response."""
        self.sent.append(outgoing)
        return self.answers.pop(0)


def ingest(*answers: Response) -> tuple[IngestClient, Recorded]:
    """An ingestion client over a recorded transport."""
    recorded = Recorded(*answers)
    client = IngestClient(
        ControlPlaneClient(REST, "secret"), recorded, IdempotencyKeys("engine-worker-a")
    )
    return client, recorded


# -- keys ------------------------------------------------------------------------------------


def test_a_key_names_the_sender_and_the_operation_and_is_new_every_time() -> None:
    keys = IdempotencyKeys("engine-worker-a")

    first, second = keys.key("run.create"), keys.key("run.create")

    assert re.fullmatch(r"engine-worker-a-run\.create-[0-9a-f]{32}", first)
    assert first != second
    assert len(first) <= 128


@pytest.mark.parametrize("prefix", ["", "has space", "x" * (MAX_KEY_PREFIX + 1)])
def test_a_prefix_a_key_could_not_carry_is_refused(prefix: str) -> None:
    with pytest.raises(ValueError, match="key prefix"):
        IdempotencyKeys(prefix)


# -- the claim -------------------------------------------------------------------------------


def test_a_claim_names_the_workspace_and_the_worker_and_reads_the_lease() -> None:
    client, recorded = ingest(Response(200, CLAIMED))

    claimed = client.claim("acme-robotics", "engine-worker-a")

    [sent] = recorded.sent
    assert sent.method == "POST"
    assert sent.url == f"{REST}/internal/queue/claim"
    assert sent.json["workspace"] == "acme-robotics"
    assert sent.json["worker"] == "engine-worker-a"
    assert sent.json["idempotencyKey"].startswith("engine-worker-a-claim-")
    assert claimed is not None
    assert claimed.issue_number == 482
    assert claimed.lease().claim_token == CLAIMED["claimToken"]
    assert claimed.ticket is not None
    assert claimed.ticket.reference().external_key == "#482"


def test_an_empty_queue_is_no_claim_rather_than_an_error() -> None:
    client, _ = ingest(Response(204, {}))

    assert client.claim("acme-robotics", "engine-worker-a") is None


@pytest.mark.parametrize(
    "code", ["deployment_disabled", "workspace_paused", "workspace_not_found"]
)
def test_a_refused_claim_raises_the_control_plane_s_code(code: str) -> None:
    status = 404 if code == "workspace_not_found" else 409
    client, _ = ingest(
        Response(status, {"code": code, "message": "No.", "details": {}})
    )

    with pytest.raises(ControlPlaneError) as refused:
        client.claim("acme-robotics", "engine-worker-a")

    assert refused.value.code == code


def test_a_claimed_item_without_a_mirrored_ticket_says_so() -> None:
    client, _ = ingest(Response(200, {**CLAIMED, "ticket": None}))

    claimed = client.claim("acme-robotics", "engine-worker-a")

    assert claimed is not None and claimed.ticket is None


# -- opening the run from it, and the reports ------------------------------------------------


def test_the_run_is_opened_from_the_claimed_item_s_lease() -> None:
    client, recorded = ingest(Response(200, CLAIMED), Response(201, OPENED))
    claimed = client.claim("acme-robotics", "engine-worker-a")
    assert claimed is not None and claimed.ticket is not None

    run = client.open_run(
        OpenRunRequest(
            idempotency_key=client.key("run.create"),
            ticket=claimed.ticket.reference(),
            repository=claimed.repository,
            workflow=WorkflowPin(tag=claimed.workflow.tag, version=14),
            model="claude-fable-5",
            queue_item=claimed.lease(),
        )
    )

    opened = recorded.sent[1]
    assert opened.url == f"{REST}/internal/runs"
    assert opened.json["queueItem"] == {
        "id": CLAIMED["id"],
        "claimToken": CLAIMED["claimToken"],
    }
    assert run.id == RUN


def test_a_lost_lease_is_the_control_plane_s_refusal() -> None:
    client, _ = ingest(
        Response(
            409, {"code": "queue_claim_lost", "message": "Claim again.", "details": {}}
        )
    )

    with pytest.raises(ControlPlaneError) as refused:
        client.open_run(
            OpenRunRequest(
                idempotency_key=client.key("run.create"),
                ticket={"source": "s", "external_key": "#482"},
                repository="r",
                workflow=WorkflowPin(tag="standard-fix", version=14),
                model="m",
                queue_item={"id": "q", "claim_token": "t"},
            )
        )

    assert refused.value.code == "queue_claim_lost"


def test_each_report_goes_to_its_run_s_route_and_is_read() -> None:
    client, recorded = ingest(
        Response(
            200,
            {
                "runStageId": "s1",
                "stageKey": "implement",
                "stageLabel": "Implement",
                "position": 2,
                "attempt": 1,
                "status": "active",
            },
        ),
        Response(
            200,
            {
                "submitted": 1,
                "stored": 1,
                "firstSeq": 1,
                "lastSeq": 1,
                "hint": 1,
                "elided": False,
            },
        ),
        Response(
            200,
            {"tokensIn": 1200, "tokensOut": 80, "costCents": None, "unpricedEvents": 1},
        ),
    )

    stage = client.transition(
        RUN,
        StageTransitionRequest(
            idempotency_key=client.key("run.stage"),
            stage_key="implement",
            status="active",
        ),
    )
    appended = client.events(
        RUN,
        IngestEventsRequest(
            idempotency_key=client.key("run.events"),
            events=[{"hint": 1, "actor": "system", "body": "Started."}],
        ),
    )
    totals = client.resources(
        RUN,
        ReportResourcesRequest(
            idempotency_key=client.key("run.resources"),
            spend=TokenSpend(
                provider="anthropic",
                model="claude-sonnet-5-5",
                tokens_in=1200,
                tokens_out=80,
                stage="implement",
                attempt=2,
            ),
        ),
    )

    assert [sent.url for sent in recorded.sent] == [
        f"{REST}/internal/runs/{RUN}/stage-transitions",
        f"{REST}/internal/runs/{RUN}/events",
        f"{REST}/internal/runs/{RUN}/resources",
    ]
    assert (stage.stage_key, appended.stored, totals.tokens_in) == (
        "implement",
        1,
        1200,
    )
    # #91: the spend is attributed to its stage and attempt on the wire.
    assert recorded.sent[2].json["spend"]["stage"] == "implement"
    assert recorded.sent[2].json["spend"]["attempt"] == 2
    # Each submission carried a key of its own.
    keys = [sent.json["idempotencyKey"] for sent in recorded.sent]
    assert len(set(keys)) == 3


# -- the transport is the package's, and it retries a keyed request whole --------------------


def test_the_simulator_s_transport_is_the_package_s() -> None:
    assert simulator_transport.HttpTransport is package_transport.HttpTransport
    assert simulator_transport.TransportError is package_transport.TransportError


def test_a_retried_claim_is_the_same_keyed_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[Any] = []
    answers = [Response(503, {}), Response(200, CLAIMED)]

    def once(_self: HttpTransport, outgoing: Any) -> Response:
        sent.append(outgoing)
        return answers.pop(0)

    monkeypatch.setattr(HttpTransport, "_once", once)
    client = IngestClient(
        ControlPlaneClient(REST, "secret"),
        HttpTransport(sleep=lambda _seconds: None),
        IdempotencyKeys("engine-worker-a"),
    )

    claimed = client.claim("acme-robotics", "engine-worker-a")

    assert claimed is not None
    assert len(sent) == 2
    assert sent[0] is sent[1]
    assert sent[0].json["idempotencyKey"] == sent[1].json["idempotencyKey"]


def test_a_control_plane_that_never_answers_is_a_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        HttpTransport, "_once", lambda _self, _outgoing: Response(504, {})
    )
    client = IngestClient(
        ControlPlaneClient(REST, "secret"),
        HttpTransport(sleep=lambda _seconds: None),
        IdempotencyKeys("engine-worker-a"),
    )

    with pytest.raises(TransportError):
        client.claim("acme-robotics", "engine-worker-a")
