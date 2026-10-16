"""Polls a run's controls while one stage attempt runs (#315).

A :class:`ControlPoller` wraps an attempt: every
:attr:`~ouroboros_engine.execution.controls.Controls.interval` seconds — the heartbeat's
cadence — it fetches the run's pending controls and applies them to the running executor
(:meth:`~ouroboros_engine.execution.controls.Controls.poll`). A pause or an abort is a
*request* the executor honours at its next safe boundary; a steer is handed over at once.

Leaving the ``async with`` stops it without losing a fetch: a poll in flight is allowed to
finish, because a fetch claims the controls it answers and a cancelled one would drop them.
"""

from __future__ import annotations

import asyncio
import contextlib
from types import TracebackType

from ouroboros_engine.execution.controls import Controls, Running


class ControlPoller:
    """Applies controls to one running attempt until the ``async with`` is left."""

    def __init__(self, controls: Controls, running: Running) -> None:
        """Hold the controls and the attempt. Nothing is fetched until entered.

        Args:
            controls: The execution's controls.
            running: The attempt.
        """
        self._controls = controls
        self._running = running
        self._stopped = False
        self._polling = False
        self._task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> ControlPoller:
        """Start polling.

        Returns:
            The poller.
        """
        self._task = asyncio.create_task(self._loop())
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        """Stop polling: cancel a wait, or let a poll in flight finish.

        Args:
            exc_type: The exception leaving the block, if any.
            exc: Its value.
            tb: Its traceback.
        """
        del exc_type, exc, tb
        self._stopped = True
        task, self._task = self._task, None
        if task is None:
            return
        if not self._polling:
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _loop(self) -> None:
        """Wait, fetch and apply, until stopped."""
        while not self._stopped:
            await self._controls.sleep(self._controls.interval)
            if self._stopped:
                return
            self._polling = True
            try:
                await self._controls.poll(self._running)
            finally:
                self._polling = False
