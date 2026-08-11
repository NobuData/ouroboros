"""How long this process has been serving, measured from when the app was built.

Uptime is reported by ``/v0/status`` and is the cheapest thing an operator can look at
to tell "the engine is up" from "the engine keeps coming back up": a service that
restarts under load answers every probe successfully and never gets past a few seconds
of uptime.

The measurement is :func:`time.monotonic`, not the wall clock — it counts forward at a
steady rate whatever NTP does to the system time, so a clock correction cannot make a
long-running process look like it just started or report a negative age.
"""

import time
from collections.abc import Callable


class Uptime:
    """A stopwatch started when it was constructed."""

    def __init__(self, monotonic: Callable[[], float] = time.monotonic) -> None:
        """Start the stopwatch.

        Args:
            monotonic: The clock to read, taken as an argument so a test can hand in
                one it controls rather than sleeping. Must be monotonic and expressed
                in seconds; defaults to :func:`time.monotonic`.
        """
        self._monotonic = monotonic
        self._started = monotonic()

    def seconds(self) -> float:
        """Report the elapsed time since construction.

        Returns:
            Seconds elapsed, as a float. Never negative, and never affected by a change
            to the system clock.
        """
        return self._monotonic() - self._started
