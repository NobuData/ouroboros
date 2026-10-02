"""The config-usage analyzer — options no build sets, sets differently, or drifts on (BA-4).

BV.3 (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_). *"0 / 1,284 builds set this
option"* justifies deleting dead configuration, which is only safe if the corpus really covered
all 1,284 builds. So the analyzer is built around that one risk.

**What is counted.** ``builds_considered`` is every job whose configuration is known
(``config`` not ``None``). Against the declared options (``config_options``) each option gets:

* ``occurrences`` — the considered builds whose configuration set it;
* ``values`` — how many distinct values those builds set it to;
* ``drift_warnings`` — the builds whose log tail carries Kconfig's
  ``warning: <OPTION> (defined at …)`` line, i.e. a requested value the build did not get. Read
  only when the corpus carries ``log_tails``; otherwise ``null`` — not known, not zero.

**What is a finding** (``data.claim``):

* ``never_set`` — no considered build set it: an *absence* claim;
* ``never_varied`` — every considered build set it, all to the same value: also an absence claim
  (of variation), the option is a constant;
* ``drift`` — set or not, at least one build drifted on it: a *presence* claim.

**Sampling-awareness.** An absence claim is only as good as the coverage behind it. When the
jobs source was sampled — or its sampling is unknown (no record) — the ``absence_when_sampled``
policy decides: ``qualify`` (v1) emits the claim with ``qualified: true``, the read rate and a
``qualification`` sentence, and caps its confidence at ``sampled_confidence_cap``; ``suppress``
emits no absence claim at all. A drift claim is a presence claim and is never qualified.

**Confidence.** An absence claim over a full read is ``exhaustive_confidence`` (95: the count
is exhaustive, and the 5 held back is for configuration set outside the build's arguments); a
drift claim is ``100 * (1 - e^(-warnings/2))``. ``effect_size`` is ``occurrences /
builds_considered`` (drift: warnings / builds considered); ``stability`` is the read rate.

Evidence is the builds that drifted, then the latest considered build — the one a reader opens
to see the configuration as it stands.
"""

import math
import re
from collections import defaultdict
from typing import Any, ClassVar, Literal

from ouroboros_engine.analysis.common import (
    build_ref,
    distinct_refs,
    round_half,
    sampling_note,
)
from ouroboros_engine.analysis.contract import (
    BuildJob,
    ConfidenceBasis,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    Finding,
    Grain,
)
from ouroboros_engine.analysis.spi import Analyzer, AnalyzerBudget

#: What happens to an absence claim when the corpus was (or may have been) sampled.
AbsencePolicy = Literal["qualify", "suppress"]

#: The documented tuning. Pinned in the ledger.
PARAMETERS: dict[str, Any] = {
    "absence_when_sampled": "qualify",
    "sampled_confidence_cap": 60,
    "exhaustive_confidence": 95,
    "drift_pattern": r"\bwarning: (?P<option>[A-Za-z_][A-Za-z0-9_]*) \(defined at ",
    "max_evidence": 200,
}

#: How a confidence is computed, as the scoring popover states it.
CONFIDENCE_METHOD = (
    "config_usage v1: absence over a full read = 95, capped at 60 when sampled or unknown; "
    "drift = 100 * (1 - e^(-warnings/2)); over every build whose configuration is known"
)

_DRIFT = re.compile(PARAMETERS["drift_pattern"])


class ConfigUsageAnalyzer(Analyzer):
    """Declared options never set, never varied, or drifting — sampling-aware."""

    id: ClassVar[str] = "config_usage"
    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {
            CorpusRequirement(source=CorpusSource.JOBS, grain=Grain.BUILD),
            CorpusRequirement(source=CorpusSource.CONFIG_OPTIONS, grain=Grain.OPTION),
        }
    )
    parameters: ClassVar[dict[str, Any]] = PARAMETERS
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget(time_seconds=60)

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Find the declared options the corpus's builds never set, never vary, or drift on.

        Args:
            corpus: A corpus carrying ``jobs`` and ``config_options``.

        Returns:
            One ``config_usage`` finding per option with a claim, in option order.
        """
        return config_usage_findings(corpus, PARAMETERS["absence_when_sampled"])


def config_usage_findings(corpus: Corpus, policy: AbsencePolicy) -> list[Finding]:
    """The analyzer's findings under an explicit absence policy.

    The analyzer runs this with its pinned policy; it is a function so both policies can be
    exercised against the same corpus.

    Args:
        corpus: A corpus carrying ``jobs`` and ``config_options``.
        policy: ``qualify`` or ``suppress`` — what a sampled absence claim becomes.

    Returns:
        The findings, in option-name order.

    Raises:
        ValueError: The policy is not one of the two.
    """
    if policy not in ("qualify", "suppress"):
        raise ValueError(f"absence policy {policy!r} is not known")
    considered = sorted(
        (job for job in corpus.jobs or [] if job.config is not None),
        key=lambda job: (job.finished_at, job.build_id),
    )
    if not considered:
        return []
    values: dict[str, set[str]] = defaultdict(set)
    occurrences: dict[str, int] = defaultdict(int)
    for job in considered:
        for option, value in (job.config or {}).items():
            occurrences[option] += 1
            values[option].add(value)
    drifted = _drift(corpus)
    sampling = sampling_note(corpus, [CorpusSource.JOBS])
    full_read = sampling["sampled"] is False

    findings = []
    for name in sorted({option.name for option in corpus.config_options or []}):
        claim = _claim(name, occurrences, values, drifted, len(considered))
        if claim is None:
            continue
        absence = claim != "drift"
        if absence and not full_read and policy == "suppress":
            continue
        findings.append(
            _finding(
                name,
                claim,
                occurrences[name],
                len(values[name]),
                drifted,
                considered,
                sampling,
                qualified=absence and not full_read,
            )
        )
    return findings


def _drift(corpus: Corpus) -> dict[str, list[str]] | None:
    """The builds whose log tail reports drift, per option.

    Args:
        corpus: The corpus.

    Returns:
        Option → build ids in (day, id) order, or ``None`` when the corpus has no log tails.
    """
    if corpus.log_tails is None:
        return None
    drifted: dict[str, list[str]] = defaultdict(list)
    for tail in sorted(corpus.log_tails, key=lambda t: (t.day, t.build_id)):
        options = {
            m.group("option") for line in tail.lines for m in _DRIFT.finditer(line)
        }
        for option in sorted(options):
            drifted[option].append(tail.build_id)
    return dict(drifted)


def _claim(
    name: str,
    occurrences: dict[str, int],
    values: dict[str, set[str]],
    drifted: dict[str, list[str]] | None,
    considered: int,
) -> str | None:
    """Which claim, if any, an option supports.

    Args:
        name: The option.
        occurrences: Builds setting each option.
        values: Distinct values each option was set to.
        drifted: Builds drifting on each option, or ``None`` when not known.
        considered: Builds whose configuration is known.

    Returns:
        ``never_set``, ``never_varied``, ``drift`` or ``None``.
    """
    if occurrences.get(name, 0) == 0:
        return "never_set"
    if occurrences[name] == considered and len(values[name]) == 1:
        return "never_varied"
    if drifted and drifted.get(name):
        return "drift"
    return None


def _finding(
    name: str,
    claim: str,
    occurrences: int,
    distinct_values: int,
    drifted: dict[str, list[str]] | None,
    considered: list[BuildJob],
    sampling: dict[str, Any],
    *,
    qualified: bool,
) -> Finding:
    """Build the finding for one option.

    Args:
        name: The option.
        claim: ``never_set``, ``never_varied`` or ``drift``.
        occurrences: Builds that set it.
        distinct_values: Distinct values they set it to.
        drifted: Builds drifting on each option, or ``None`` when not known.
        considered: The builds whose configuration is known, oldest first.
        sampling: The jobs source's sampling note.
        qualified: Whether this is an absence claim over a sampled or unknown read.

    Returns:
        The finding.
    """
    drift_builds = (drifted or {}).get(name, [])
    warnings = None if drifted is None else len(drift_builds)
    builds = len(considered)
    if claim == "drift":
        confidence = 100 * (1 - math.exp(-(warnings or 0) / 2))
        effect = (warnings or 0) / builds
    else:
        confidence = PARAMETERS["exhaustive_confidence"]
        if qualified:
            confidence = min(confidence, PARAMETERS["sampled_confidence_cap"])
        effect = occurrences / builds
    data: dict[str, Any] = {
        "option": name,
        "claim": claim,
        "occurrences": occurrences,
        "builds_considered": builds,
        "distinct_values": distinct_values,
        "qualified": qualified,
        "sampling": sampling,
    }
    if warnings is not None:
        data["drift_warnings"] = warnings
    if qualified:
        data["qualification"] = (
            "absence observed in a sampled corpus"
            if sampling["sampled"]
            else "absence observed in a corpus whose sampling is unknown"
        )
    refs = distinct_refs(
        [
            *(build_ref(build_id) for build_id in drift_builds),
            build_ref(considered[-1].build_id),
        ],
        PARAMETERS["max_evidence"],
    )
    return Finding(
        analyzer=ConfigUsageAnalyzer.id,
        analyzer_version=ConfigUsageAnalyzer.version,
        finding_type="config_usage",
        subject_key=name,
        data=data,
        evidence_refs=refs,
        confidence=int(round_half(confidence, 0)),
        confidence_basis=ConfidenceBasis(
            method=CONFIDENCE_METHOD,
            sample_size=builds,
            effect_size=round_half(effect, 3),
            stability=sampling["rate"] if sampling["rate"] is not None else 0.0,
        ),
    )
