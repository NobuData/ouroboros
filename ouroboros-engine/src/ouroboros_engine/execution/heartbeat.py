"""The executing worker's heartbeat — and how a refused one stops it.

#160, ADR decisions A.2 and A.3. While a run executes, its worker sends
``POST /internal/runs/{id}/heartbeat`` every ``OURO_ENGINE_HEARTBEAT_SECONDS`` (5 by
default). ``ouroboros-rest``'s supervisor resubmits a run whose heartbeat is older than its
stale threshold (30 s by default) to another worker, which starts it under a new epoch.

When a heartbeat is refused ``409 fenced`` or ``409 run_not_executable``, this worker no
longer holds the run: :class:`Heartbeat` calls ``on_lost``, which marks the reporter lost
and aborts the running executor at its next safe boundary. A heartbeat that merely could not
be delivered is logged and tried again on the next beat — the stale threshold is several
beats long.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.execution import LOST_RUN_CODES
from ouroboros_engine.control_plane.transport import TransportError
from ouroboros_engine.execution.reporter import RunControl

_log = logging.getLogger(__name__)

#: Waits a number of seconds — ``asyncio.sleep`` unless a test supplies its own.
Sleep = Callable[[float], Awaitable[None]]


class Heartbeat:
    """Beats for one execution until it is stopped or the run is lost."""

    def __init__(
        self,
        control: RunControl,
        run_id: str,
        epoch: int,
        *,
        interval: float,
        sleep: Sleep,
        on_lost: Callable[[str], None],
    ) -> None:
        """Configure the heartbeat. Nothing is sent until :meth:`run`.

        Args:
            control: The control plane.
            run_id: The run.
            epoch: The epoch held.
            interval: Seconds between beats.
            sleep: Waits between beats.
            on_lost: Called once with the refusal's code when a beat is refused
                ``fenced`` or ``run_not_executable``.
        """
        self._control = control
        self._run_id = run_id
        self._epoch = epoch
        self._interval = interval
        self._sleep = sleep
        self._on_lost = on_lost

    async def run(self) -> None:
        """Beat until cancelled, or until a beat says the run is lost."""
        while True:
            await self._sleep(self._interval)
            try:
                await asyncio.to_thread(
                    self._control.heartbeat, self._run_id, self._epoch
                )
            except ControlPlaneError as refused:
                if refused.code in LOST_RUN_CODES:
                    self._on_lost(refused.code)
                    return
                _log.warning(
                    "heartbeat for run %s refused: %s", self._run_id, refused.code
                )
            except TransportError as unreachable:
                _log.warning(
                    "heartbeat for run %s not delivered: %s", self._run_id, unreachable
                )
