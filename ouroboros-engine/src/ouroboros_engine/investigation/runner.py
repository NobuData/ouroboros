"""Where investigations run inside this process — a small set of background threads.

The engine's task model (queue and workers) is #54 and does not exist yet, so this is the
least that can run a loop for minutes without holding a request open: ``submit`` starts a
thread and returns at once.

**Nothing here is durable, on purpose.** The lifecycle row, the ledger and the checkpoint all
live in ``ouroboros-rest``. A process that dies takes its threads with it (they are daemon
threads: a deployment must be able to stop the engine without waiting out a deep dive), and
the control plane — which sees an investigation ``running`` whose checkpoint has stopped
moving — submits it again. A process that still holds it answers ``already_running`` and
starts nothing; one that does not resumes it from the checkpoint. When #54 lands, this class is what it
replaces; the loop and the contract do not change.
"""

from __future__ import annotations

import logging
import threading

from .contract import LOOP_VERSION, InvestigateRequest, InvestigationAccepted, task_ref
from .loop import InvestigationLoop

#: How many investigations one engine process works on at once. Each is a thread that
#: mostly waits on the control plane; the bound keeps a burst from starving the request pool.
MAX_CONCURRENT = 4

_logger = logging.getLogger(__name__)


class AtCapacityError(RuntimeError):
    """Every worker is busy; the investigation was not accepted."""


class InvestigationRunner:
    """Runs investigations on background threads and knows which ones it holds."""

    def __init__(
        self, loop: InvestigationLoop, *, max_concurrent: int = MAX_CONCURRENT
    ) -> None:
        """Make a runner.

        Args:
            loop: The loop every investigation runs through.
            max_concurrent: How many may run at once.
        """
        self._loop = loop
        self._max = max_concurrent
        self._lock = threading.Lock()
        self._held: dict[str, threading.Thread] = {}

    def submit(self, request: InvestigateRequest) -> InvestigationAccepted:
        """Start an investigation, unless this process already holds it.

        Args:
            request: The investigation.

        Returns:
            ``accepted``, or ``already_running`` when a repeated submit found it running —
            which starts nothing, so a retried request never doubles the work.

        Raises:
            AtCapacityError: When :data:`MAX_CONCURRENT` investigations are running.
        """
        key = request.investigation.lower()
        task = task_ref(key)
        with self._lock:
            if key in self._held:
                return InvestigationAccepted(
                    investigation=request.investigation,
                    task=task,
                    state="already_running",
                    loop_version=LOOP_VERSION,
                )
            if len(self._held) >= self._max:
                raise AtCapacityError
            thread = threading.Thread(
                target=self._work, args=(key, request), name=task, daemon=True
            )
            self._held[key] = thread
            thread.start()
        return InvestigationAccepted(
            investigation=request.investigation,
            task=task,
            state="accepted",
            loop_version=LOOP_VERSION,
        )

    def holds(self, investigation: str) -> bool:
        """Whether this process is working on an investigation.

        Args:
            investigation: ``investigations.id``.

        Returns:
            ``True`` while its thread runs.
        """
        with self._lock:
            return investigation.lower() in self._held

    def wait(self, investigation: str, timeout: float | None = None) -> bool:
        """Wait for an investigation this process holds to end. For tests and shutdown.

        Args:
            investigation: ``investigations.id``.
            timeout: Seconds to wait; ``None`` waits until it ends.

        Returns:
            ``True`` when it is no longer running here.
        """
        with self._lock:
            held = self._held.get(investigation.lower())
        if held is None:
            return True
        held.join(timeout)
        return not held.is_alive()

    def _work(self, key: str, request: InvestigateRequest) -> None:
        """Run one investigation and let go of it, whatever happens.

        Args:
            key: The investigation's id, lower-cased.
            request: The investigation.
        """
        try:
            self._loop.run(request)
        except Exception:
            # The loop reports its own failures; this is the last line of defence, so a
            # bug there cannot leave the investigation held by a thread that is gone.
            _logger.exception(
                "investigation thread error", extra={"investigation": key}
            )
        finally:
            with self._lock:
                self._held.pop(key, None)
