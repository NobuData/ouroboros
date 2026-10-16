"""Every write an executing run makes, epoch-fenced — and the worker's end when one is refused.

#160, ADR decision A.2. One :class:`RunReporter` per execution holds the epoch ``start``
answered and puts it on every write: stage transitions, transcript batches, the change-set,
spend, checkpoints and the finish. When the control plane answers ``409 fenced`` (another
worker holds the run) or ``409 run_not_executable`` (a person cancelled it, or it ended), the
reporter is *lost*: it raises :class:`RunLostError` and refuses every later write without
sending it. The heartbeat (:mod:`~ouroboros_engine.execution.heartbeat`) marks it lost the
same way, so a zombie worker writes nothing after its heartbeat is refused.

The control plane is reached through :class:`RunControl`, which
:class:`~ouroboros_engine.control_plane.ingest_client.IngestClient` satisfies and a test
replaces with a fake. Its calls block (``urllib``), so each runs on a worker thread.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any, Protocol, TypeVar

from ouroboros_engine.control_plane.builds import (
    RunBuild,
    RunBuildCancelRequest,
    RunBuildRequest,
)
from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.contract import AckedControl, ControlsFetched
from ouroboros_engine.control_plane.execution import (
    LOST_RUN_CODES,
    CheckpointRequest,
    CheckpointSaved,
    FinishOutcome,
    FinishRunRequest,
    HeartbeatAccepted,
    PushGrant,
    PushOutcome,
    PushRecorded,
    PushRequest,
    PushResultRequest,
    RunFinished,
    RunStarted,
)
from ouroboros_engine.control_plane.ingest import (
    ChangeSet,
    CommitsAppended,
    EventActor,
    EventsAppended,
    IngestCommit,
    IngestEvent,
    IngestEventsRequest,
    IngestFile,
    OpenRunRequest,
    QueueItemClaimed,
    ReportCommitsRequest,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageReturn,
    StageStatus,
    StageTransition,
    StageTransitionRequest,
)
from ouroboros_engine.execution.events import StageEvent, Usage
from ouroboros_engine.execution.ingest import to_spend, to_transcript

_log = logging.getLogger(__name__)

#: How many transcript entries are sent in one batch (AP.1 allows 500).
BATCH_SIZE = 100

#: The refusal a transcript batch gets when its hints do not open past the accepted one.
EVENTS_OUT_OF_ORDER = "events_out_of_order"

#: The refusal a transition gets when the attempt is not in the state it names.
STAGE_TRANSITION_INVALID = "stage_transition_invalid"

_T = TypeVar("_T")


class RunControl(Protocol):
    """The control-plane calls execution makes — :class:`IngestClient`'s, by name."""

    def key(self, operation: str) -> str:
        """A fresh idempotency key. See :meth:`IngestClient.key`."""
        ...

    def claim(
        self, workspace: str, worker: str, executors: list[str] | None = None
    ) -> QueueItemClaimed | None:
        """Lease a queue item. See :meth:`IngestClient.claim`."""
        ...

    def open_run(self, body: OpenRunRequest) -> RunOpened:
        """Open a run. See :meth:`IngestClient.open_run`."""
        ...

    def start(self, run: str, worker: str) -> RunStarted:
        """Take a run. See :meth:`IngestClient.start`."""
        ...

    def heartbeat(self, run: str, epoch: int) -> HeartbeatAccepted:
        """Heartbeat. See :meth:`IngestClient.heartbeat`."""
        ...

    def checkpoint(self, run: str, body: CheckpointRequest) -> CheckpointSaved:
        """Store state. See :meth:`IngestClient.checkpoint`."""
        ...

    def finish(self, run: str, body: FinishRunRequest) -> RunFinished:
        """End a run. See :meth:`IngestClient.finish`."""
        ...

    def transition(self, run: str, body: StageTransitionRequest) -> StageTransition:
        """Move a stage. See :meth:`IngestClient.transition`."""
        ...

    def events(self, run: str, body: IngestEventsRequest) -> EventsAppended:
        """Append transcript. See :meth:`IngestClient.events`."""
        ...

    def files(self, run: str, body: ReportFilesRequest) -> ChangeSet:
        """Report the change-set. See :meth:`IngestClient.files`."""
        ...

    def commits(self, run: str, body: ReportCommitsRequest) -> CommitsAppended:
        """Append commits. See :meth:`IngestClient.commits`."""
        ...

    def push(self, run: str, body: PushRequest) -> PushGrant:
        """Ask to push the run branch. See :meth:`IngestClient.push`."""
        ...

    def push_result(self, run: str, body: PushResultRequest) -> PushRecorded:
        """Record a push. See :meth:`IngestClient.push_result`."""
        ...

    def resources(self, run: str, body: ReportResourcesRequest) -> ResourcesReported:
        """Attribute spend. See :meth:`IngestClient.resources`."""
        ...

    def build(self, run: str, body: RunBuildRequest) -> RunBuild:
        """Submit a build stage's job. See :meth:`IngestClient.build`."""
        ...

    def read_build(self, run: str, job: str) -> RunBuild:
        """Read a build. See :meth:`IngestClient.read_build`."""
        ...

    def cancel_build(self, run: str, job: str, body: RunBuildCancelRequest) -> RunBuild:
        """Give up on a build. See :meth:`IngestClient.cancel_build`."""
        ...

    def fetch_controls(self, run: str) -> ControlsFetched:
        """Claim pending controls. See :meth:`IngestClient.fetch_controls`."""
        ...

    def ack_control(
        self,
        run: str,
        control: str,
        *,
        effect: str | None = None,
        attempt: int | None = None,
    ) -> AckedControl:
        """Acknowledge a control. See :meth:`IngestClient.ack_control`."""
        ...


class RunLostError(RuntimeError):
    """This worker no longer holds the run; it must stop without writing.

    Attributes:
        code: ``fenced`` or ``run_not_executable``.
    """

    def __init__(self, code: str) -> None:
        """Record why.

        Args:
            code: The control plane's refusal.
        """
        super().__init__(f"the run is no longer this worker's: {code}")
        self.code = code


class RunReporter:
    """One execution's epoch-fenced writes.

    Attributes:
        run_id: The run.
        epoch: The epoch held.
        seq: The last transcript ordering hint used — persisted in the checkpoint.
    """

    def __init__(
        self,
        control: RunControl,
        run_id: str,
        epoch: int,
        *,
        seq: int = 0,
        batch_size: int = BATCH_SIZE,
    ) -> None:
        """Hold the control plane and the epoch.

        Args:
            control: The control plane.
            run_id: The run.
            epoch: The epoch ``start`` answered.
            seq: The last hint a previous worker sent, from the checkpoint.
            batch_size: Transcript entries per batch.
        """
        self.run_id = run_id
        self.epoch = epoch
        self.seq = seq
        self._control = control
        self._batch_size = batch_size
        self._pending: list[IngestEvent] = []
        self._lost: str | None = None

    @property
    def lost(self) -> str | None:
        """Why this worker lost the run, or ``None`` while it holds it."""
        return self._lost

    def mark_lost(self, code: str) -> None:
        """Stop every later write — the heartbeat was refused.

        Args:
            code: ``fenced`` or ``run_not_executable``.
        """
        if self._lost is None:
            self._lost = code
            _log.warning("run %s lost (%s); no further writes", self.run_id, code)

    async def _send(self, call: Callable[..., _T], *args: Any) -> _T:
        """Send one write on a thread, unless the run is lost.

        Args:
            call: The :class:`RunControl` method.
            *args: Its arguments.

        Returns:
            Its answer.

        Raises:
            RunLostError: Before sending when the run is lost, or when this write was
                refused ``fenced``/``run_not_executable``.
            ControlPlaneError: Any other refusal.
        """
        if self._lost is not None:
            raise RunLostError(self._lost)
        try:
            return await asyncio.to_thread(call, *args)
        except ControlPlaneError as refused:
            if refused.code in LOST_RUN_CODES:
                self.mark_lost(refused.code)
                raise RunLostError(refused.code) from refused
            raise

    async def transition(
        self,
        stage_key: str,
        status: StageStatus,
        attempt: int,
        *,
        returned_from: StageReturn | None = None,
        tolerate_invalid: bool = False,
    ) -> None:
        """Move one stage attempt.

        Args:
            stage_key: The stage.
            status: Where the attempt moves.
            attempt: Which attempt.
            returned_from: The loop edge it came back through, for a gate return.
            tolerate_invalid: Swallow ``stage_transition_invalid`` — a resumed worker
                re-announcing what a dead one may or may not have reported.

        Raises:
            ControlPlaneError: Any refusal not tolerated.
        """
        body = StageTransitionRequest(
            idempotency_key=self._control.key("run.transition"),
            stage_key=stage_key,
            status=status,
            attempt=attempt,
            returned_from=returned_from,
            epoch=self.epoch,
        )
        try:
            await self._send(self._control.transition, self.run_id, body)
        except ControlPlaneError as refused:
            if not (tolerate_invalid and refused.code == STAGE_TRANSITION_INVALID):
                raise

    async def record(self, event: StageEvent) -> None:
        """Report one executor event: usage as spend, the rest as transcript.

        Transcript entries are batched; a full batch is sent at once.

        Args:
            event: The event.
        """
        if isinstance(event, Usage):
            body = ReportResourcesRequest(
                idempotency_key=self._control.key("run.resources"),
                spend=to_spend(event),
                epoch=self.epoch,
            )
            await self._send(self._control.resources, self.run_id, body)
            return
        entry = to_transcript(event)
        if entry is None:
            # A file_change: the change-set comes from the working tree (ADR A.6).
            return
        self._pending.append(entry)
        if len(self._pending) >= self._batch_size:
            await self.flush()

    async def note(
        self,
        stage_key: str,
        attempt: int,
        body: str,
        *,
        actor: EventActor = "system",
        payload: dict[str, object] | None = None,
    ) -> None:
        """Write one transcript entry of the engine's own, and send it now.

        What a build stage says as its farm job moves — *"Build #483 is running on
        forge-02"* — so the console's transcript shows the lifecycle as it happens rather than
        at the next model turn's batch.

        Args:
            stage_key: The stage it belongs to.
            attempt: The attempt it belongs to.
            body: The sentence.
            actor: Who is speaking — ``system`` for progress, ``gate`` for a verdict.
            payload: The structure, such as the job and its phase.
        """
        self._pending.append(
            IngestEvent(
                hint=1,
                actor=actor,
                stage_key=stage_key,
                attempt=attempt,
                body=body[:20_000],
                payload=payload,
            )
        )
        await self.flush()

    async def build(
        self,
        stage_key: str,
        attempt: int,
        pool: str,
        commit: str,
        command: list[str] | None,
    ) -> RunBuild:
        """Submit a build stage's job to the farm (AJ.3, #265).

        Args:
            stage_key: The build stage.
            attempt: Its attempt — a resend of the same one answers the same job.
            pool: The runner pool, by name.
            commit: The commit pushed to the run's branch.
            command: argv, or ``None`` for the pool's default.

        Returns:
            The job.

        Raises:
            ControlPlaneError: ``build_no_eligible_runner`` or a farm refusal.
        """
        body = RunBuildRequest(
            idempotency_key=self._control.key("run.build"),
            epoch=self.epoch,
            stage_key=stage_key,
            attempt=attempt,
            pool=pool,
            commit=commit,
            command=command,
        )
        return await self._send(self._control.build, self.run_id, body)

    async def read_build(self, job: str) -> RunBuild:
        """Read where one of the run's builds is now.

        Args:
            job: The job the submission answered.

        Returns:
            The latest attempt of its retry chain.
        """
        return await self._send(self._control.read_build, self.run_id, job)

    async def cancel_build(self, job: str, reason: str) -> RunBuild:
        """Give up on one of the run's builds.

        Args:
            job: The job.
            reason: Why, for the control plane's log.

        Returns:
            The latest attempt.
        """
        body = RunBuildCancelRequest(
            idempotency_key=self._control.key("run.build_cancel"),
            epoch=self.epoch,
            reason=reason[:500],
        )
        return await self._send(self._control.cancel_build, self.run_id, job, body)

    async def flush(self) -> None:
        """Send the pending transcript entries, numbered past the last hint.

        A batch refused ``events_out_of_order`` — a dead worker's entries landed after its
        last checkpoint — is renumbered past the accepted hint and sent once more.

        Raises:
            ControlPlaneError: Any other refusal, or a second ordering refusal.
        """
        if not self._pending:
            return
        entries, self._pending = self._pending, []
        try:
            await self._send_batch(entries)
        except ControlPlaneError as refused:
            accepted = refused.details.get("accepted")
            if refused.code != EVENTS_OUT_OF_ORDER or not isinstance(accepted, int):
                raise
            self.seq = accepted
            await self._send_batch(entries)

    async def _send_batch(self, entries: list[IngestEvent]) -> None:
        """Number and send one batch.

        Args:
            entries: The entries, in order.
        """
        start = self.seq
        numbered = [
            entry.model_copy(update={"hint": start + offset})
            for offset, entry in enumerate(entries, start=1)
        ]
        body = IngestEventsRequest(
            idempotency_key=self._control.key("run.events"),
            events=numbered,
            epoch=self.epoch,
        )
        await self._send(self._control.events, self.run_id, body)
        self.seq = start + len(entries)

    async def files(self, files: list[IngestFile]) -> ChangeSet:
        """Report the whole change-set.

        Args:
            files: The working tree's diff against the base commit.

        Returns:
            The change-set as judged, ``needs_human`` included.
        """
        body = ReportFilesRequest(
            idempotency_key=self._control.key("run.files"),
            files=files,
            epoch=self.epoch,
        )
        return await self._send(self._control.files, self.run_id, body)

    async def commits(self, commits: list[IngestCommit]) -> CommitsAppended:
        """Append commits to the console's list (AP.1), oldest first.

        Args:
            commits: The commits — at most 200, which one push never approaches.

        Returns:
            How many were new.
        """
        body = ReportCommitsRequest(
            idempotency_key=self._control.key("run.commits"),
            commits=commits,
            epoch=self.epoch,
        )
        return await self._send(self._control.commits, self.run_id, body)

    async def push(self, branch: str, head_sha: str, change_set_seq: int) -> PushGrant:
        """Ask ``ouroboros-rest`` to push the run branch (DI.2, #1310).

        Args:
            branch: The run's branch.
            head_sha: The commit it is to point at.
            change_set_seq: The change-set report the pushed tree was judged in.

        Returns:
            The refspec, the remote and this one push's credential.

        Raises:
            ControlPlaneError: The push was refused — one of
                :data:`~ouroboros_engine.control_plane.execution.PUSH_REFUSALS`.
        """
        body = PushRequest(
            idempotency_key=self._control.key("run.push"),
            epoch=self.epoch,
            branch=branch,
            head_sha=head_sha,
            change_set_seq=change_set_seq,
        )
        return await self._send(self._control.push, self.run_id, body)

    async def push_result(
        self,
        branch: str,
        outcome: PushOutcome,
        *,
        pushed_sha: str | None = None,
        reason: str | None = None,
    ) -> None:
        """Record what a push did — the push's audit row (DI.2, #1310).

        Args:
            branch: The branch.
            outcome: ``pushed`` or ``failed``.
            pushed_sha: The new tip, when pushed.
            reason: The host's reason, when it failed.
        """
        body = PushResultRequest(
            idempotency_key=self._control.key("run.push_result"),
            epoch=self.epoch,
            branch=branch,
            outcome=outcome,
            pushed_sha=pushed_sha,
            reason=None if reason is None else reason[:500],
        )
        await self._send(self._control.push_result, self.run_id, body)

    async def checkpoint(
        self, state: dict[str, Any], base_commit: str | None = None
    ) -> None:
        """Store the interpreter's state.

        Args:
            state: The state's JSON.
            base_commit: The base commit, sent once.
        """
        body = CheckpointRequest(epoch=self.epoch, base_commit=base_commit, state=state)
        await self._send(self._control.checkpoint, self.run_id, body)

    async def finish(
        self, outcome: FinishOutcome, reason: str, stage_key: str | None = None
    ) -> RunFinished:
        """End the run.

        Args:
            outcome: How it ends.
            reason: One sentence, clipped to the contract's 500 characters.
            stage_key: The stage it ended at.

        Returns:
            The run's status afterwards.
        """
        body = FinishRunRequest(
            epoch=self.epoch,
            idempotency_key=self._control.key("run.finish"),
            outcome=outcome,
            reason=reason[:500],
            stage_key=stage_key,
        )
        return await self._send(self._control.finish, self.run_id, body)
