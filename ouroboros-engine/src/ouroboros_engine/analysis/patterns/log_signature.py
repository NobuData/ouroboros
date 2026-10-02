"""The log-signature analyzer — failure text clustered by template (mockup 18, BA-1).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). Build failures are
near-identical text in which timestamps, paths, PIDs and addresses vary, so grouping raw lines
finds nothing and substring matching over-merges. The rule here is the drain-style one:

**1. Select.** Only *marker* lines are read — a line matching :data:`PARAMETERS` ``markers``
(``FAIL``/``ERROR``/``FATAL`` at the start, ``error:``, ``warning:``, ``timed out``, ``panic``).
Progress chatter is never a signature.

**2. Normalise.** Each ``masks`` pattern, in order, replaces what varies with ``<*>``:
timestamps, dates, clock times, uuids, ``0x`` addresses, long hex digests, IP addresses, path
tokens (anything with a ``/``), then free-standing numbers — a number glued to a word or a
``#`` (``ota_v2``, ``ccache#1412``) is identity, not noise, and is kept. Whitespace collapses.
What is left is the line's **template**.

**3. Hash and cluster.** A template's identity is the first 16 hex characters of its sha256 —
the finding's ``subject_key``, so the same failure keeps the same id run after run. Lines with
equal templates are one cluster; nothing else is merged. A paraphrase the masks do not
normalise stays a separate cluster: under-merging is the honest failure mode (semantic matching
is BX.1's), over-merging unrelated failures is not.

**Measures.** ``count`` is the distinct builds the template appears in; ``lines`` its lines.
``share`` is ``lines / family_lines``, where a template's *family* is its first
``family_tokens`` whitespace tokens, each cut at its first ``.`` — so
``FAIL - ota.fixture.shared_setup: …`` belongs to ``FAIL - ota`` and its share is a share of
the OTA suite's failure lines. ``first_seen``/``last_seen`` are UTC days; ``sample_refs`` are
the first ``sample_refs`` builds by (day, id). Clusters seen in fewer than ``min_builds``
builds are not findings; the rest are ranked by builds, then recency, then hash, and at most
``max_clusters`` are emitted.

**Confidence** is ``100 * (1 - e^(-count/10)) * (0.5 + 0.5 * stability)``, rounded, where
``stability`` is the share of days from first to last seen on which the template appeared —
a failure that recurs steadily is surer than one burst. ``effect_size`` is the share and
``sample_size`` the family's lines.
"""

import hashlib
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, ClassVar

from ouroboros_engine.analysis.common import (
    build_ref,
    distinct_refs,
    round_half,
    sampling_note,
)
from ouroboros_engine.analysis.contract import (
    ConfidenceBasis,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    Finding,
    Grain,
    LogTail,
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: The placeholder a masked token becomes.
PLACEHOLDER = "<*>"

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "markers": r"^(?:FAIL|ERROR|FATAL)\b|\berror:|\bwarning:|\btimed out\b|\bpanic\b",
    "masks": [
        [
            "timestamp",
            r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?",
        ],
        ["date", r"\b\d{4}-\d{2}-\d{2}\b"],
        ["clock", r"\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b"],
        [
            "uuid",
            r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        ],
        ["address", r"\b0x[0-9a-fA-F]+\b"],
        ["digest", r"\b[0-9a-f]{8,}\b"],
        ["ip", r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b"],
        ["path", r"(?<![\w<])[\w.+~-]*/[\w./+~:-]*"],
        ["number", r"(?<![\w#<*])\d+(?:\.\d+)?"],
    ],
    "family_tokens": 3,
    "min_builds": 3,
    "max_clusters": 20,
    "sample_refs": 3,
    "max_evidence": 200,
    "hash_chars": 16,
}

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "log_signature v1: 100 * (1 - e^(-builds/10)) * (0.5 + 0.5 * stability), "
    "stability = days seen / days from first to last seen; share of the template's family"
)

_MARKERS = re.compile(PARAMETERS["markers"])
_MASKS = [re.compile(pattern) for _, pattern in PARAMETERS["masks"]]
_SPACES = re.compile(r"\s+")


def template_of(line: str) -> str:
    """Normalise one log line to its template — every variable token masked.

    Args:
        line: A raw log line.

    Returns:
        The template: masks applied in order, whitespace collapsed, ends stripped.
    """
    text = line
    for mask in _MASKS:
        text = mask.sub(PLACEHOLDER, text)
    return _SPACES.sub(" ", text).strip()


def signature_hash(template: str) -> str:
    """A template's stable identity.

    Args:
        template: The template.

    Returns:
        The first ``hash_chars`` hex characters of its sha256.
    """
    digest = hashlib.sha256(template.encode()).hexdigest()
    return digest[: PARAMETERS["hash_chars"]]


def family_of(template: str) -> str:
    """The family a template's share is measured against.

    Args:
        template: The template.

    Returns:
        Its first ``family_tokens`` whitespace tokens, each cut at its first ``.``.
    """
    tokens = template.split(" ")[: PARAMETERS["family_tokens"]]
    return " ".join(token.split(".", 1)[0] for token in tokens)


def is_marker(line: str) -> bool:
    """Whether a line is a failure-class line the analyzer reads.

    Args:
        line: A raw log line.

    Returns:
        True when it matches ``markers``.
    """
    return _MARKERS.search(line) is not None


@dataclass
class _Cluster:
    """What is accumulated for one template."""

    template: str
    lines: int = 0
    builds: dict[str, date] = field(default_factory=dict)


class LogSignatureAnalyzer(Analyzer):
    """Failure-line templates, clustered by hash, ranked by how many builds they hit."""

    id: ClassVar[str] = "log_signature"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {CorpusRequirement(source=CorpusSource.LOG_TAILS, grain=Grain.BUILD)}
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Cluster the corpus's failure lines by template.

        Args:
            corpus: A corpus carrying ``log_tails``.

        Returns:
            One ``log_signature`` finding per cluster seen in ``min_builds`` builds or more,
            at most ``max_clusters``, best first.
        """
        clusters, families = _cluster(corpus.log_tails or [])
        ranked = sorted(
            (c for c in clusters.values() if len(c.builds) >= PARAMETERS["min_builds"]),
            key=lambda c: (
                -len(c.builds),
                -max(c.builds.values()).toordinal(),
                signature_hash(c.template),
            ),
        )[: PARAMETERS["max_clusters"]]
        sampling = sampling_note(corpus, [CorpusSource.LOG_TAILS])
        return [_finding(c, families, sampling) for c in ranked]


def _cluster(tails: list[LogTail]) -> tuple[dict[str, _Cluster], dict[str, int]]:
    """Template every marker line and group the lines by template.

    Args:
        tails: The corpus's log tails, in any order.

    Returns:
        The clusters by template, and each family's line count.
    """
    clusters: dict[str, _Cluster] = {}
    families: dict[str, int] = defaultdict(int)
    for tail in sorted(tails, key=lambda t: (t.day, t.build_id)):
        for line in tail.lines:
            if not is_marker(line):
                continue
            template = template_of(line)
            if not template:
                continue
            cluster = clusters.setdefault(template, _Cluster(template))
            cluster.lines += 1
            cluster.builds.setdefault(tail.build_id, tail.day)
            families[family_of(template)] += 1
    return clusters, dict(families)


def _finding(
    cluster: _Cluster, families: dict[str, int], sampling: dict[str, Any]
) -> Finding:
    """Build the finding for one cluster.

    Args:
        cluster: The cluster.
        families: Each family's line count.
        sampling: The log tails' sampling note.

    Returns:
        The finding.
    """
    family = family_of(cluster.template)
    family_lines = families[family]
    share = cluster.lines / family_lines
    ordered = sorted(cluster.builds.items(), key=lambda item: (item[1], item[0]))
    samples = [
        build_ref(build_id) for build_id, _ in ordered[: PARAMETERS["sample_refs"]]
    ]
    refs = distinct_refs(
        [*samples, *(build_ref(build_id) for build_id, _ in ordered)],
        PARAMETERS["max_evidence"],
    )
    days = sorted(set(cluster.builds.values()))
    span = (days[-1] - days[0]).days + 1
    stability = len(days) / span
    count = len(cluster.builds)
    score = 100 * (1 - math.exp(-count / 10)) * (0.5 + 0.5 * stability)
    digest = signature_hash(cluster.template)
    return Finding(
        analyzer=LogSignatureAnalyzer.id,
        analyzer_version=LogSignatureAnalyzer.version,
        finding_type="log_signature",
        subject_key=digest,
        data={
            "template": cluster.template,
            "signature_hash": digest,
            "count": count,
            "lines": cluster.lines,
            "share": round_half(share, 3),
            "family": family,
            "family_lines": family_lines,
            "first_seen": days[0].isoformat(),
            "last_seen": days[-1].isoformat(),
            "sample_refs": [ref.model_dump(mode="json") for ref in samples],
            "sampling": sampling,
        },
        evidence_refs=refs,
        confidence=int(round_half(score, 0)),
        confidence_basis=ConfidenceBasis(
            method=CONFIDENCE_METHOD,
            sample_size=family_lines,
            effect_size=round_half(share, 3),
            stability=round_half(stability, 3),
        ),
    )
