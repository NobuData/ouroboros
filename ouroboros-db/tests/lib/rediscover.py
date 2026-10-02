"""Run the engine's change-point analyzer over a seeded corpus and compare with the stored findings.

#509 (BU.4). tests/verify-analyzer-rediscovery.sh reads two documents out of the seeded
database and hands them to this script, which runs under ouroboros-engine's own environment
(``uv run --project ouroboros-engine``) so that the analyzer under test is the one that ships:

* ``corpus.json`` — tests/lib/analyzer-corpus.sql's output, the engine's ``Corpus``;
* ``findings.json`` — the change-point findings R__dev_seed_workspace_metrics_analyzer.sql
  stored on the page's run, as ``[{analyzer, analyzer_version, finding_type, subject_key, data,
  evidence_refs, confidence, confidence_basis}]``.

It passes when the analyzer emits **exactly** the stored findings — the same breakpoints with the
same deltas and medians, the same ranked candidates with every score component, the same evidence
and the same confidence with its basis — and when every planted anchor out-ranks the near misses
beside it. A comparison that could not fail would prove nothing, so it then perturbs one stored
delta and requires the comparison to notice.

Usage:
    uv run --project ouroboros-engine python ouroboros-db/tests/lib/rediscover.py corpus.json findings.json

Exit status: 0 rediscovered; 1 the analyzer and the seed disagree; 2 bad input.
"""

import copy
import json
import sys
from pathlib import Path
from typing import Any

from ouroboros_engine.analysis.changepoint import ChangePointAnalyzer
from ouroboros_engine.analysis.contract import Corpus

#: The fields a stored finding and an emitted one must agree on.
COMPARED = (
    "analyzer",
    "analyzer_version",
    "finding_type",
    "subject_key",
    "data",
    "evidence_refs",
    "confidence",
    "confidence_basis",
)


def emitted(corpus: Corpus) -> list[dict[str, Any]]:
    """The analyzer's findings over a corpus, as plain JSON values.

    Args:
        corpus: The seeded corpus.

    Returns:
        One dict per finding, keyed as the stored rows are.
    """
    return [
        json.loads(finding.model_dump_json())
        for finding in ChangePointAnalyzer().analyze(corpus)
    ]


def differences(stored: list[dict[str, Any]], found: list[dict[str, Any]]) -> list[str]:
    """Every way the stored findings and the emitted ones disagree.

    Args:
        stored: The seeded findings.
        found: The analyzer's findings.

    Returns:
        Human-readable differences; empty when the two sets are the same.
    """
    problems = []
    by_subject = {finding["subject_key"]: finding for finding in stored}
    emitted_subjects = {finding["subject_key"] for finding in found}

    for subject in sorted(set(by_subject) - emitted_subjects):
        problems.append(f"seeded but not rediscovered: {subject}")
    for finding in found:
        seeded = by_subject.get(finding["subject_key"])
        if seeded is None:
            problems.append(f"rediscovered but not seeded: {finding['subject_key']}")
            continue
        for field in COMPARED:
            if seeded.get(field) != finding.get(field):
                problems.append(
                    f"{finding['subject_key']}: {field} differs\n"
                    f"    seeded:   {json.dumps(seeded.get(field), sort_keys=True)}\n"
                    f"    analyzer: {json.dumps(finding.get(field), sort_keys=True)}"
                )
    return problems


def anchors_outrank(found: list[dict[str, Any]]) -> list[str]:
    """Check each breakpoint's top candidate scores strictly above every other in reach.

    Args:
        found: The analyzer's findings.

    Returns:
        Human-readable failures; empty when every anchor wins outright.
    """
    problems = []
    for finding in found:
        candidates = finding["data"]["candidates"]
        if len(candidates) < 2:
            problems.append(
                f"{finding['subject_key']}: no near miss in reach — ranking is untested"
            )
            continue
        top = candidates[0]["score"]
        if any(candidate["score"] >= top for candidate in candidates[1:]):
            problems.append(
                f"{finding['subject_key']}: {candidates[0]['label']} does not win outright"
            )
    return problems


def main(argv: list[str]) -> int:
    """Compare, report, and prove the comparison can fail.

    Args:
        argv: ``[corpus.json, findings.json]``.

    Returns:
        The exit status.
    """
    if len(argv) != 2:
        sys.stderr.write("usage: rediscover.py corpus.json findings.json\n")
        return 2
    try:
        corpus = Corpus.model_validate(
            json.loads(Path(argv[0]).read_text(encoding="utf-8"))
        )
        stored = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        sys.stderr.write(f"rediscover: cannot read the inputs: {error}\n")
        return 2

    found = emitted(corpus)
    sys.stdout.write(
        f"corpus: {len(corpus.builds or [])} builds, {len(corpus.events or [])} events, "
        f"{corpus.window.from_} … {corpus.window.to}\n"
    )
    for finding in found:
        data = finding["data"]
        sys.stdout.write(
            f"  {data['date']}  {data['delta_seconds']:+d} s  "
            f"{data['candidates'][0]['label']}  (confidence {finding['confidence']})\n"
        )

    problems = differences(stored, found) + anchors_outrank(found)
    if not stored:
        problems.append("the seeded run stores no change-point findings")
    if problems:
        sys.stdout.write(
            "NOT rediscovered:\n" + "\n".join(f"  {p}" for p in problems) + "\n"
        )
        return 1

    # The control: a seed whose stored delta is one second off must not pass.
    tampered = copy.deepcopy(stored)
    tampered[0]["data"]["delta_seconds"] += 1
    if not differences(tampered, found):
        sys.stdout.write(
            "the comparison did not notice a tampered delta — it asserts nothing\n"
        )
        return 1

    sys.stdout.write(
        f"rediscovered: all {len(found)} seeded change-points, and a tampered one is refused\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
