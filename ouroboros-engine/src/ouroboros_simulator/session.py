"""One simulated run: the reports it makes, and the controls it honours.

A scenario script only calls :class:`RunSession`: *move this stage*, *say this*, *report
these files*, *work for this long*. The session turns each call into a request built by the
production client, with an idempotency key, and sends it. Transcript entries are buffered
and sent in batches with monotonic hints. At every **safe boundary** (before a stage
starts, and after each stretch of scripted work) it fetches the run's controls and applies
them, following the four meanings AP.4 publishes (`#306
<https://github.com/NobuData/ouroboros/issues/306>`_):

``pause``
    Stop here, acknowledge once stopped, and wait for ``resume`` (or ``abort``).
``resume``
    Carry on from where the loop stopped.
``abort``
    Stop for good and **preserve the branch**. The acknowledgment is what closes the run as
    ``canceled``. :class:`ScenarioAborted` unwinds the script.
``steer``
    Record the text against the **current attempt** and keep going, **without pausing**.
    The acknowledgment names the attempt (*"steering applied to attempt 2"*), and the script
    reads :meth:`RunSession.steer_for` at its branch points, so a steer changes what the
    scenario does next.
``steer`` with ``retryStage`` — a **correction round** (`#332
<https://github.com/NobuData/ouroboros/issues/332>`_)
    Record the text against the current stage's **next** attempt, as its planning context,
    and acknowledge with that attempt's number (*"correction round queued: implement
    attempt 2"*). The script reads :meth:`RunSession.correction_for` while it waits for a
    person to Mark & Route a failure, and starts that attempt when one arrives.
"""

import itertools
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneError,
    ControlPlaneRequest,
)
from ouroboros_engine.control_plane.contract import AckedControl, PendingControl
from ouroboros_engine.control_plane.ingest import (
    ChangeSet,
    EventActor,
    IngestCommit,
    IngestEvent,
    IngestEventsRequest,
    IngestFile,
    OpenRunRequest,
    ReportCommitsRequest,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageReturn,
    StageStatus,
    StageTransition,
    StageTransitionRequest,
    TicketReference,
    TokenSpend,
    WorkflowPin,
)
from ouroboros_simulator.clock import Clock
from ouroboros_simulator.transport import Transport

_LOG = logging.getLogger("ouroboros_simulator.session")

#: The most transcript entries one batch carries. The contract allows 500. A driver that
#: flushes at every boundary never gets near it, and the cap keeps a script that forgets
#: to flush within the limit anyway.
MAX_BATCH = 100

#: How much of a steer's text a transcript entry quotes back.
STEER_QUOTE_LIMIT = 200


class SimulationError(RuntimeError):
    """The scenario cannot go on: the control plane refused a report, or a pause ran out."""


class ScenarioAborted(Exception):  # noqa: N818 - an outcome, not a failure
    """A person aborted the run, and the driver acknowledged it. The branch is preserved.

    Attributes:
        where: The boundary the loop stopped at.
    """

    def __init__(self, where: str) -> None:
        """Record where the loop stopped.

        Args:
            where: The boundary, for the result and the log.
        """
        super().__init__(f"aborted at {where}")
        self.where = where


@dataclass(frozen=True)
class Target:
    """What a simulated run is opened for: a ticket, a repository and a pinned workflow.

    The defaults are the development seeds' ``#482`` in ``acme-robotics``, which is mockup
    10's run: the GitHub source, ``helios-firmware`` and ``standard-fix`` v14.

    Attributes:
        ticket_source: ``ticket_sources.id``.
        ticket: ``tickets.external_key``.
        repository: ``github_repos.id``.
        workflow: ``workflows.slug``.
        workflow_version: The published version to pin.
        model: What the run says it runs on. Every ``model`` transcript entry names it.
        merge_strategy: How the terminal merges.
    """

    ticket_source: str = "5eed001a-0000-4000-8000-000000000001"
    ticket: str = "#482"
    repository: str = "5eed0006-0000-4000-8000-000000000001"
    workflow: str = "standard-fix"
    workflow_version: int = 14
    model: str = "claude-fable-5"
    merge_strategy: str = "squash"


@dataclass(frozen=True)
class Steer:
    """A steer the driver applied.

    Attributes:
        control_id: The control.
        text: What the person typed.
        stage_key: The stage it landed on, or ``None`` before any stage started.
        attempt: The attempt it landed on. For a correction round, the attempt it asked
            for — the stage's next one.
        correction: Whether it was a correction round (``retryStage``).
    """

    control_id: str
    text: str
    stage_key: str | None
    attempt: int
    correction: bool = False


@dataclass
class _Position:
    """Where the loop is: the stage it is working in and each stage's current attempt."""

    stage_key: str | None = None
    attempts: dict[str, int] = field(default_factory=dict)

    @property
    def attempt(self) -> int:
        """The current stage's attempt, or 1 before any stage has started."""
        if self.stage_key is None:
            return 1
        return self.attempts.get(self.stage_key, 1)

    def describe(self) -> str:
        """Say where the loop is, for acknowledgments and transcript entries.

        Returns:
            ``implement attempt 2``, or ``before the first stage``.
        """
        if self.stage_key is None:
            return "before the first stage"
        return f"{self.stage_key} attempt {self.attempt}"


class RunSession:
    """One run, as a scenario drives it.

    Attributes:
        run: The run, once :meth:`open` has answered.
        branch: The branch the run works on. An abort preserves it.
        steers: Every steer applied, oldest first.
        acks: Every acknowledgment the control plane accepted, oldest first.
        change_sets: Every change-set answer, with its guardrail verdicts.
    """

    def __init__(
        self,
        client: ControlPlaneClient,
        transport: Transport,
        clock: Clock,
        *,
        key_prefix: str,
        poll_interval: float = 0.5,
        max_pause: float = 600.0,
    ) -> None:
        """Prepare a session. Nothing is sent until :meth:`open`.

        Args:
            client: The production client, holding the simulator's secret.
            transport: What sends the client's requests.
            clock: Real time, and scripted waits compressed.
            key_prefix: Starts every idempotency key this session sends, so two runs never
                share one. At most 96 characters, leaving room for the suffixes.
            poll_interval: Real seconds between fetches while paused.
            max_pause: Real seconds a pause may last before the driver gives up.

        Raises:
            ValueError: If the prefix is empty or too long, or either interval is not
                positive. A zero poll interval would make a pause spin without waiting and
                never reach ``max_pause``.
        """
        if not 0 < len(key_prefix) <= 96 or key_prefix != key_prefix.strip():
            raise ValueError("key_prefix must be 1 to 96 characters, not padded")
        if poll_interval <= 0 or max_pause <= 0:
            raise ValueError("poll_interval and max_pause must be positive")

        self._client = client
        self._transport = transport
        self._clock = clock
        self._prefix = key_prefix
        self._poll_interval = poll_interval
        self._max_pause = max_pause
        self._counter = itertools.count(1)
        self._hints = itertools.count(1)
        self._buffer: list[IngestEvent] = []
        self._position = _Position()

        self.run: RunOpened | None = None
        self.branch: str | None = None
        self.steers: list[Steer] = []
        self.acks: list[AckedControl] = []
        self.change_sets: list[ChangeSet] = []

    # --- opening -----------------------------------------------------------------------------

    def open(self, target: Target, branch: str) -> RunOpened:
        """Open the run.

        Args:
            target: The ticket, repository and pinned workflow.
            branch: The branch name.

        Returns:
            The run.

        Raises:
            SimulationError: If the control plane opened a run that is **not** simulated,
                which means it took the secret for the executor's. Nothing else is written,
                so the run stays empty.
        """
        body = OpenRunRequest(
            idempotency_key=self._key("open"),
            ticket=TicketReference(
                source=target.ticket_source, external_key=target.ticket
            ),
            repository=target.repository,
            workflow=WorkflowPin(tag=target.workflow, version=target.workflow_version),
            model=target.model,
            branch_name=branch,
            merge_strategy=target.merge_strategy,
        )
        opened = self._call(
            self._client.open_run_request(body), self._client.read_run_opened
        )

        if not opened.simulated:
            raise SimulationError(
                f"run {opened.id} was opened as a real run: the control plane did not "
                "take this secret for OURO_RUN_SIMULATOR_SECRET. Stopping before writing "
                "anything to it."
            )

        self.run = opened
        self.branch = branch
        _LOG.info("opened simulated run %s (loop #%d)", opened.id, opened.loop_seq)
        return opened

    # --- stages ------------------------------------------------------------------------------

    def stage(
        self,
        stage_key: str,
        status: StageStatus,
        *,
        attempt: int | None = None,
        returned_from: StageReturn | None = None,
    ) -> StageTransition:
        """Move one attempt of one stage.

        Starting a stage is a safe boundary, so controls are applied first: a pause lands
        *between* stages and never halfway into one.

        Args:
            stage_key: The DSL node id.
            status: Where the attempt moves to.
            attempt: The attempt, for a retry. Otherwise the one already in use.
            returned_from: Where a retry came back from.

        Returns:
            The stage as it now stands, with the note the database composed.
        """
        if status == "active":
            self.checkpoint()
        self.flush()

        number = (
            attempt
            if attempt is not None
            else self._position.attempts.get(stage_key, 1)
        )
        body = StageTransitionRequest(
            idempotency_key=self._key("stage"),
            stage_key=stage_key,
            status=status,
            attempt=number,
            at=self._clock.iso_now(),
            returned_from=returned_from,
        )
        moved = self._call(
            self._client.transition_stage_request(self._run_id, body),
            self._client.read_stage_transition,
        )

        self._position.attempts[stage_key] = number
        if status == "active":
            self._position.stage_key = stage_key
        return moved

    # --- transcript --------------------------------------------------------------------------

    def say(
        self,
        actor: EventActor,
        body: str | None = None,
        *,
        tool: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Queue one transcript entry, in the current stage and attempt.

        Args:
            actor: Who is speaking.
            body: The text.
            tool: The tool, for a ``tool`` entry.
            payload: The structure: ``hunks``, ``progress``, a ``result``.

        Raises:
            ValueError: If a ``model`` entry is queued before any stage started. The
                contract requires a stage and an attempt on model output, so its provenance
                is never missing.
        """
        if actor == "model" and self._position.stage_key is None:
            raise ValueError("a model entry needs a stage: start one first")

        self._buffer.append(
            IngestEvent(
                hint=next(self._hints),
                actor=actor,
                ts=self._clock.iso_now(),
                stage_key=self._position.stage_key,
                attempt=self._position.attempt,
                tool_tag=tool,
                model_id=self._model if actor == "model" else None,
                body=body,
                payload=payload,
            )
        )
        if len(self._buffer) >= MAX_BATCH:
            self.flush()

    def plan(self, body: str) -> None:
        """Queue a ``plan`` entry.

        Args:
            body: The plan.
        """
        self.say("plan", body)

    def model(self, body: str) -> None:
        """Queue a ``model`` entry, attributed to the run's model.

        Args:
            body: What the model said.
        """
        self.say("model", body)

    def tool(self, tag: str, body: str, payload: dict[str, Any] | None = None) -> None:
        """Queue a ``tool`` entry.

        Args:
            tag: The tool: ``read_file``, ``edit_file``, ``run_tests``.
            body: What it was called on.
            payload: What it produced.
        """
        self.say("tool", body, tool=tag, payload=payload)

    def gate(self, body: str) -> None:
        """Queue a ``gate`` entry.

        Args:
            body: The gate's verdict.
        """
        self.say("gate", body)

    def system(self, body: str) -> None:
        """Queue a ``system`` entry.

        Args:
            body: What the loop itself did.
        """
        self.say("system", body)

    def flush(self) -> None:
        """Send the buffered entries as one batch. Nothing is sent when nothing is queued."""
        if not self._buffer:
            return

        batch, self._buffer = self._buffer, []
        body = IngestEventsRequest(idempotency_key=self._key("events"), events=batch)
        appended = self._call(
            self._client.append_events_request(self._run_id, body),
            self._client.read_events_appended,
        )
        if appended.elided:
            _LOG.warning("run %s's transcript is elided by a cap", self._run_id)

    # --- work, change-sets, commits and spend ----------------------------------------------

    def work(self, seconds: float) -> None:
        """Spend scripted time working, then reach a safe boundary.

        Args:
            seconds: The scripted duration, compressed by the clock.
        """
        self.flush()
        self._clock.scripted(seconds)
        self.checkpoint()

    def files(self, files: list[IngestFile]) -> ChangeSet:
        """Report the whole change-set as it now stands.

        The guardrail verdicts in the answer are computed by the control plane (AP.3). The
        driver reads them and never posts one.

        Args:
            files: Every changed file, against the run's base.

        Returns:
            The change-set, with the checks that failed.
        """
        self.flush()
        body = ReportFilesRequest(idempotency_key=self._key("files"), files=files)
        changed = self._call(
            self._client.report_files_request(self._run_id, body),
            self._client.read_change_set,
        )
        self.change_sets.append(changed)
        return changed

    def commit(self, sha: str, message: str) -> None:
        """Report one commit, made now.

        Args:
            sha: The abbreviated object name.
            message: The commit message.
        """
        self.flush()
        body = ReportCommitsRequest(
            idempotency_key=self._key("commits"),
            commits=[
                IngestCommit(
                    sha=sha, message=message, committed_at=self._clock.iso_now()
                )
            ],
        )
        self._call(
            self._client.report_commits_request(self._run_id, body),
            self._client.read_commits_appended,
        )

    def spend(
        self,
        *,
        provider: str,
        tokens_in: int,
        tokens_out: int,
        cost_cents: str | None,
        task_kind: str,
    ) -> ResourcesReported:
        """Attribute one model call's spend to the run.

        Args:
            provider: The provider kind that answered.
            tokens_in: Tokens sent.
            tokens_out: Tokens received.
            cost_cents: Cents as a decimal string, or ``None`` for an unpriced call.
            task_kind: The task kind.

        Returns:
            The run's totals.
        """
        body = ReportResourcesRequest(
            idempotency_key=self._key("spend"),
            spend=TokenSpend(
                provider=provider,
                model=self._model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_cents=cost_cents,
                task_kind=task_kind,
                occurred_at=self._clock.iso_now(),
            ),
        )
        return self._call(
            self._client.report_resources_request(self._run_id, body),
            self._client.read_resources_reported,
        )

    # --- controls ----------------------------------------------------------------------------

    def steer_for(self, stage_key: str, attempt: int) -> Steer | None:
        """The latest steer applied to one attempt. A script's branch point reads this.

        Args:
            stage_key: The stage.
            attempt: The attempt.

        Returns:
            The steer, or ``None`` when nobody steered that attempt.
        """
        for steer in reversed(self.steers):
            if steer.stage_key == stage_key and steer.attempt == attempt:
                return steer
        return None

    def correction_for(self, stage_key: str) -> Steer | None:
        """The latest correction round asking for a stage's next attempt.

        Args:
            stage_key: The stage.

        Returns:
            The correction, or ``None`` when none asks for an attempt after the stage's
            current one.
        """
        current = self._position.attempts.get(stage_key, 1)
        for steer in reversed(self.steers):
            if (
                steer.correction
                and steer.stage_key == stage_key
                and steer.attempt > current
            ):
                return steer
        return None

    def checkpoint(self) -> None:
        """Reach a safe boundary: send the transcript, then fetch and apply controls.

        Raises:
            ScenarioAborted: If an abort was acknowledged.
            SimulationError: If a pause outlasted ``max_pause``.
        """
        self.flush()
        self._apply_all(self._fetch())

    def _apply_all(self, controls: list[PendingControl]) -> None:
        """Apply controls in the order given, which is oldest first.

        Args:
            controls: What the fetch delivered.
        """
        for control in controls:
            self._apply(control)

    def _apply(self, control: PendingControl) -> None:
        """Apply one control.

        Args:
            control: The control.
        """
        if control.kind == "steer":
            self._steer(control)
        elif control.kind == "pause":
            self._pause(control)
        elif control.kind == "abort":
            self._abort(control)
        else:
            self._ack(
                control, effect="the loop was not paused, so there is nothing to resume"
            )

    def _steer(self, control: PendingControl) -> None:
        """Record a steer on the current attempt and acknowledge it, without pausing.

        A correction round is recorded on the stage's next attempt instead, and its
        acknowledgment names that attempt.

        Args:
            control: The steer.
        """
        if control.retry_stage:
            self._correction(control)
            return
        attempt = self._position.attempt
        if self._ack(control, attempt=attempt):
            self.steers.append(
                Steer(
                    control_id=control.id,
                    text=control.payload or "",
                    stage_key=self._position.stage_key,
                    attempt=attempt,
                )
            )

    def _correction(self, control: PendingControl) -> None:
        """Queue a correction round: the note becomes the next attempt's planning context.

        Args:
            control: The steer carrying ``retryStage``.
        """
        stage_key = self._position.stage_key
        target = self._position.attempt + 1
        where = (
            f"{stage_key} attempt {target}"
            if stage_key is not None
            else f"attempt {target}, before the first stage"
        )
        self.system(
            f"Correction round received: {where} will start with the note in its "
            "planning context. Simulated run."
        )
        self.flush()
        if self._ack(control, effect=f"correction round queued: {where}"):
            self.steers.append(
                Steer(
                    control_id=control.id,
                    text=control.payload or "",
                    stage_key=stage_key,
                    attempt=target,
                    correction=True,
                )
            )

    def _pause(self, control: PendingControl) -> None:
        """Stop at this boundary until a resume or an abort arrives.

        Args:
            control: The pause.

        Raises:
            ScenarioAborted: If an abort arrives while paused.
            SimulationError: If no resume arrives within ``max_pause``.
        """
        where = self._position.describe()
        self.system(f"Paused at a safe boundary: {where}. Simulated run.")
        self.flush()
        if not self._ack(control, effect=f"paused at a safe boundary: {where}"):
            return

        waited = 0.0
        while True:
            self._clock.sleep(self._poll_interval)
            waited += self._poll_interval
            pending = self._fetch()

            for index, other in enumerate(pending):
                if other.kind == "resume":
                    self.system(f"Resumed at {where}.")
                    self.flush()
                    self._ack(other, effect=f"resumed at {where}")
                    self._apply_all(pending[index + 1 :])
                    return
                if other.kind == "pause":
                    self._ack(other, effect=f"already paused at {where}")
                else:
                    self._apply(other)

            if waited >= self._max_pause:
                raise SimulationError(
                    f"paused at {where} for {waited:.0f}s with no resume or abort"
                )

    def _abort(self, control: PendingControl) -> None:
        """Stop for good, keeping the branch, and acknowledge.

        Args:
            control: The abort.

        Raises:
            ScenarioAborted: Once the abort is acknowledged. If it expired first, the
                console already says so, and the loop carries on.
        """
        where = self._position.describe()
        self.system(
            f"Aborted on request at {where}. Branch {self.branch} is preserved and "
            "nothing was reverted. Simulated run."
        )
        self.flush()
        if self._ack(
            control, effect=f"aborted at {where}; branch {self.branch} preserved"
        ):
            raise ScenarioAborted(where)

    def _fetch(self) -> list[PendingControl]:
        """Claim the run's pending controls.

        Returns:
            The controls, oldest first.
        """
        fetched = self._call(
            self._client.fetch_controls_request(self._run_id),
            self._client.read_controls,
        )
        return fetched.controls

    def _ack(
        self,
        control: PendingControl,
        *,
        effect: str | None = None,
        attempt: int | None = None,
    ) -> bool:
        """Acknowledge one control.

        Args:
            control: The control.
            effect: What was done. For a steer it is left out and ``attempt`` is sent, so the
                control plane writes its own *"steering applied to attempt N"*.
            attempt: The attempt a steer landed on.

        Returns:
            ``True`` once the control is acknowledged, including when an earlier
            acknowledgment landed and its answer was lost. ``False`` when it expired or was
            refused before this answer arrived, in which case it had no effect.
        """
        try:
            acked = self._call(
                self._client.ack_control_request(
                    self._run_id, control.id, effect=effect, attempt=attempt
                ),
                self._client.read_ack,
            )
        except ControlPlaneError as refused:
            if refused.code != "control_not_delivered":
                raise
            state = refused.details.get("state")
            _LOG.warning("control %s was not acknowledged: %s", control.id, state)
            return state == "acked"

        self.acks.append(acked)
        return True

    # --- plumbing ----------------------------------------------------------------------------

    @property
    def _run_id(self) -> str:
        """The run's id.

        Raises:
            SimulationError: Before :meth:`open`.
        """
        if self.run is None:
            raise SimulationError("the run is not open yet")
        return self.run.id

    @property
    def _model(self) -> str:
        """The run's model, which every ``model`` entry and spend is attributed to."""
        if self.run is None:
            raise SimulationError("the run is not open yet")
        return self.run.model

    def _key(self, operation: str) -> str:
        """Name one submission.

        Args:
            operation: What it is: ``open``, ``stage``, ``events``.

        Returns:
            ``<prefix>-<operation>-<n>``, unique within the session. A retry of the same
            request reuses the key it was built with.
        """
        return f"{self._prefix}-{operation}-{next(self._counter)}"

    def _call[T](
        self, outgoing: ControlPlaneRequest, read: Callable[[int, dict[str, Any]], T]
    ) -> T:
        """Send one request and read its answer.

        Args:
            outgoing: The request.
            read: The client's reader for this operation.

        Returns:
            The parsed answer.

        Raises:
            ControlPlaneError: When the control plane refused.
        """
        answer = self._transport.send(outgoing)
        return read(answer.status, answer.body)
