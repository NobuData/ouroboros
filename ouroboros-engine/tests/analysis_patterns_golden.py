"""The pattern analyzers' fixture corpus and golden findings (#512).

Like ``analysis_golden.py`` (#511), the corpus is *built*, not stored: :func:`mockup_corpus` is
deterministic, so the corpus is the code below and only the expected findings are committed —
``tests/analysis_golden/<analyzer>.findings.json``. Nothing here states an answer; it plants the
history mockup 18's evidence lines describe, and the analyzers must count their way to them:

* **1,284 jobs** over 90 days — 794 ``zephyr build``, 214 ``native_sim`` and 214
  ``qemu_cortex_m3`` (one of each per change, on one commit), and 62 ``HIL test rig``
  sessions, each beside a ``zephyr build`` of its commit.
* **BA-1** — 31 ``native_sim`` failures whose tails carry the OTA fixture timeout, among 430
  OTA ``FAIL`` lines in all: *"fixture timeout · 31 builds · 7.2% of OTA fails"*.
* **BA-2** — the ccache#1412 manifest-miss warning in 118 builds' tails.
* **BA-4** — twelve declared options no job's configuration sets, over every one of the 1,284
  jobs, and four tails carrying Kconfig's drift warning for four of them.
* **ccache re-warm** — 14 ``deps: refresh west manifest`` merges, each followed by six hours of
  builds at a 31% hit rate against 78% everywhere else; the failures cluster on those days.
* **pool move** — pool-a's queue over five minutes inside 14:00-16:00 on 11 of the last 14
  weekdays, while pool-b's two runners are busy for 18% of that window.
* **BA-3** — three waivers in the last 60 days citing thermal chamber availability (and an older
  one outside the window that must not count).
* **34%** — 50 standard-fix loops whose build failed, 17 of them flagged at review.
* **3.1x (21 cases)** — 21 merges touching ``drivers/can/``, 13 followed by a flaky result
  within a week, against 16 of the other 79 merges.
* **0 unique in 214 / HIL 9** — every ``qemu_cortex_m3`` failure is shared with its commit's
  ``native_sim`` job; nine HIL failures are the only failure on their commit, all on merge-queue
  refs, and two more are shared.

Regenerate the golden files after an intended change (and a version bump) with::

    uv run python tests/analysis_patterns_golden.py
"""

import hashlib
import json
import sys
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from ouroboros_engine.analysis.contract import Corpus, findings_json
from ouroboros_engine.analysis.patterns.cache_window import CacheWindowAnalyzer
from ouroboros_engine.analysis.patterns.config_usage import ConfigUsageAnalyzer
from ouroboros_engine.analysis.patterns.log_signature import LogSignatureAnalyzer
from ouroboros_engine.analysis.patterns.queue_correlation import (
    QueueCorrelationAnalyzer,
    observed_days,
)
from ouroboros_engine.analysis.patterns.waiver_cite import WaiverCiteAnalyzer
from ouroboros_engine.analysis.patterns.workflow_outcome import (
    WorkflowOutcomeAnalyzer,
)
from ouroboros_engine.analysis.spi import Analyzer

GOLDEN_DIR = Path(__file__).parent / "analysis_golden"

#: The fixture window — 90 days ending the day before mockup 18's "today", Aug 8.
WINDOW_FROM = date(2026, 5, 10)
WINDOW_DAYS = 90
WINDOW_TO = WINDOW_FROM + timedelta(days=WINDOW_DAYS - 1)

#: The pattern analyzers, keyed by the golden file each one's findings are pinned in.
PATTERN_ANALYZERS: dict[str, type[Analyzer]] = {
    cls.id: cls
    for cls in (
        CacheWindowAnalyzer,
        ConfigUsageAnalyzer,
        LogSignatureAnalyzer,
        QueueCorrelationAnalyzer,
        WaiverCiteAnalyzer,
        WorkflowOutcomeAnalyzer,
    )
}

#: The twelve declared options nothing sets (BA-4), and the three that are set.
DEAD_OPTIONS = (
    "CONFIG_HELIOS_LEGACY_UART_SHIM",
    "CONFIG_HELIOS_BLE_MESH_PROXY",
    "CONFIG_HELIOS_OTA_DELTA_V1",
    "CONFIG_HELIOS_CAN_FD_EXPERIMENTAL",
    "CONFIG_HELIOS_TELEMETRY_CBOR_V1",
    "CONFIG_HELIOS_MOTOR_SIM_STUB",
    "CONFIG_HELIOS_DEBUG_SHELL_EXT",
    "CONFIG_HELIOS_FLASH_WEAR_LOG",
    "CONFIG_HELIOS_LED_MATRIX",
    "CONFIG_HELIOS_BOOT_BANNER_ASCII",
    "CONFIG_HELIOS_I2C_BITBANG",
    "CONFIG_HELIOS_POWER_TRACE_UART",
)
LIVE_OPTIONS = ("CONFIG_HELIOS_OTA", "CONFIG_HELIOS_CAN", "CONFIG_LOG_DEFAULT_LEVEL")

POOL_A = "pool-a"
POOL_B = "pool-b"
MAIN = "refs/heads/main"
GATE = "refs/heads/gh-readonly-queue/main/pr-{n}"
#: The general builds whose tails carry a Kconfig drift warning (one dead option each).
DRIFTING = (7, 101, 211, 389)
OTHER_PREFIXES = ("subsys/ota/", "drivers/i2c/", "boards/helios/", "lib/telemetry/")

_KINDS = {
    "job": 1,
    "pool": 2,
    "runner": 3,
    "loop": 4,
    "version": 5,
    "waiver": 6,
    "test_run": 7,
}


def uid(kind: str, n: int) -> str:
    """A deterministic lowercase uuid for a fixture row.

    Args:
        kind: The row kind (a key of ``_KINDS``).
        n: Its number.

    Returns:
        The uuid text.
    """
    return f"5eed0512-{_KINDS[kind]:04x}-4000-8000-{n:012x}"


def sha(name: str) -> str:
    """A deterministic 40-character commit sha.

    Args:
        name: The commit's fixture name.

    Returns:
        The sha.
    """
    return hashlib.sha1(name.encode()).hexdigest()  # noqa: S324 — a fixture id, not security


def day(index: int) -> date:
    """The window's ``index``-th day.

    Args:
        index: 0-89.

    Returns:
        The date.
    """
    return WINDOW_FROM + timedelta(days=index)


def at(on: date, hour: int, minute: int = 0) -> datetime:
    """An instant on a day, UTC.

    Args:
        on: The day.
        hour: The hour.
        minute: The minute.

    Returns:
        The aware instant.
    """
    return datetime(on.year, on.month, on.day, hour, minute, tzinfo=UTC)


@dataclass
class _Builder:
    """Accumulates the corpus's rows."""

    jobs: list[dict[str, Any]] = field(default_factory=list)
    tails: list[dict[str, Any]] = field(default_factory=list)
    cache: list[dict[str, Any]] = field(default_factory=list)
    tests: list[dict[str, Any]] = field(default_factory=list)

    def job(
        self,
        label: str,
        queued: datetime,
        *,
        commit: str,
        pool: str,
        status: str = "succeeded",
        ref: str = "refs/heads/pr",
        title: str | None = None,
        wait: int = 30,
        seconds: int = 252,
        lines: tuple[str, ...] = (),
        cache: tuple[int, int] | None = None,
    ) -> str:
        """Add one job, its log tail and (optionally) its cache counters.

        Args:
            label: The stage label.
            queued: When it queued.
            commit: Its commit sha.
            pool: ``pool-a`` or ``pool-b``.
            status: How it ended.
            ref: The ref it built.
            title: The commit title, for a merge.
            wait: Seconds in the queue.
            seconds: Seconds it ran.
            lines: Its tail's marker lines.
            cache: ``(hits, misses)`` when it used ccache.

        Returns:
            The job's id.
        """
        build_id = uid("job", len(self.jobs) + 1)
        started = queued + timedelta(seconds=wait)
        finished = started + timedelta(seconds=seconds)
        config: dict[str, str] = {}
        if label == "zephyr build":
            level = "4" if len(self.jobs) % 3 == 0 else "3"
            config = {
                "CONFIG_HELIOS_OTA": "y",
                "CONFIG_HELIOS_CAN": "y",
                "CONFIG_LOG_DEFAULT_LEVEL": level,
            }
        self.jobs.append(
            {
                "build_id": build_id,
                "day": finished.date().isoformat(),
                "label": label,
                "status": status,
                "commit_sha": commit,
                "git_ref": ref,
                "title": title,
                "pool_id": uid("pool", 1 if pool == POOL_A else 2),
                "queued_at": queued.isoformat(),
                "started_at": started.isoformat(),
                "finished_at": finished.isoformat(),
                "config": config,
            }
        )
        self.tails.append(
            {
                "build_id": build_id,
                "day": finished.date().isoformat(),
                "label": label,
                "status": status,
                "line_count": 4000 + len(lines),
                "lines": [f"-- {label}: {len(lines)} notable lines --", *lines],
            }
        )
        if cache is not None:
            self.cache.append(
                {
                    "build_id": build_id,
                    "day": finished.date().isoformat(),
                    "hits": cache[0],
                    "misses": cache[1],
                }
            )
        return build_id


def _ota_lines(n: int, count: int) -> tuple[str, ...]:
    """``count`` OTA failure lines that are *not* the fixture timeout.

    Args:
        n: The build's number, to vary the masked parts.
        count: How many.

    Returns:
        The lines, cycling four unrelated OTA failures.
    """
    lines = []
    for k in range(count):
        v = n * 31 + k
        lines.append(
            (
                f"FAIL - ota.update.verify_signature: digest mismatch at 0x{v * 4096:08x}",
                f"FAIL - ota.rollback.boot_count: expected {v % 7} got {v % 7 + 1}",
                f"FAIL - ota.download.resume: http status 503 after {v * 512} bytes",
                f"FAIL - ota.slot.swap: image header magic 0x{v:08x} invalid",
            )[k % 4]
        )
    return tuple(lines)


def _fixture_line(n: int) -> str:
    """BA-1's fixture-timeout line, its timeout varying build to build.

    Args:
        n: The build's number.

    Returns:
        The line.
    """
    return (
        "FAIL - ota.fixture.shared_setup: fixture 'ota_image_server' setup timed out "
        f"after {30 + n % 5}.{n % 10}s"
    )


def _ccache_line(n: int) -> str:
    """BA-2's manifest-miss warning, on a different source file each time.

    Args:
        n: The build's number.

    Returns:
        The line.
    """
    return (
        f"ccache: warning: manifest hash miss for /work/helios/drivers/mod{n % 17}/src{n}.c "
        "(ccache#1412)"
    )


def _pairs(b: _Builder) -> None:
    """214 changes, each a ``native_sim`` and a ``qemu_cortex_m3`` job on one commit.

    The first 12 fail on both (shared — qemu's only failures); 31 more fail ``native_sim``
    with the fixture timeout and 12 with other OTA failures. 430 OTA FAIL lines in all.
    """
    for i in range(214):
        on = day(i * WINDOW_DAYS // 214)
        commit = sha(f"pair-{i}")
        if i < 12:
            native, qemu = "failed", "failed"
            lines = _ota_lines(i, 8 if i < 2 else 7)
        elif i < 43:
            native, qemu = "failed", "succeeded"
            lines = (_fixture_line(i), *_ota_lines(i, 7))
        elif i < 55:
            native, qemu = "failed", "succeeded"
            lines = _ota_lines(i, 8)
        else:
            native, qemu = "succeeded", "succeeded"
            lines = ()
        b.job(
            "native_sim",
            at(on, 6),
            commit=commit,
            pool=POOL_A,
            status=native,
            seconds=120,
            lines=lines,
        )
        qemu_lines = (
            (f"FAIL - can.frame_order: expected id 0x{i:03x} got 0x{i + 1:03x}",)
            if qemu == "failed"
            else ()
        )
        b.job(
            "qemu_cortex_m3",
            at(on, 6, 10),
            commit=commit,
            pool=POOL_A,
            status=qemu,
            seconds=180,
            lines=qemu_lines,
        )


def _hil(b: _Builder, sweep_days: list[date]) -> None:
    """62 HIL sessions on pool-b, each with a ``zephyr build`` of its commit on pool-a.

    The first 12 run 14:30 for 3,024 s on 12 of the last 14 weekdays — pool-b's only busy time
    in pool-a's starved window. Nine fail alone on a merge-queue ref (unique); two fail with
    their commit's build (shared).
    """
    others = [day(j * WINDOW_DAYS // 50) for j in range(50)]
    for j in range(62):
        on, start, seconds = (
            (sweep_days[j], (14, 30), 3024)
            if j < 12
            else (others[j - 12], (3, 0), 1800)
        )
        commit = sha(f"hil-{j}")
        unique, shared = 12 <= j < 21, 21 <= j < 23
        ref = GATE.format(n=1000 + j) if unique else MAIN
        hil_lines = (
            (f"FAIL - hil.thermal.derating: board temp {70 + j} C exceeded limit",)
            if unique or shared
            else ()
        )
        b.job(
            "zephyr build",
            at(on, 2),
            commit=commit,
            pool=POOL_A,
            status="failed" if shared else "succeeded",
            ref=ref,
            lines=("FATAL ERROR: command exited with status 1",) if shared else (),
            cache=(78, 22),
        )
        b.job(
            "HIL test rig",
            at(on, *start),
            commit=commit,
            pool=POOL_B,
            status="failed" if unique or shared else "succeeded",
            ref=ref,
            seconds=seconds,
            lines=hil_lines,
        )


def _refreshes(b: _Builder) -> None:
    """14 deps-refresh merges and the six cold hours after each.

    Each merge builds at 08:00; ten more builds queue 08:30-13:00 at a 31% hit rate, three
    of them failing; the 14:00 build is back at 78%.
    """
    days = [3 + 6 * k for k in range(14)]
    for k, index in enumerate(days):
        on = day(index)
        b.job(
            "zephyr build",
            at(on, 8),
            commit=sha(f"refresh-{k}"),
            pool=POOL_A,
            ref=MAIN,
            title="deps: refresh west manifest",
            cache=(31, 69),
        )
        for m in range(10):
            minute = 30 * (m + 1)
            b.job(
                "zephyr build",
                at(on, 8 + minute // 60, minute % 60),
                commit=sha(f"refresh-{k}-after-{m}"),
                pool=POOL_A,
                status="failed" if m < 3 else "succeeded",
                lines=("FATAL ERROR: command exited with status 1",) if m < 3 else (),
                cache=(31, 69),
            )
        b.job(
            "zephyr build",
            at(on, 14),
            commit=sha(f"refresh-{k}-recovered"),
            pool=POOL_A,
            cache=(78, 22),
        )


def _merges(b: _Builder) -> list[dict[str, Any]]:
    """100 standard-fix merges — 21 touching ``drivers/can/`` — and their loops.

    Every merge builds once on main at 18:45. 13 of the CAN merges and 16 of the other 79
    see a flaky result on that build. Every second loop's build stage failed; 17 of those 50
    were flagged at review.

    Returns:
        The loop records, merged ones first, then 30 that never merged.
    """
    can = set(range(0, 100, 5)) | {1}
    can_flaked = set(sorted(can)[:13])
    others = [i for i in range(100) if i not in can]
    other_flaked = set(others[::5])
    failed_builds = [i for i in range(100) if i % 2 == 0]
    flagged = set(failed_builds[:17])
    version = uid("version", 1)

    loops = []
    for i in range(100):
        on = day(2 + i * 85 // 100)
        touches_can = i in can
        title = (
            f"can: frame ordering fix {i}" if touches_can else f"fix: helios issue {i}"
        )
        commit = sha(f"merge-{i}")
        build_id = b.job(
            "zephyr build", at(on, 18, 45), commit=commit, pool=POOL_A, ref=MAIN,
            title=title, cache=(78, 22),
        )  # fmt: skip
        flaked = i in can_flaked or i in other_flaked
        b.tests.append(
            {
                "test_run_id": uid("test_run", i + 1),
                "build_id": build_id,
                "day": on.isoformat(),
                "suite": "telemetry integration",
                "platform": "native_sim",
                "case_key": f"tests/telemetry/test_stream.py::test_case_{i % 9}",
                "status": "flaky" if flaked else "passed",
                "failure": None,
            }
        )
        paths = (
            ["drivers/can/can_mcan.c", "drivers/can/Kconfig"]
            if touches_can
            else [f"{OTHER_PREFIXES[others.index(i) % 4]}module_{i}.c"]
        )
        build_outcome = "failed" if i in failed_builds else "passed"
        loops.append(
            _loop(
                i, on, "merged", build_outcome,
                "flagged" if i in flagged else "passed",
                version=version, merge_sha=commit, paths=paths,
            )
        )  # fmt: skip
    for k in range(30):
        loops.append(
            _loop(100 + k, day(5 + k * 2), "failed", "failed", None, version=version)
        )
    return loops


def _loop(
    n: int,
    on: date,
    status: str,
    build: str,
    review: str | None,
    *,
    version: str,
    merge_sha: str | None = None,
    paths: list[str] | None = None,
) -> dict[str, Any]:
    """One standard-fix loop record.

    Args:
        n: Its number.
        on: Its day.
        status: Its status.
        build: The build stage's outcome.
        review: The review stage's outcome, or ``None`` when unknown.
        version: The workflow version it ran.
        merge_sha: The commit it merged, if it did.
        paths: The paths its change touched, if it merged.

    Returns:
        The record.
    """
    return {
        "run_id": uid("loop", n + 1),
        "day": on.isoformat(),
        "status": status,
        "stages": [
            {"key": "plan", "attempts": 1, "seconds": 60.0, "outcome": "passed"},
            {"key": "build", "attempts": 2, "seconds": 600.0, "outcome": build},
            {"key": "review", "attempts": 1, "seconds": 120.0, "outcome": review},
        ],
        "events": 40,
        "event_bytes": 18000,
        "workflow": "standard-fix",
        "workflow_version_id": version,
        "merge_sha": merge_sha,
        "paths_touched": paths,
    }


def _general(b: _Builder, weekdays: list[date]) -> None:
    """The rest of the 794 ``zephyr build`` jobs, and pool-a's afternoon queue.

    Every one of the last 14 weekdays has a build queued 14:20; on 11 of them it waits ten
    minutes and a second one at 15:40 does too (on the other three it waits a minute). Of
    the remaining builds, 118 carry the ccache#1412 warning, four carry a Kconfig drift
    warning for four of the dead options, and every 23rd fails.
    """
    calm = {weekdays[i] for i in (2, 6, 10)}
    for index, weekday in enumerate(weekdays):
        busy = weekday not in calm
        b.job(
            "zephyr build",
            at(weekday, 14, 20),
            commit=sha(f"queue-{index}"),
            pool=POOL_A,
            wait=600 if busy else 60,
            cache=(78, 22),
        )
        if busy:
            b.job(
                "zephyr build",
                at(weekday, 15, 40),
                commit=sha(f"queue-{index}-late"),
                pool=POOL_A,
                wait=600,
                cache=(78, 22),
            )
    remaining = 794 - sum(1 for j in b.jobs if j["label"] == "zephyr build")
    for n in range(remaining):
        on = day(n * WINDOW_DAYS // remaining)
        lines: list[str] = []
        if n % 3 == 1 and n // 3 < 118:
            lines.append(_ccache_line(n))
        if n in DRIFTING:
            option = DEAD_OPTIONS[DRIFTING.index(n) * 3]
            lines.append(
                f"warning: {option} (defined at boards/helios/Kconfig.defconfig:{n % 90}) "
                "was assigned the value 'y' but got the value 'n'"
            )
        failed = n % 23 == 22
        if failed:
            lines.append("FATAL ERROR: command exited with status 1")
        b.job(
            "zephyr build",
            at(on, 16 + n % 5, 30),
            commit=sha(f"general-{n}"),
            pool=POOL_A,
            status="failed" if failed else "succeeded",
            lines=tuple(lines),
            cache=(78, 22),
        )


def _waivers() -> list[dict[str, Any]]:
    """Three thermal-chamber waivers in the last 60 days, one older, and two unrelated."""
    rows = [
        (5, "thermal chamber availability: waive the derating soak (Jun backlog)"),
        (40, "thermal chamber availability, helios bench booked for the soak campaign"),
        (
            55,
            "No thermal chamber availability on rig-02 this sprint; derating case waived",
        ),
        (77, "Waived: thermal chamber availability (rig 02 offline for calibration)"),
        (60, "CAN timing intermittent on qemu, tracked in #1203"),
        (70, "USB enumeration intermittent on bench host"),
    ]
    return [
        {
            "waiver_id": uid("waiver", n + 1),
            "run_id": uid("loop", n + 1),
            "day": day(index).isoformat(),
            "case_keys": [f"tests/hil/test_thermal.py::test_{n}"],
            "reason": reason,
        }
        for n, (index, reason) in enumerate(rows)
    ]


def mockup_corpus() -> Corpus:
    """Mockup 18's corpus, with every pattern its evidence lines describe planted.

    Returns:
        The corpus — logs recorded as sampled at 0.3 as BV.1's manifest says, every other
        source read in full.
    """
    b = _Builder()
    weekdays = observed_days(WINDOW_TO)
    sweep_days = [d for i, d in enumerate(weekdays) if i not in (4, 9)]
    _pairs(b)
    _hil(b, sweep_days)
    _refreshes(b)
    loops = _merges(b)
    _general(b, weekdays)
    full = {"sampled": False, "rate": 1, "cap": None}
    return Corpus.model_validate(
        {
            "repo_ref": "acme-robotics/helios-firmware",
            "window": {"from": WINDOW_FROM.isoformat(), "to": WINDOW_TO.isoformat()},
            "jobs": b.jobs,
            "log_tails": b.tails,
            "cache": b.cache,
            "tests": b.tests,
            "loops": loops,
            "waivers": _waivers(),
            "pools": [
                {
                    "pool_id": uid("pool", 1),
                    "name": POOL_A,
                    "runner_ids": [uid("runner", n) for n in range(1, 5)],
                },
                {
                    "pool_id": uid("pool", 2),
                    "name": POOL_B,
                    "runner_ids": [uid("runner", n) for n in range(5, 7)],
                },
            ],
            "config_options": [
                {"name": name} for name in sorted((*DEAD_OPTIONS, *LIVE_OPTIONS))
            ],
            "sampling": {
                "jobs": full,
                "log_tails": {"sampled": True, "rate": 0.3, "cap": "max_log_lines"},
                "cache": full,
                "tests": full,
                "loops": full,
                "waivers": full,
            },
        }
    )


def golden_path(analyzer_id: str) -> Path:
    """Where an analyzer's golden findings live.

    Args:
        analyzer_id: The analyzer.

    Returns:
        The file's path.
    """
    return GOLDEN_DIR / f"{analyzer_id}.findings.json"


def emitted_json(analyzer_id: str, corpus: Corpus) -> str:
    """An analyzer's findings over a corpus, as the golden file stores them.

    Args:
        analyzer_id: The analyzer.
        corpus: The corpus.

    Returns:
        Pretty-printed canonical findings with a trailing newline.
    """
    findings = PATTERN_ANALYZERS[analyzer_id]().analyze(corpus)
    return (
        json.dumps(json.loads(findings_json(findings)), indent=2, ensure_ascii=False)
        + "\n"
    )


def main() -> int:
    """Regenerate every golden file from the current analyzers.

    Returns:
        The exit status.
    """
    corpus = mockup_corpus()
    for analyzer_id in sorted(PATTERN_ANALYZERS):
        golden_path(analyzer_id).write_text(emitted_json(analyzer_id, corpus))
        print(f"wrote {golden_path(analyzer_id)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
