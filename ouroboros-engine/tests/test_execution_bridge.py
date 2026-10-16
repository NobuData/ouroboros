"""The execution bridge's edges (#160): the routes, the worker, the registry, the client.

The interpreter itself is ``tests/test_execution_interpreter.py``'s.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import pytest
from fastapi.testclient import TestClient

from execution_fakes import RUN, FakeControl, chain, llm, term, trigger
from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.execution import (
    EXECUTION_PATHS,
    CheckpointRequest,
    FinishRunRequest,
)
from ouroboros_engine.control_plane.ingest import QueueItemClaimed, RunOpened
from ouroboros_engine.control_plane.ingest_client import IdempotencyKeys, IngestClient
from ouroboros_engine.control_plane.transport import Response, TransportError
from ouroboros_engine.execution.registry import ExecutorRegistry, UnknownExecutorError
from ouroboros_engine.execution.worker import ExecutionWorker
from ouroboros_engine.settings import load_settings
from stage_executor_fakes import FakeHarnessExecutor, FakeNativeExecutor, Script

EXECUTE = f"/v0/runs/{RUN}/execute"
CLAIMS = "/v0/execution/claims"

CLAIMED = {
    "id": "queue-1",
    "claimToken": "token-1",
    "expiresAt": "2026-10-15T14:30:00.000Z",
    "organizationId": "org-acme",
    "repository": "repo-1",
    "issueNumber": 160,
    "issueTitle": "Execute the pinned workflow",
    "workflow": {"tag": "docs-loop", "version": 3},
    "ticket": {"source": "source-1", "externalKey": "#160"},
    "model": "claude-sonnet-5-5",
}
OPENED = {
    "id": RUN,
    "loopSeq": 7,
    "organizationId": "org-acme",
    "issueNumber": 160,
    "issueTitle": "Execute the pinned workflow",
    "workflowTag": "docs-loop",
    "workflowVersionPin": 3,
    "model": "claude-sonnet-5-5",
    "simulated": False,
    "status": "coding",
    "startedAt": "2026-10-15T14:25:01.000Z",
}


def _native() -> FakeNativeExecutor:
    return FakeNativeExecutor(Script())


class Executed:
    """A recording ``execute`` coroutine that can be held open."""

    def __init__(self) -> None:
        """Record nothing yet; hold every run until released."""
        self.runs: list[str] = []
        self.release = threading.Event()

    async def __call__(self, run_id: str) -> None:
        """Record the run, then wait for the release."""
        self.runs.append(run_id)
        await asyncio.to_thread(self.release.wait, 5)


def _control() -> FakeControl:
    return FakeControl(
        chain(trigger(), llm("a"), term("b", "back_to_queue")), remote="unused"
    )


# --- the registry ---------------------------------------------------------------------------


def test_the_registry_starts_empty_and_lists_kinds_sorted() -> None:
    registry = ExecutorRegistry()
    assert (registry.kinds(), registry.default_kind()) == ([], None)

    registry.register("harness", lambda: FakeHarnessExecutor(Script()))
    registry.register("native", _native)

    assert registry.kinds() == ["harness", "native"]
    assert registry.default_kind() == "native"
    assert isinstance(registry.create("harness"), FakeHarnessExecutor)


def test_the_registry_refuses_an_unknown_kind() -> None:
    registry = ExecutorRegistry()
    with pytest.raises(ValueError, match="not an executor kind"):
        registry.register("shell", _native)
    with pytest.raises(UnknownExecutorError):
        registry.create("native")


# --- the worker -----------------------------------------------------------------------------


def test_no_executor_means_no_claim_and_no_execution() -> None:
    control = _control()
    worker = ExecutionWorker(control, ExecutorRegistry(), Executed(), worker="w")

    assert worker.claim("acme").reason == "no_executor"
    assert worker.submit(RUN).reason == "no_executor"
    assert control.calls == []


def test_claim_opens_the_run_from_the_lease_and_executes_it() -> None:
    control = _control()
    control.claimed = QueueItemClaimed.model_validate(CLAIMED)
    control.opened = RunOpened.model_validate(OPENED)
    registry = ExecutorRegistry()
    registry.register("native", _native)
    executed = Executed()
    executed.release.set()
    worker = ExecutionWorker(control, registry, executed, worker="engine-a")

    answer = worker.claim("acme")

    assert (answer.claimed, answer.run_id, answer.reason) == (True, RUN, None)
    assert control.bodies("claim") == [
        {"workspace": "acme", "worker": "engine-a", "executors": ["native"]}
    ]
    opened = control.bodies("open_run")[0]
    assert opened.queue_item.id == "queue-1"
    assert opened.queue_item.claim_token == "token-1"
    assert (opened.workflow.tag, opened.workflow.version) == ("docs-loop", 3)
    assert opened.model == "claude-sonnet-5-5"
    assert opened.ticket.external_key == "#160"
    assert worker.wait(RUN, 5)
    assert executed.runs == [RUN]


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"ticket": None}, "ticket_missing"),
        (
            {"workflow": {"tag": "docs-loop", "version": None}},
            "workflow_version_missing",
        ),
        ({"model": None}, "model_missing"),
    ],
)
def test_an_item_that_cannot_be_opened_is_left_to_lapse(
    change: dict[str, Any], reason: str
) -> None:
    control = _control()
    control.claimed = QueueItemClaimed.model_validate({**CLAIMED, **change})
    registry = ExecutorRegistry()
    registry.register("native", _native)
    worker = ExecutionWorker(control, registry, Executed(), worker="w")

    assert worker.claim("acme").reason == reason
    assert "open_run" not in control.ops()


def test_nothing_queued_and_refusals_are_reasons() -> None:
    control = _control()
    registry = ExecutorRegistry()
    registry.register("native", _native)
    worker = ExecutionWorker(control, registry, Executed(), worker="w")

    assert worker.claim("acme").reason == "nothing_queued"

    def refused(*_args: Any, **_kwargs: Any) -> None:
        raise ControlPlaneError("concurrency_ceiling", "full", 409)

    control.claim = refused  # type: ignore[method-assign]
    assert worker.claim("acme").reason == "concurrency_ceiling"

    def unreachable(*_args: Any, **_kwargs: Any) -> None:
        raise TransportError("down")

    control.claim = unreachable  # type: ignore[method-assign]
    assert worker.claim("acme").reason == "control_plane_unreachable"


def test_a_run_already_executing_here_is_not_started_twice() -> None:
    registry = ExecutorRegistry()
    registry.register("native", _native)
    executed = Executed()
    worker = ExecutionWorker(_control(), registry, executed, worker="w")

    assert worker.submit(RUN).accepted
    assert worker.submit(RUN.upper()).reason == "already_running"
    assert worker.holds(RUN)
    executed.release.set()
    assert worker.wait(RUN, 5)
    assert not worker.holds(RUN)
    assert executed.runs == [RUN]


# --- the routes -----------------------------------------------------------------------------


def test_both_routes_need_the_internal_key(anonymous_client: TestClient) -> None:
    assert anonymous_client.post(EXECUTE).status_code == 401
    assert anonymous_client.post(CLAIMS, json={"workspace": "acme"}).status_code == 401


def test_execute_without_an_executor_is_refused_in_a_202(
    client_without_harness: TestClient,
) -> None:
    response = client_without_harness.post(EXECUTE)

    assert response.status_code == 202
    assert response.json() == {"accepted": False, "reason": "no_executor"}


def test_execute_with_an_executor_starts_in_the_background(client: TestClient) -> None:
    app = client.app
    executed = Executed()
    app.state.executors.register("native", _native)
    app.state.execution = ExecutionWorker(
        _control(), app.state.executors, executed, worker="w"
    )

    first = client.post(EXECUTE)
    second = client.post(EXECUTE)
    executed.release.set()

    assert (first.status_code, first.json()) == (
        202,
        {"accepted": True, "reason": None},
    )
    assert second.json() == {"accepted": False, "reason": "already_running"}
    assert app.state.execution.wait(RUN, 5)


def test_claims_without_an_executor_claim_nothing(
    client_without_harness: TestClient,
) -> None:
    response = client_without_harness.post(CLAIMS, json={"workspace": "acme"})

    assert response.status_code == 200
    assert response.json() == {
        "claimed": False,
        "run_id": None,
        "reason": "no_executor",
    }


def test_claims_answer_the_run_they_opened(client: TestClient) -> None:
    app = client.app
    control = _control()
    control.claimed = QueueItemClaimed.model_validate(CLAIMED)
    control.opened = RunOpened.model_validate(OPENED)
    executed = Executed()
    executed.release.set()
    app.state.executors.register("native", _native)
    app.state.execution = ExecutionWorker(
        control, app.state.executors, executed, worker="w"
    )

    response = client.post(CLAIMS, json={"workspace": "acme"})

    assert response.json() == {"claimed": True, "run_id": RUN, "reason": None}
    assert app.state.execution.wait(RUN, 5)
    assert executed.runs == [RUN]


def test_claims_refuse_a_body_without_a_workspace(client: TestClient) -> None:
    assert client.post(CLAIMS, json={}).status_code == 422


# --- the client -----------------------------------------------------------------------------


class Recorded:
    """A transport that records requests and answers from a script."""

    def __init__(self, *answers: Response) -> None:
        """Hold the answers, in order."""
        self.answers = list(answers)
        self.sent: list[Any] = []

    def send(self, outgoing: Any) -> Response:
        """Record the request; answer the next response."""
        self.sent.append(outgoing)
        return self.answers.pop(0)


def _client(*answers: Response) -> tuple[IngestClient, Recorded]:
    transport = Recorded(*answers)
    return (
        IngestClient(
            ControlPlaneClient("http://rest.invalid", "k"),
            transport,
            IdempotencyKeys("engine-a"),
        ),
        transport,
    )


def test_the_execution_paths_are_the_contracts() -> None:
    assert EXECUTION_PATHS == (
        "/internal/runs/{id}/start",
        "/internal/runs/{id}/heartbeat",
        "/internal/runs/{id}/checkpoint",
        "/internal/runs/{id}/push",
        "/internal/runs/{id}/push/result",
        "/internal/runs/{id}/finish",
    )


def test_start_sends_the_worker_and_reads_the_brief() -> None:
    brief = {
        "run_id": RUN,
        "epoch": 3,
        "organization_id": "org-acme",
        "issue_number": 42,
        "issue_title": "t",
        "issue_body": None,
        "model": "m",
        "branch_name": f"ouro/run-{RUN}-42",
        "workflow": {
            "tag": "docs-loop",
            "version": 1,
            "document": {"dsl_version": "1.0"},
        },
        "repository": {
            "id": "r",
            "slug": "o/n",
            "default_branch": "main",
            "ref": {
                "workspace": "org",
                "slug": "o/n",
                "remote": "https://x/o/n.git",
                "token": None,
            },
        },
        "protected_paths": ["boot/**"],
        "base_commit": None,
        "checkpoint": None,
        "status": "coding",
    }
    ingest, transport = _client(Response(200, brief))

    started = ingest.start(RUN, "engine-a")

    sent = transport.sent[0]
    assert (sent.method, sent.url) == (
        "POST",
        f"http://rest.invalid/internal/runs/{RUN}/start",
    )
    assert sent.json == {"worker": "engine-a"}
    assert (started.epoch, started.workflow.version) == (3, 1)
    assert started.workflow.document == {"dsl_version": "1.0"}
    assert started.repository.ref.remote == "https://x/o/n.git"
    # An answer that predates labels and effort still parses.
    assert (started.labels, started.effort) == ([], None)


def test_start_reads_the_tickets_labels_and_effort() -> None:
    from ouroboros_engine.control_plane.execution import RunStarted

    started = RunStarted.model_validate(
        {
            "run_id": RUN,
            "epoch": 1,
            "organization_id": "o",
            "issue_number": 1,
            "issue_title": "t",
            "labels": ["docs", "bug"],
            "effort": "m",
            "model": "m",
            "workflow": {"tag": "t", "version": 1, "document": {}},
            "repository": {
                "id": "r",
                "slug": "o/n",
                "default_branch": None,
                "ref": {"workspace": "o", "slug": "o/n", "remote": "https://x"},
            },
            "status": "coding",
        }
    )

    assert (started.labels, started.effort) == (["docs", "bug"], "m")


def test_heartbeat_checkpoint_and_finish_carry_the_epoch() -> None:
    ingest, transport = _client(
        Response(200, {"epoch": 2, "heartbeatAt": "2026-10-15T12:00:00Z"}),
        Response(200, {"checkpointAt": "2026-10-15T12:00:01Z"}),
        Response(200, {"runId": RUN, "status": "failed", "requeuedQueueItemId": "q2"}),
    )

    ingest.heartbeat(RUN, 2)
    ingest.checkpoint(
        RUN, CheckpointRequest(epoch=2, base_commit="a" * 40, state={"position": "x"})
    )
    finished = ingest.finish(
        RUN,
        FinishRunRequest(
            epoch=2, idempotency_key="k1", outcome="back_to_queue", reason="r"
        ),
    )

    heartbeat, checkpoint, finish = transport.sent
    assert heartbeat.json == {"epoch": 2}
    assert checkpoint.method == "PUT"
    assert checkpoint.json == {
        "epoch": 2,
        "base_commit": "a" * 40,
        "state": {"position": "x"},
    }
    assert finish.json == {
        "epoch": 2,
        "idempotency_key": "k1",
        "outcome": "back_to_queue",
        "reason": "r",
    }
    assert finished.requeued_queue_item_id == "q2"


def test_a_fenced_answer_is_a_refusal_carrying_the_current_epoch() -> None:
    ingest, _ = _client(
        Response(
            409,
            {"code": "fenced", "message": "stale", "details": {"current_epoch": 4}},
        )
    )

    with pytest.raises(ControlPlaneError) as refused:
        ingest.heartbeat(RUN, 3)

    assert refused.value.code == "fenced"
    assert refused.value.details == {"current_epoch": 4}


def test_a_claim_declares_its_executors_and_reads_the_model() -> None:
    ingest, transport = _client(Response(200, CLAIMED))

    claimed = ingest.claim("acme", "engine-a", executors=["native"])

    assert transport.sent[0].json["executors"] == ["native"]
    assert claimed is not None and claimed.model == "claude-sonnet-5-5"


def test_a_claim_without_executors_leaves_the_field_out() -> None:
    ingest, transport = _client(Response(204, {}))

    assert ingest.claim("acme", "engine-a") is None
    assert "executors" not in transport.sent[0].json


# --- settings -------------------------------------------------------------------------------


def test_the_heartbeat_and_worker_settings_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("socket.gethostname", lambda: "engine-host")
    settings = load_settings()

    assert settings.engine_heartbeat_seconds == 5
    assert settings.engine_worker_id == "engine-host"


@pytest.mark.parametrize("value", ["0", "61", "five"])
def test_a_heartbeat_outside_one_to_sixty_is_refused(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    from ouroboros_engine.settings import SettingsError

    monkeypatch.setenv("OURO_ENGINE_HEARTBEAT_SECONDS", value)
    with pytest.raises(SettingsError, match="OURO_ENGINE_HEARTBEAT_SECONDS"):
        load_settings()


def test_the_worker_id_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OURO_ENGINE_WORKER_ID", "engine-worker-a")
    monkeypatch.setenv("OURO_ENGINE_HEARTBEAT_SECONDS", "1")

    settings = load_settings()

    assert (settings.engine_worker_id, settings.engine_heartbeat_seconds) == (
        "engine-worker-a",
        1,
    )
