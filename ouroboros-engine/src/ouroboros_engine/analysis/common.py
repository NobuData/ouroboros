"""Small helpers every analyzer shares (#511, #512).

Kept free of clock and entropy reads like the analyzers themselves, so importing it never
puts an analyzer's determinism in doubt.

* :func:`round_half` — the one rounding rule emitted numbers use.
* :func:`sampling_note` — what a finding records about how much of its sources was read.
* :func:`distinct_refs` — an ordered, de-duplicated, optionally capped evidence list.
* :func:`utc` — an aware instant in UTC, so hours and dates are UTC's.
"""

import math
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from ouroboros_engine.analysis.contract import (
    Corpus,
    CorpusSource,
    EvidenceKind,
    EvidenceRef,
)


def round_half(value: float, places: int) -> float:
    """Round half away from zero, so emitted numbers do not depend on banker's rounding.

    Args:
        value: The number.
        places: Decimal places to keep.

    Returns:
        The rounded number, with ``-0.0`` folded to ``0.0``.
    """
    scale = 10**places
    rounded = math.floor(abs(value) * scale + 0.5) / scale
    return math.copysign(rounded, value) + 0.0


def sampling_note(corpus: Corpus, sources: Iterable[CorpusSource]) -> dict[str, Any]:
    """How much of the given sources the corpus read — recorded on every pattern finding.

    Args:
        corpus: The run's corpus.
        sources: The sources the finding was computed from.

    Returns:
        ``{"sampled": bool | None, "rate": float | None}``. ``sampled`` is ``None`` —
        *unknown* — when the corpus carries no sampling record for any one of the sources;
        otherwise it is true when any of them was sampled, and ``rate`` is the smallest rate.
    """
    records = [(corpus.sampling or {}).get(source) for source in sorted(set(sources))]
    if corpus.sampling is None or any(record is None for record in records):
        return {"sampled": None, "rate": None}
    known = [record for record in records if record is not None]
    return {
        "sampled": any(record.sampled for record in known),
        "rate": round_half(min((record.rate for record in known), default=1.0), 4),
    }


def distinct_refs(
    refs: Iterable[EvidenceRef], limit: int | None = None
) -> list[EvidenceRef]:
    """Keep the first occurrence of each reference, in order, up to ``limit``.

    Args:
        refs: References, most important first — a caller puts the ones ``data`` cites
            ahead of the rest, so a cap never drops a cited reference.
        limit: The most to keep, or ``None`` for all.

    Returns:
        The distinct references.
    """
    kept: list[EvidenceRef] = []
    seen: set[EvidenceRef] = set()
    for ref in refs:
        if ref in seen:
            continue
        if limit is not None and len(kept) >= limit:
            break
        seen.add(ref)
        kept.append(ref)
    return kept


def build_ref(build_id: str) -> EvidenceRef:
    """A ``build`` evidence reference.

    Args:
        build_id: The ``build_jobs`` id.

    Returns:
        The reference.
    """
    return EvidenceRef(kind=EvidenceKind.BUILD, id=build_id)


def utc(instant: datetime) -> datetime:
    """An aware instant expressed in UTC.

    Args:
        instant: Any aware datetime.

    Returns:
        The same instant with a UTC offset.
    """
    return instant.astimezone(UTC)
