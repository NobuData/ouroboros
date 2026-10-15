"""The engine's ingestion client — #91 (J.3, narrowed by its DG.1 amendment).

AP.1 (#303) built the contract every executor reports a run through, and
:class:`~ouroboros_engine.control_plane.client.ControlPlaneClient` builds and reads each of its
requests without sending anything. This joins the three things an executor needs to *use* it:

* the **builders and readers** — :class:`ControlPlaneClient`;
* a **sender with retry** — :class:`~ouroboros_engine.control_plane.transport.HttpTransport`,
  which retries a dropped connection or a ``502``/``503``/``504`` with the same request;
* **idempotency keys** — :class:`IdempotencyKeys`, one per submission.

**Consuming the queue** is two calls, so a worker that dies between them loses nothing::

    claimed = ingest.claim("acme-robotics", worker="engine-worker-a")  # lease the head
    if claimed is not None and claimed.ticket is not None:
        run = ingest.open_run(
            OpenRunRequest(
                idempotency_key=ingest.key("run.create"),
                ticket=claimed.ticket.reference(),
                repository=claimed.repository,
                workflow=WorkflowPin(tag=..., version=...),
                model=...,
                queue_item=claimed.lease(),  # the open removes the item
            )
        )

**A submission is keyed once.** A report body carries its key: build it with :meth:`key`, and
to re-send it — after the transport gave up, or the process restarted — send the *same* body,
so the control plane answers the first delivery's result rather than recording it twice.

**Executing a run** (#160) adds four calls — :meth:`IngestClient.start`,
:meth:`~IngestClient.heartbeat`, :meth:`~IngestClient.checkpoint` and
:meth:`~IngestClient.finish` — and :mod:`ouroboros_engine.execution.interpreter` is their
caller: it starts a run for an epoch and carries that epoch on every report.
"""

from __future__ import annotations

from uuid import uuid4

from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.execution import (
    CheckpointRequest,
    CheckpointSaved,
    FinishRunRequest,
    HeartbeatAccepted,
    HeartbeatRequest,
    RunFinished,
    RunStarted,
    StartRunRequest,
)
from ouroboros_engine.control_plane.ingest import (
    ChangeSet,
    ClaimQueueItemRequest,
    CommitsAppended,
    EventsAppended,
    IngestEventsRequest,
    OpenRunRequest,
    QueueItemClaimed,
    ReportCommitsRequest,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageTransition,
    StageTransitionRequest,
)
from ouroboros_engine.control_plane.transport import Transport

#: The longest prefix a key may carry, leaving room for the operation and a uuid within the
#: contract's 128 characters.
MAX_KEY_PREFIX = 64


class IdempotencyKeys:
    """Names submissions: ``<prefix>-<operation>-<uuid>``, unique per call.

    The prefix says who sent it — a worker's name — so a key in the control plane's receipts
    can be traced to the process that sent it; the uuid makes two submissions of one operation
    two keys. The *same* submission re-sent reuses the key it was built with; this never
    produces it again.
    """

    def __init__(self, prefix: str) -> None:
        """Hold the prefix.

        Args:
            prefix: Who is sending — a worker's name. Whitespace-free, at most
                :data:`MAX_KEY_PREFIX` characters.

        Raises:
            ValueError: If the prefix is empty, too long, or contains whitespace.
        """
        if (
            not prefix
            or len(prefix) > MAX_KEY_PREFIX
            or any(c.isspace() for c in prefix)
        ):
            raise ValueError(
                f"a key prefix is 1 to {MAX_KEY_PREFIX} characters with no whitespace"
            )
        self._prefix = prefix

    def key(self, operation: str) -> str:
        """A fresh key for one submission of one operation.

        Args:
            operation: Which operation — ``claim``, ``run.create``, ``run.events``.

        Returns:
            The key.
        """
        return f"{self._prefix}-{operation}-{uuid4().hex}"


class IngestClient:
    """Sends AP.1's reports and #91's claim, retrying what is safe to retry.

    Every method sends one request through the transport and reads the answer with the
    client: a refusal is a :class:`~ouroboros_engine.control_plane.client.ControlPlaneError`
    carrying the control plane's code, and a control plane that could not be reached after the
    transport's retries is a
    :class:`~ouroboros_engine.control_plane.transport.TransportError`.
    """

    def __init__(
        self, client: ControlPlaneClient, transport: Transport, keys: IdempotencyKeys
    ) -> None:
        """Hold the three collaborators.

        Args:
            client: Builds each request and reads each answer.
            transport: Sends them, with retry.
            keys: Names each submission.
        """
        self._client = client
        self._transport = transport
        self._keys = keys

    def key(self, operation: str) -> str:
        """A fresh idempotency key for a report this worker is about to build.

        Args:
            operation: Which operation.

        Returns:
            The key.
        """
        return self._keys.key(operation)

    def claim(
        self, workspace: str, worker: str, executors: list[str] | None = None
    ) -> QueueItemClaimed | None:
        """Lease the head of a workspace's queue.

        Keyed here, once, and the transport retries the keyed request — so a claim whose
        answer was lost and is re-delivered answers the item it leased, never a second one.

        Args:
            workspace: ``organization.id`` or its slug.
            worker: This worker's name.
            executors: The executor kinds this worker has registered (#1312), or ``None``
                to let the control plane ask the engine's status.

        Returns:
            The item and its lease, or ``None`` when nothing is claimable.
        """
        body = ClaimQueueItemRequest.model_validate(
            {
                "idempotency_key": self.key("claim"),
                "workspace": workspace,
                "worker": worker,
                "executors": executors,
            }
        )
        answer = self._transport.send(self._client.claim_queue_item_request(body))
        return self._client.read_claim(answer.status, answer.body)

    def open_run(self, body: OpenRunRequest) -> RunOpened:
        """Open a run — from a claimed queue item when ``body.queue_item`` names its lease.

        Args:
            body: The run to open, keyed.

        Returns:
            The run.
        """
        answer = self._transport.send(self._client.open_run_request(body))
        return self._client.read_run_opened(answer.status, answer.body)

    def transition(self, run: str, body: StageTransitionRequest) -> StageTransition:
        """Move one stage attempt.

        Args:
            run: The run.
            body: The transition, keyed.

        Returns:
            Where the stage stands.
        """
        answer = self._transport.send(self._client.transition_stage_request(run, body))
        return self._client.read_stage_transition(answer.status, answer.body)

    def events(self, run: str, body: IngestEventsRequest) -> EventsAppended:
        """Append a batch of transcript entries.

        Args:
            run: The run.
            body: The batch, keyed.

        Returns:
            The sequence numbers assigned.
        """
        answer = self._transport.send(self._client.append_events_request(run, body))
        return self._client.read_events_appended(answer.status, answer.body)

    def files(self, run: str, body: ReportFilesRequest) -> ChangeSet:
        """Report the whole change-set.

        Args:
            run: The run.
            body: The change-set, keyed.

        Returns:
            The change-set as recorded.
        """
        answer = self._transport.send(self._client.report_files_request(run, body))
        return self._client.read_change_set(answer.status, answer.body)

    def commits(self, run: str, body: ReportCommitsRequest) -> CommitsAppended:
        """Append commits, oldest first.

        Args:
            run: The run.
            body: The commits, keyed.

        Returns:
            The commits as recorded.
        """
        answer = self._transport.send(self._client.report_commits_request(run, body))
        return self._client.read_commits_appended(answer.status, answer.body)

    def resources(self, run: str, body: ReportResourcesRequest) -> ResourcesReported:
        """Attribute spend — by stage and attempt (#91) — and take or release a build job.

        Args:
            run: The run.
            body: The report, keyed.

        Returns:
            The run's totals.
        """
        answer = self._transport.send(self._client.report_resources_request(run, body))
        return self._client.read_resources_reported(answer.status, answer.body)

    def start(self, run: str, worker: str) -> RunStarted:
        """Take a run for execution: its epoch is incremented and the brief answered (#160).

        Args:
            run: The run.
            worker: This worker's name.

        Returns:
            The epoch this worker now holds and everything executing the run needs.
        """
        body = StartRunRequest(worker=worker)
        answer = self._transport.send(self._client.start_run_request(run, body))
        return self._client.read_run_started(answer.status, answer.body)

    def heartbeat(self, run: str, epoch: int) -> HeartbeatAccepted:
        """Say this worker still holds a run.

        Args:
            run: The run.
            epoch: The epoch held.

        Returns:
            When the heartbeat was recorded.
        """
        body = HeartbeatRequest(epoch=epoch)
        answer = self._transport.send(self._client.heartbeat_request(run, body))
        return self._client.read_heartbeat(answer.status, answer.body)

    def checkpoint(self, run: str, body: CheckpointRequest) -> CheckpointSaved:
        """Store the interpreter's state, and the base commit once.

        Args:
            run: The run.
            body: The epoch, the state and the base commit.

        Returns:
            When it was stored.
        """
        answer = self._transport.send(self._client.checkpoint_request(run, body))
        return self._client.read_checkpoint(answer.status, answer.body)

    def finish(self, run: str, body: FinishRunRequest) -> RunFinished:
        """End a run.

        Args:
            run: The run.
            body: The outcome, keyed.

        Returns:
            The run's status afterwards.
        """
        answer = self._transport.send(self._client.finish_run_request(run, body))
        return self._client.read_run_finished(answer.status, answer.body)
