"""A person's controls over an executing run — fetched, applied at safe boundaries, acked.

#315 (AR.1) honours AP.4's queue (`#306 <https://github.com/NobuData/ouroboros/issues/306>`_)
the way the run simulator's session does (its ``_apply``). The interpreter claims a
run's pending controls (``POST /internal/runs/{id}/controls/fetch``) while a stage runs
(:mod:`~ouroboros_engine.execution.poller`), when an attempt ends, between stages and
before every finish, and acknowledges each with the effect it had:

=================== ====================================================================
control             what happens
=================== ====================================================================
``steer``           mid-attempt on an executor that steers: :meth:`StageExecutor.steer`,
                    acked with the attempt (the control plane writes *"steering applied to
                    attempt N"*). Otherwise it becomes an operator note in the **next**
                    attempt's prompt, acked with that attempt when it starts — or, mid-attempt
                    on an executor that cannot steer, acked at once saying so
``steer`` +         a correction round: the stage runs again as attempt N+1 with the note,
``retryStage``      acked *"correction round queued: <stage> attempt N+1"*
``pause``           :meth:`StageExecutor.pause`; acked *"paused at a safe boundary: …"* once
                    the attempt stopped there, then :meth:`Controls.hold` waits for ``resume``
``resume``          ends a hold, acked *"resumed at …"*; outside one, acked as having nothing
                    to resume
``abort``           :meth:`StageExecutor.abort`; the interpreter keeps the tree and branch,
                    then acks with no effect, and the control plane marks the run ``canceled``
=================== ====================================================================

An acknowledgment refused ``control_not_delivered`` with state ``acked`` landed earlier and
its answer was lost — a success. Any other refusal (an expired control) is logged and the
control dropped.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Final

from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.contract import PendingControl
from ouroboros_engine.control_plane.execution import LOST_RUN_CODES
from ouroboros_engine.control_plane.transport import TransportError
from ouroboros_engine.execution.heartbeat import Sleep
from ouroboros_engine.execution.reporter import RunControl, RunLostError, RunReporter
from ouroboros_engine.execution.spi import StageExecutor

_log = logging.getLogger(__name__)

#: The acknowledgment of a ``resume`` outside a hold — the simulator's sentence.
NOTHING_TO_RESUME: Final = "the loop was not paused, so there is nothing to resume"

#: The acknowledgment of a steer with no text.
EMPTY_STEER: Final = "the steer carried no text, so nothing was applied"

#: The acknowledgment of a steer mid-attempt on an executor that takes no guidance.
NEXT_ATTEMPT: Final = (
    "this executor takes no guidance mid-attempt; the note lands on the next attempt"
)

#: The acknowledgment of a steer still waiting for an attempt when the run finishes.
NO_ATTEMPT_FOLLOWED: Final = "the run finished before another attempt took the note"

#: The refusal a control gets once it is no longer ``delivered``.
CONTROL_NOT_DELIVERED: Final = "control_not_delivered"


class RunAborted(Exception):  # noqa: N818 - an outcome, not a failure
    """A person aborted the run; the interpreter keeps the tree and acknowledges.

    Attributes:
        control: The ``abort`` to acknowledge.
    """

    def __init__(self, control: PendingControl) -> None:
        """Record the control.

        Args:
            control: The abort.
        """
        super().__init__(f"aborted by control {control.id}")
        self.control = control


@dataclass(frozen=True)
class Running:
    """The attempt controls are applied to.

    Attributes:
        executor: Its executor.
        stage_key: The stage.
        attempt: The attempt number.
        limit: The most attempts the stage may make — a correction round past it is refused.
        live: ``False`` once the attempt's stream has ended: a steer then waits for the
            next attempt instead of being handed to the executor.
    """

    executor: StageExecutor
    stage_key: str
    attempt: int
    limit: int
    live: bool = True


@dataclass(frozen=True)
class Note:
    """A steer waiting for the next attempt's prompt.

    Attributes:
        text: The guidance.
        control: The steer to acknowledge with that attempt, or ``None`` once acknowledged.
    """

    text: str
    control: PendingControl | None = None


@dataclass
class Controls:
    """One execution's controls: what is pending, and the calls that claim and ack them.

    Attributes:
        control: The control plane.
        reporter: The execution's writes — its ``lost`` state stops every call here.
        interval: Seconds between fetches while a stage runs or a pause holds.
        sleep: Waits between fetches.
        notes: Steers for the next attempt, oldest first.
        corrections: Correction-round notes: the current stage runs again with them.
        pause: A ``pause`` not yet acknowledged.
        abort: An ``abort`` not yet acknowledged.
    """

    control: RunControl
    reporter: RunReporter
    interval: float
    sleep: Sleep
    notes: list[Note] = field(default_factory=list)
    corrections: list[str] = field(default_factory=list)
    pause: PendingControl | None = None
    abort: PendingControl | None = None

    # --- the two calls ----------------------------------------------------------------------

    async def fetch(self) -> list[PendingControl]:
        """Claim the run's pending controls. Never raises.

        Returns:
            The controls, oldest first; empty when the run is lost or the fetch failed.
        """
        if self.reporter.lost is not None:
            return []
        run = self.reporter.run_id
        try:
            fetched = await asyncio.to_thread(self.control.fetch_controls, run)
        except ControlPlaneError as refused:
            if refused.code in LOST_RUN_CODES:
                self.reporter.mark_lost(refused.code)
            else:
                _log.warning("controls of run %s not fetched: %s", run, refused.code)
            return []
        except TransportError as unreachable:
            _log.warning("controls of run %s not fetched: %s", run, unreachable)
            return []
        return fetched.controls

    async def ack(
        self,
        control: PendingControl,
        *,
        effect: str | None = None,
        attempt: int | None = None,
    ) -> bool:
        """Acknowledge one control. Never raises.

        Args:
            control: The control.
            effect: What was done, or ``None`` for the control plane's own sentence.
            attempt: The attempt a steer landed on.

        Returns:
            ``True`` once acknowledged — including an earlier acknowledgment whose answer was
            lost. ``False`` when it expired or was refused: it is logged and dropped.
        """
        run = self.reporter.run_id
        try:
            await asyncio.to_thread(
                self.control.ack_control,
                run,
                control.id,
                effect=effect,
                attempt=attempt,
            )
        except ControlPlaneError as refused:
            state = refused.details.get("state")
            if refused.code == CONTROL_NOT_DELIVERED and state == "acked":
                return True
            if refused.code in LOST_RUN_CODES:
                self.reporter.mark_lost(refused.code)
            _log.warning(
                "control %s of run %s dropped: %s (%s)",
                control.id,
                run,
                refused.code,
                state,
            )
            return False
        except TransportError as unreachable:
            _log.warning(
                "control %s of run %s dropped: %s", control.id, run, unreachable
            )
            return False
        return True

    # --- applying ---------------------------------------------------------------------------

    async def poll(self, running: Running | None = None) -> None:
        """Fetch and apply every pending control, oldest first.

        Args:
            running: The attempt they apply to, or ``None`` between stages.
        """
        for control in await self.fetch():
            await self.apply(control, running)

    async def apply(self, control: PendingControl, running: Running | None) -> None:
        """Apply one control, outside a hold.

        Args:
            control: The control.
            running: The attempt it applies to, or ``None`` between stages.
        """
        if control.kind == "steer":
            await self._steer(control, running)
        elif control.kind == "pause":
            if self.pause is not None:
                await self.ack(
                    control, effect="already pausing at the next safe boundary"
                )
                return
            self.pause = control
            if running is not None and running.live:
                running.executor.pause()
        elif control.kind == "abort":
            if self.abort is not None:
                await self.ack(control, effect="already aborting")
                return
            self.abort = control
            if running is not None and running.live:
                running.executor.abort()
        else:
            await self.ack(control, effect=NOTHING_TO_RESUME)

    async def _steer(self, control: PendingControl, running: Running | None) -> None:
        """Apply a steer: to the executor, as a correction round, or to the next attempt.

        Args:
            control: The steer.
            running: The attempt, or ``None`` between stages.
        """
        text = (control.payload or "").strip()
        if not text:
            await self.ack(control, effect=EMPTY_STEER)
            return
        if running is None or (not running.live and not control.retry_stage):
            self.notes.append(Note(text, control))
            return
        if control.retry_stage:
            target = running.attempt + 1
            if target > running.limit:
                await self.ack(
                    control,
                    effect=f"correction round refused: {running.stage_key} has used all "
                    f"{running.limit} attempt(s)",
                )
                return
            where = f"{running.stage_key} attempt {target}"
            if await self.ack(control, effect=f"correction round queued: {where}"):
                self.corrections.append(text)
            return
        if running.executor.capabilities().steer:
            running.executor.steer(text)
            await self.ack(control, attempt=running.attempt)
            return
        if await self.ack(control, effect=NEXT_ATTEMPT):
            self.notes.append(Note(text))

    # --- the hold ---------------------------------------------------------------------------

    async def hold(self, where: str) -> bool:
        """Acknowledge the pending pause, then wait at this boundary for a resume.

        Every fetch is applied in order: a ``resume`` ends the hold (acked *"resumed at …"*,
        the controls after it applied as between stages); another ``pause`` is acked as
        already paused; a ``steer`` waits for the attempt that continues; an ``abort`` ends
        the hold. The heartbeat keeps beating meanwhile — it runs for the whole execution.

        Args:
            where: The boundary, e.g. ``implement attempt 2``.

        Returns:
            ``True`` to carry on — resumed, or the pause expired before its ack — and
            ``False`` when an abort arrived (:attr:`abort` is set).

        Raises:
            RunLostError: The run was lost while holding.
        """
        pause, self.pause = self.pause, None
        if pause is not None and not await self.ack(
            pause, effect=f"paused at a safe boundary: {where}"
        ):
            return True
        _log.info("run %s paused at %s", self.reporter.run_id, where)
        while True:
            if self.reporter.lost is not None:
                raise RunLostError(self.reporter.lost)
            await self.sleep(self.interval)
            pending = await self.fetch()
            for index, control in enumerate(pending):
                if control.kind == "resume":
                    await self.ack(control, effect=f"resumed at {where}")
                    for later in pending[index + 1 :]:
                        await self.apply(later, None)
                    return True
                if control.kind == "pause":
                    await self.ack(control, effect=f"already paused at {where}")
                    continue
                await self.apply(control, None)
                if self.abort is not None:
                    return False

    # --- notes ------------------------------------------------------------------------------

    async def notes_for(self, attempt: int) -> list[str]:
        """Take the notes an attempt starts with, acknowledging each steer with it.

        Args:
            attempt: The attempt starting now.

        Returns:
            The correction-round notes, then the steering notes, oldest first.
        """
        texts = list(self.corrections)
        self.corrections.clear()
        notes, self.notes = self.notes, []
        for note in notes:
            if note.control is not None and not await self.ack(
                note.control, attempt=attempt
            ):
                continue
            texts.append(note.text)
        return texts

    async def deliver(self, executor: StageExecutor, attempt: int) -> None:
        """Hand waiting steers to an executor that continues an attempt (after a hold).

        Args:
            executor: The executor resuming the attempt; it steers.
            attempt: The attempt.
        """
        notes, self.notes = self.notes, []
        for note in notes:
            executor.steer(note.text)
            if note.control is not None:
                await self.ack(note.control, attempt=attempt)

    async def settle(self) -> None:
        """Acknowledge the steers no attempt will take, before the run finishes."""
        notes, self.notes = self.notes, []
        self.corrections.clear()
        for note in notes:
            if note.control is not None:
                await self.ack(note.control, effect=NO_ATTEMPT_FOLLOWED)
