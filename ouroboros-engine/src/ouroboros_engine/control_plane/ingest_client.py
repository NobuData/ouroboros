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

**A harness attempt** (DH.3, #1308) adds three more — :meth:`IngestClient.mint_credential`,
:meth:`~IngestClient.reconcile_credential` and :meth:`~IngestClient.revoke_credential` — over
DH.2's credential routes (:mod:`ouroboros_engine.control_plane.harness`).
"""

from __future__ import annotations

from uuid import uuid4

from ouroboros_engine.control_plane.builds import (
    RunBuild,
    RunBuildCancelRequest,
    RunBuildRequest,
)
from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.contract import AckedControl, ControlsFetched
from ouroboros_engine.control_plane.execution import (
    CheckpointRequest,
    CheckpointSaved,
    FinishRunRequest,
    HeartbeatAccepted,
    HeartbeatRequest,
    PushGrant,
    PushRecorded,
    PushRequest,
    PushResultRequest,
    RunFinished,
    RunStarted,
    StartRunRequest,
)
from ouroboros_engine.control_plane.harness import (
    HarnessCredential,
    HarnessCredentialRequest,
    HarnessReconcileRequest,
    HarnessReconciliation,
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

    def push(self, run: str, body: PushRequest) -> PushGrant:
        """Ask to push the run's branch (DI.2, #1310).

        Args:
            run: The run.
            body: The branch, the head and the change-set, keyed.

        Returns:
            The refspec, the remote and this one push's credential.
        """
        answer = self._transport.send(self._client.push_request(run, body))
        return self._client.read_push_grant(answer.status, answer.body)

    def push_result(self, run: str, body: PushResultRequest) -> PushRecorded:
        """Record what a push did (DI.2, #1310).

        Args:
            run: The run.
            body: The outcome, keyed.

        Returns:
            That it was recorded.
        """
        answer = self._transport.send(self._client.push_result_request(run, body))
        return self._client.read_push_recorded(answer.status, answer.body)

    def build(self, run: str, body: RunBuildRequest) -> RunBuild:
        """Submit a build stage's job to the farm (AJ.3, #265).

        Args:
            run: The run.
            body: The stage and attempt, the pool, the pushed commit and the command, keyed.

        Returns:
            The job.
        """
        answer = self._transport.send(self._client.build_request(run, body))
        return self._client.read_build(answer.status, answer.body)

    def read_build(self, run: str, job: str) -> RunBuild:
        """Read where one of the run's builds is now (AJ.3, #265).

        Args:
            run: The run.
            job: The job the submission answered.

        Returns:
            The latest attempt of its retry chain.
        """
        answer = self._transport.send(self._client.build_read_request(run, job))
        return self._client.read_build(answer.status, answer.body)

    def cancel_build(self, run: str, job: str, body: RunBuildCancelRequest) -> RunBuild:
        """Give up on one of the run's builds (AJ.3, #265).

        Args:
            run: The run.
            job: The job.
            body: The key, the epoch and why.

        Returns:
            The latest attempt — ``canceled`` unless it had already finished.
        """
        answer = self._transport.send(self._client.build_cancel_request(run, job, body))
        return self._client.read_build(answer.status, answer.body)

    # --- run controls (AP.4, #306; honoured by the interpreter since #315) -------------------

    def fetch_controls(self, run: str) -> ControlsFetched:
        """Claim a run's pending controls.

        Args:
            run: The run.

        Returns:
            The claimed controls, oldest first — now ``delivered`` and this worker's to
            acknowledge.
        """
        answer = self._transport.send(self._client.fetch_controls_request(run))
        return self._client.read_controls(answer.status, answer.body)

    def ack_control(
        self,
        run: str,
        control: str,
        *,
        effect: str | None = None,
        attempt: int | None = None,
    ) -> AckedControl:
        """Acknowledge one control with the effect it had.

        Args:
            run: The run.
            control: The control's id, as the fetch handed it over.
            effect: What was done, in the engine's words, or ``None`` for the control
                plane's own sentence.
            attempt: For a steer, the attempt it landed on.

        Returns:
            The control, acknowledged. A refusal (``control_not_delivered`` carries the
            control's state) is raised as for every other call.
        """
        answer = self._transport.send(
            self._client.ack_control_request(
                run, control, effect=effect, attempt=attempt
            )
        )
        return self._client.read_ack(answer.status, answer.body)

    # --- harness credentials (DH.3, #1308) ---------------------------------------------------

    def mint_credential(self, body: HarnessCredentialRequest) -> HarnessCredential:
        """Mint the run-scoped credential a harness attempt calls the facade with.

        Args:
            body: The run, stage, alias and attempt.

        Returns:
            The credential; its token is shown this once.
        """
        answer = self._transport.send(
            self._client.mint_harness_credential_request(body)
        )
        return self._client.read_harness_credential(answer.status, answer.body)

    def reconcile_credential(
        self, credential: str, body: HarnessReconcileRequest
    ) -> HarnessReconciliation:
        """Report a session's own per-model totals against the facade's usage rows.

        Args:
            credential: The credential's id.
            body: The SDK's ``modelUsage``.

        Returns:
            The comparison.
        """
        answer = self._transport.send(
            self._client.reconcile_harness_credential_request(credential, body)
        )
        return self._client.read_harness_reconciliation(answer.status, answer.body)

    def revoke_credential(self, credential: str) -> None:
        """Revoke a credential when its attempt ends.

        Args:
            credential: The credential's id.
        """
        answer = self._transport.send(
            self._client.revoke_harness_credential_request(credential)
        )
        self._client.read_harness_revoked(answer.status, answer.body)
