"""Why the guardrails stopped a stage, in one sentence the run's finish carries (#315).

A change-set report (``PUT /internal/runs/{id}/files``) answers AP.3's verdicts. Since AR.1
each failed check carries the mode its workspace judges it under: a ``block`` failure sets
``needsHuman`` and the interpreter halts the stage at that tool boundary; a ``warn`` failure
is shown on the console and changes nothing here.

:func:`halt_reason` renders the ``block`` verdicts as the control plane sent them — for
example ``guardrail allowed_paths failed: boot/rollback_flag.c (boot/**)`` — joined with
``"; "`` and clipped to the finish's 500 characters.
"""

from __future__ import annotations

from typing import Final

from ouroboros_engine.control_plane.ingest import ChangeSet, GuardrailVerdict

#: The longest reason ``/finish`` accepts.
REASON_LIMIT: Final = 500

#: The reason when the answer flags the run but names no ``block`` verdict (a control plane
#: that predates per-check verdicts).
GENERIC_REASON: Final = "The guardrails need a person."


def _evidence(verdict: GuardrailVerdict) -> str | None:
    """A verdict's evidence as a clause.

    Args:
        verdict: One failed check.

    Returns:
        The detail when the check wrote one, else the path with its line and glob or rule,
        else ``None``.
    """
    evidence = verdict.evidence
    if evidence is None:
        return None
    if evidence.detail and evidence.detail.strip():
        return evidence.detail.strip()
    if not evidence.path:
        return None
    where = (
        evidence.path if evidence.line is None else f"{evidence.path}:{evidence.line}"
    )
    why = evidence.glob or evidence.rule_id
    return f"{where} ({why})" if why else where


def render_verdict(verdict: GuardrailVerdict) -> str:
    """One failed check as a clause.

    Args:
        verdict: The check.

    Returns:
        ``guardrail <check> failed``, with ``: <evidence>`` when there is any.
    """
    clause = f"guardrail {verdict.check} failed"
    evidence = _evidence(verdict)
    return f"{clause}: {evidence}" if evidence else clause


def halt_reason(change_set: ChangeSet) -> str:
    """The finish reason for a change-set that needs a person.

    Args:
        change_set: The report's answer, with ``needs_human`` set.

    Returns:
        The ``block`` verdicts rendered and joined, at most :data:`REASON_LIMIT`
        characters. Without verdicts, the failed check names that are not warnings; without
        those, :data:`GENERIC_REASON`.
    """
    clauses = [
        render_verdict(verdict)
        for verdict in change_set.guardrail_verdicts
        if verdict.mode == "block"
    ]
    if not clauses:
        warned = set(change_set.guardrail_warnings)
        clauses = [
            f"guardrail {check} failed"
            for check in change_set.guardrail_failures
            if check not in warned
        ]
    reason = "; ".join(clauses) or GENERIC_REASON
    if len(reason) <= REASON_LIMIT:
        return reason
    return reason[: REASON_LIMIT - 3] + "..."
