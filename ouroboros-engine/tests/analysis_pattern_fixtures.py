"""Small hand-built corpora for the pattern analyzers' unit tests (#512).

The mockup-scale corpus is ``analysis_patterns_golden.py``'s; these are the few-row corpora a
single rule is easiest to read against — a negative fixture, a below-support fixture, an
all-shared fixture.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from analysis_patterns_golden import sha, uid
from ouroboros_engine.analysis.contract import Corpus, EvidenceRef, Finding

#: A short window the fixtures live in.
FROM = date(2026, 7, 1)
TO = date(2026, 7, 31)

FULL = {"sampled": False, "rate": 1, "cap": None}


def instant(on: date, hour: int = 10, minute: int = 0) -> datetime:
    """An instant on a day, UTC.

    Args:
        on: The day.
        hour: The hour.
        minute: The minute.

    Returns:
        The aware instant.
    """
    return datetime(on.year, on.month, on.day, hour, minute, tzinfo=UTC)


def job(
    n: int,
    *,
    on: date = FROM,
    label: str = "zephyr build",
    status: str = "succeeded",
    commit: str | None = None,
    ref: str = "refs/heads/pr",
    title: str | None = None,
    pool: int | None = None,
    queued: datetime | None = None,
    wait: int = 30,
    seconds: int = 300,
    config: dict[str, str] | None = None,
) -> dict[str, Any]:
    """One ``jobs`` row.

    Args:
        n: Its number — the id and, by default, the commit.
        on: Its day, when ``queued`` is not given.
        label: The stage label.
        status: How it ended.
        commit: Its commit sha; ``sha(f"c{n}")`` by default.
        ref: The ref it built.
        title: The commit title.
        pool: The pool number, if any.
        queued: When it queued; 10:00 on ``on`` by default.
        wait: Seconds queued.
        seconds: Seconds run.
        config: Its configuration (``{}`` when not given).

    Returns:
        The row.
    """
    queued = queued or instant(on)
    started = queued + timedelta(seconds=wait)
    finished = started + timedelta(seconds=seconds)
    return {
        "build_id": uid("job", n),
        "day": finished.date().isoformat(),
        "label": label,
        "status": status,
        "commit_sha": commit or sha(f"c{n}"),
        "git_ref": ref,
        "title": title,
        "pool_id": uid("pool", pool) if pool is not None else None,
        "queued_at": queued.isoformat(),
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "config": {} if config is None else config,
    }


def corpus(**sources: Any) -> Corpus:
    """A corpus over the fixture window carrying the given sources.

    Args:
        **sources: Corpus fields (``jobs=[…]``, ``sampling={…}``, …).

    Returns:
        The validated corpus.
    """
    return Corpus.model_validate(
        {
            "repo_ref": "acme-robotics/helios-firmware",
            "window": {"from": FROM.isoformat(), "to": TO.isoformat()},
            **sources,
        }
    )


def cited(finding: Finding, refs: list[dict[str, str]]) -> bool:
    """Whether every reference ``data`` cites is in the finding's evidence (V081's rule).

    Args:
        finding: The finding.
        refs: The references ``data`` cites.

    Returns:
        True when all of them are evidence.
    """
    evidence = set(finding.evidence_refs)
    return all(EvidenceRef.model_validate(ref) in evidence for ref in refs)
