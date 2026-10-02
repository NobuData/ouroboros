"""The waiver-cite analyzer — waivers that keep citing the same gap (mockup 18, BA-3).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). One waiver is a decision; three
waivers giving the same reason are a missing capability — *"3 waivers in 60 days cite thermal
chamber availability"* is the thermal-chamber rig ticket's evidence.

**Window.** Waivers dated in the last ``window_days`` days up to the corpus window's end.

**Normalise.** A reason is lower-cased; uuids, hex digests and numbers are dropped; what remains
is split into alphabetic tokens. Tokens shorter than ``min_token_length`` and ``stopwords`` —
function words and the vocabulary every waiver shares (``waive``, ``test``, ``flaky``…) — are
dropped. A waiver is the *set* of its remaining tokens.

**Cluster.** Every token carried by at least ``min_waivers`` waivers proposes a cluster: the
waivers carrying it. Proposals are taken most-carried first (then alphabetically). A proposal
whose members equal or sit inside an earlier cluster's adds nothing and is dropped. A cluster's
``topic`` is the tokens **all** its members share, in the order the earliest waiver uses them,
at most ``max_topic_tokens``. Its ``subject_key`` is those shared tokens sorted, so the identity
does not move when a newer waiver joins.

**Confidence** is ``100 * min(1, waivers / (2 * min_waivers)) * (0.5 + 0.5 * cohesion)``, where
``cohesion`` is the shared tokens over the mean tokens per member — how much of each reason the
topic accounts for. ``effect_size`` is the cluster's share of the window's waivers.
"""

import re
import statistics
from datetime import timedelta
from typing import Any, ClassVar

from ouroboros_engine.analysis.common import round_half, sampling_note
from ouroboros_engine.analysis.contract import (
    ConfidenceBasis,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    EvidenceKind,
    EvidenceRef,
    Finding,
    Grain,
    Waiver,
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "window_days": 60,
    "min_waivers": 3,
    "min_token_length": 3,
    "max_topic_tokens": 4,
    "max_case_keys": 20,
    "stopwords": sorted(
        {
            "about", "after", "again", "all", "also", "and", "any", "are", "because",
            "been", "before", "but", "can", "case", "cases", "did", "does", "due", "for",
            "from", "has", "have", "into", "its", "just", "lack", "lacks", "known", "more",
            "not", "now", "off", "once", "only", "our", "out", "per", "pending", "run",
            "same", "should", "skip", "skipped", "skipping", "still", "test", "tests",
            "than", "that", "the", "then", "there", "this", "until", "was", "waive",
            "waived", "waiver", "waivers", "waiving", "week", "were", "when", "which",
            "while", "will", "with", "without", "flaky", "flake", "fails", "failing",
            "failure", "failures", "pass", "passes", "temporarily", "today", "tomorrow",
        }
    ),
}  # fmt: skip

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "waiver_cite v1: waivers in the window whose reasons share a topic token; "
    "100 * min(1, waivers / 6) * (0.5 + 0.5 * cohesion)"
)

_NOISE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{8,}\b|\d+"
)
_TOKEN = re.compile(r"[a-z]+")
_STOPWORDS = frozenset(PARAMETERS["stopwords"])


def tokens_of(reason: str) -> list[str]:
    """A reason's content tokens, in order of first use.

    Args:
        reason: A waiver's free-text reason.

    Returns:
        The distinct tokens that survive normalisation, first use first.
    """
    text = _NOISE.sub(" ", reason.lower())
    ordered: list[str] = []
    for token in _TOKEN.findall(text):
        if (
            len(token) >= PARAMETERS["min_token_length"]
            and token not in _STOPWORDS
            and token not in ordered
        ):
            ordered.append(token)
    return ordered


class WaiverCiteAnalyzer(Analyzer):
    """Recurring gaps, from waiver reasons that keep citing them."""

    id: ClassVar[str] = "waiver_cite"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {CorpusRequirement(source=CorpusSource.WAIVERS, grain=Grain.WAIVER)}
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Cluster the window's waivers by the topic their reasons share.

        Args:
            corpus: A corpus carrying ``waivers``.

        Returns:
            One ``waiver_cite`` finding per cluster, largest first.
        """
        since = corpus.window.to - timedelta(days=PARAMETERS["window_days"] - 1)
        waivers = sorted(
            (w for w in corpus.waivers or [] if w.day >= since),
            key=lambda w: (w.day, w.waiver_id),
        )
        tokens = {w.waiver_id: tokens_of(w.reason) for w in waivers}
        carriers: dict[str, list[Waiver]] = {}
        for waiver in waivers:
            for token in tokens[waiver.waiver_id]:
                carriers.setdefault(token, []).append(waiver)
        proposals = sorted(
            (
                (token, members)
                for token, members in carriers.items()
                if len(members) >= PARAMETERS["min_waivers"]
            ),
            key=lambda item: (-len(item[1]), item[0]),
        )
        sampling = sampling_note(corpus, [CorpusSource.WAIVERS])
        taken: list[frozenset[str]] = []
        findings = []
        for _, members in proposals:
            ids = frozenset(w.waiver_id for w in members)
            if any(ids <= earlier for earlier in taken):
                continue
            taken.append(ids)
            findings.append(_finding(members, tokens, len(waivers), sampling))
        return findings


def _finding(
    members: list[Waiver],
    tokens: dict[str, list[str]],
    in_window: int,
    sampling: dict[str, Any],
) -> Finding:
    """Build the finding for one cluster.

    Args:
        members: The cluster's waivers, oldest first.
        tokens: Each waiver's tokens.
        in_window: How many waivers the window holds.
        sampling: The waivers source's sampling note.

    Returns:
        The finding.
    """
    shared = set.intersection(*(set(tokens[w.waiver_id]) for w in members))
    ordered = [t for t in tokens[members[0].waiver_id] if t in shared]
    topic = " ".join(ordered[: PARAMETERS["max_topic_tokens"]])
    mean_tokens = statistics.mean(len(tokens[w.waiver_id]) for w in members)
    cohesion = len(shared) / mean_tokens
    count = len(members)
    score = (
        100 * min(1.0, count / (2 * PARAMETERS["min_waivers"])) * (0.5 + 0.5 * cohesion)
    )
    case_keys = sorted({key for w in members for key in w.case_keys})
    return Finding(
        analyzer=WaiverCiteAnalyzer.id,
        analyzer_version=WaiverCiteAnalyzer.version,
        finding_type="waiver_cite",
        subject_key=" ".join(sorted(shared)),
        data={
            "topic": topic,
            "window_days": PARAMETERS["window_days"],
            "waiver_count": count,
            "first_day": members[0].day.isoformat(),
            "last_day": members[-1].day.isoformat(),
            "case_keys": case_keys[: PARAMETERS["max_case_keys"]],
            "sampling": sampling,
        },
        evidence_refs=[
            EvidenceRef(kind=EvidenceKind.WAIVER, id=w.waiver_id) for w in members
        ],
        confidence=int(round_half(score, 0)),
        confidence_basis=ConfidenceBasis(
            method=CONFIDENCE_METHOD,
            sample_size=count,
            effect_size=round_half(count / in_window, 3),
            stability=round_half(min(1.0, cohesion), 3),
        ),
    )
