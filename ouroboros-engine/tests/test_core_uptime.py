"""The stopwatch `/v0/status` reports from."""

import time

from ouroboros_engine.core.uptime import Uptime


def test_it_starts_at_zero() -> None:
    uptime = Uptime(monotonic=lambda: 100.0)

    assert uptime.seconds() == 0.0


def test_it_measures_from_construction_not_from_the_epoch() -> None:
    ticks = iter([1_000.0, 1_042.5])
    uptime = Uptime(monotonic=lambda: next(ticks))

    assert uptime.seconds() == 42.5


def test_it_never_goes_backwards() -> None:
    uptime = Uptime()
    first = uptime.seconds()
    second = uptime.seconds()

    assert 0 <= first <= second


def test_it_reads_the_monotonic_clock_by_default() -> None:
    # A wall clock corrected by NTP can move backwards, which would report a process
    # as younger than it is — or as negative seconds old.
    before = time.monotonic()
    uptime = Uptime()
    elapsed = uptime.seconds()
    after = time.monotonic()

    assert 0 <= elapsed <= after - before, (
        "a clock on any other scale — time.time(), say — lands far outside this window"
    )
