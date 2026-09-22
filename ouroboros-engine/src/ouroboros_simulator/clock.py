"""Time for the driver: real timestamps, and scripted durations played back faster.

A scenario is written in the durations the mockup draws: *analyze took 1m 12s*. Playing it
at that pace makes an e2e run take thirteen minutes, so the driver divides every scripted
wait by ``speed``. The timestamps it reports are always real: the console measures a stage
from its ``startedAt``, and a scripted timestamp would disagree with the page's own clock.
"""

import time
from datetime import UTC, datetime


class Clock:
    """The wall clock, with sleeps scaled by a compression factor.

    Attributes:
        speed: How many scripted seconds pass per real second. ``1`` is realistic
            cadence, ``60`` turns the thirteen-minute flagship scenario into about
            thirteen seconds.
    """

    def __init__(self, speed: float = 1.0) -> None:
        """Make a clock.

        Args:
            speed: The compression factor. Must be positive.

        Raises:
            ValueError: If ``speed`` is not positive.
        """
        if speed <= 0:
            raise ValueError("speed must be positive: it divides every scripted wait")
        self.speed = speed

    def now(self) -> datetime:
        """The current instant.

        Returns:
            A timezone-aware UTC datetime.
        """
        return datetime.now(UTC)

    def iso_now(self) -> str:
        """The current instant in the control plane's format.

        Returns:
            ISO 8601 with milliseconds and a ``Z``, as the contract's examples write it.
        """
        return self.now().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def scripted(self, seconds: float) -> None:
        """Wait out a scripted duration, compressed.

        Args:
            seconds: The duration as the scenario states it.
        """
        self.sleep(seconds / self.speed)

    def sleep(self, seconds: float) -> None:
        """Wait a real duration. Not compressed: used for polling while paused.

        Args:
            seconds: Real seconds.
        """
        if seconds > 0:
            time.sleep(seconds)
