"""The change-point analyzer's fixture corpora and golden findings (#511).

Every corpus here is *built*, not stored: the builders are deterministic, so the corpus is
the code below and only the expected findings are committed — under ``tests/analysis_golden/``.

* :func:`planted_corpus` — mockup 18's 90 days with the three shifts planted on their dates:
  May 18 +90 s, Jun 22 -130 s, Jul 30 +40 s, ending at the chart's 4m 12s. The noise is
  constructed so that every day's median and every segment's median land exactly on the
  planted level, which is what lets the deltas be asserted exactly. A few days carry a
  one-hour pathological build, which a daily median ignores. Beside each planted anchor sit
  near-miss candidates — a same-day policy flip, a re-imaged runner two days earlier, an
  unrelated merge three days later — which attribution must rank below the anchor.
* :func:`noise_corpus` — 90 days of seeded random noise around one level, with outliers and
  events: the false-positive guard. It must produce no change-point at all.

Regenerate the golden file after an intended change (and a version bump) with::

    uv run python tests/analysis_golden.py
"""

import json
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from ouroboros_engine.analysis.changepoint import ChangePointAnalyzer
from ouroboros_engine.analysis.contract import (
    BuildSample,
    CandidateEvent,
    Corpus,
    DayWindow,
    EventKind,
    EvidenceRef,
    findings_json,
)

GOLDEN_DIR = Path(__file__).parent / "analysis_golden"

#: The fixture window — 90 days, the mockup's three shifts inside it.
WINDOW_FROM = date(2026, 5, 8)
WINDOW_DAYS = 90
WINDOW_TO = WINDOW_FROM + timedelta(days=WINDOW_DAYS - 1)

#: The planted shifts: (first day of the new level, the new level in seconds).
SHIFTS = (
    (date(2026, 5, 18), 342.0),
    (date(2026, 6, 22), 212.0),
    (date(2026, 7, 30), 252.0),
)
START_LEVEL = 252.0

#: The deltas the chips print: +1m 30s, -2m 10s, +40s.
PLANTED = {
    "2026-05-18": (90, "Zephyr 4.1 migration"),
    "2026-06-22": (-130, "ccache enabled"),
    "2026-07-30": (40, "twister suite growth"),
}

_DAY_JITTER = (4.0, 7.0, 10.0, 5.0, 9.0, 6.0, 11.0)


def _uuid(prefix: int, index: int) -> str:
    """A fixed, readable fixture uuid.

    Args:
        prefix: A 32-bit tag for the record family.
        index: The record's number.

    Returns:
        A lowercase uuid string.
    """
    return str(uuid.UUID(int=(prefix << 96) + index))


def _sha(word: str) -> str:
    """A 40-hex fixture sha derived from a word.

    Args:
        word: Any text.

    Returns:
        40 lowercase hex characters.
    """
    return uuid.uuid5(uuid.NAMESPACE_URL, word).hex + "00000000"


def _days() -> list[date]:
    """Every day of the fixture window.

    Returns:
        90 consecutive dates.
    """
    return [WINDOW_FROM + timedelta(days=i) for i in range(WINDOW_DAYS)]


def _level(day: date) -> float:
    """The planted median build duration on a day.

    Args:
        day: The day.

    Returns:
        Seconds.
    """
    level = START_LEVEL
    for starts, value in SHIFTS:
        if day >= starts:
            level = value
    return level


def planted_events() -> list[CandidateEvent]:
    """The anchors and the near-miss candidates around each planted shift.

    Returns:
        The events, in no particular order.
    """
    may18, jun22, jul30 = (s for s, _ in SHIFTS)

    def event(
        kind: EventKind, day: date, label: str, ref: EvidenceRef
    ) -> CandidateEvent:
        return CandidateEvent(kind=kind, day=day, label=label, ref=ref)

    def merge(word: str) -> EvidenceRef:
        return EvidenceRef(kind="merge", id=_sha(word))

    return [
        # May 18 — the anchor merge, and three near misses.
        event(EventKind.MERGE, may18, "Zephyr 4.1 migration", merge("zephyr-4.1")),
        event(
            EventKind.POLICY_VERSION,
            may18,
            "dry-run policy turned off",
            EvidenceRef(kind="workflow_version", id=_uuid(0xE0, 1)),
        ),
        event(
            EventKind.INFRA_EVENT,
            may18 - timedelta(days=2),
            "forge-03 re-imaged",
            EvidenceRef(kind="runner", id=_uuid(0xE1, 3)),
        ),
        event(
            EventKind.MERGE,
            may18 + timedelta(days=3),
            "docs: README typo",
            merge("readme"),
        ),
        # Jun 22 — the anchor config change, a same-day image bump, a merge the day before.
        event(EventKind.CONFIG_VERSION, jun22, "ccache enabled", merge("ccache")),
        event(
            EventKind.INFRA_EVENT,
            jun22,
            "pool-a image bump",
            EvidenceRef(kind="runner_pool", id=_uuid(0xE2, 1)),
        ),
        event(
            EventKind.MERGE,
            jun22 - timedelta(days=1),
            "can: driver timeout tweak",
            merge("can-timeout"),
        ),
        # Jul 30 — the anchor merge, a recipe bump two days later, a same-day policy edit.
        event(EventKind.MERGE, jul30, "twister suite growth", merge("twister")),
        event(
            EventKind.ENV_RECIPE_VERSION,
            jul30 + timedelta(days=2),
            "west env recipe v7",
            merge("recipe-v7"),
        ),
        event(
            EventKind.POLICY_VERSION,
            jul30,
            "merge policy: require HIL",
            EvidenceRef(kind="workflow_version", id=_uuid(0xE0, 2)),
        ),
        # Out of reach of every breakpoint.
        event(
            EventKind.MERGE, date(2026, 6, 5), "unrelated refactor", merge("refactor")
        ),
    ]


def planted_builds() -> list[BuildSample]:
    """Builds whose daily and segment medians land exactly on the planted levels.

    Each day's offset from its level follows the period-3 pattern ``0, +a, -a``, so any run of
    five or more days has a median offset of exactly 0. Each day's builds are an odd count
    spread symmetrically around the day's value, so the day's median *is* that value. Every
    tenth day's largest build is replaced with a one-hour build — above the median either way.

    Returns:
        The builds.
    """
    builds = []
    for index, day in enumerate(_days()):
        jitter = _DAY_JITTER[(index // 3) % len(_DAY_JITTER)]
        offset = (0.0, jitter, -jitter)[index % 3]
        value = _level(day) + offset
        count = (11, 13, 15)[index % 3]
        spread = [6.0 * k + index % 5 for k in range(1, count // 2 + 1)]
        durations = [value, *(value + s for s in spread), *(value - s for s in spread)]
        if index % 10 == 4:
            durations[count // 2] = 3600.0
        for j, seconds in enumerate(durations):
            builds.append(
                BuildSample(
                    build_id=_uuid(0xB0, index * 100 + j),
                    day=day,
                    duration_seconds=seconds,
                )
            )
    return builds


def planted_corpus(*, events: bool = True) -> Corpus:
    """Mockup 18's 90 days, the three shifts planted.

    Args:
        events: Whether the corpus carries the attribution events (``[]`` when not — present
            and empty, so the analyzer still runs and reports unattributed shifts).

    Returns:
        The corpus.
    """
    return Corpus(
        repo_ref="acme/helios-firmware",
        window=DayWindow(from_=WINDOW_FROM, to=WINDOW_TO),
        builds=planted_builds(),
        events=planted_events() if events else [],
    )


def noise_corpus(seed: int = 7) -> Corpus:
    """Ninety days of seeded random noise around 4m 12s — no shift anywhere.

    3-20 builds a day, sigma = 25 s per build, one day in twenty with a one-hour outlier, and the
    planted corpus's events, so attribution has something to be tempted by.

    Args:
        seed: The noise seed.

    Returns:
        The corpus.
    """
    rng = np.random.default_rng(seed)
    builds = []
    for index, day in enumerate(_days()):
        count = int(rng.integers(3, 21))
        durations = START_LEVEL + rng.normal(0, 25, count)
        if rng.random() < 0.05:
            durations[0] = 3600.0
        for j, seconds in enumerate(durations):
            builds.append(
                BuildSample(
                    build_id=_uuid(0xC0, index * 100 + j),
                    day=day,
                    duration_seconds=round(float(seconds), 1),
                )
            )
    return Corpus(
        repo_ref="acme/helios-firmware",
        window=DayWindow(from_=WINDOW_FROM, to=WINDOW_TO),
        builds=builds,
        events=planted_events(),
    )


def golden_path(name: str) -> Path:
    """Where a golden findings file lives.

    Args:
        name: The fixture name.

    Returns:
        ``tests/analysis_golden/<name>.findings.json``.
    """
    return GOLDEN_DIR / f"{name}.findings.json"


def render(corpus: Corpus) -> str:
    """The golden text for a corpus: canonical findings, pretty-printed for review.

    Args:
        corpus: The corpus.

    Returns:
        Indented JSON of the canonical findings, newline-terminated.
    """
    canonical = findings_json(ChangePointAnalyzer().analyze(corpus))
    return json.dumps(json.loads(canonical), indent=2, ensure_ascii=False) + "\n"


GOLDENS = {
    "planted": planted_corpus,
    "planted-unattributed": lambda: planted_corpus(events=False),
}


if __name__ == "__main__":
    GOLDEN_DIR.mkdir(exist_ok=True)
    for name, build in GOLDENS.items():
        golden_path(name).write_text(render(build()), encoding="utf-8")
        sys.stdout.write(f"wrote {golden_path(name)}\n")
