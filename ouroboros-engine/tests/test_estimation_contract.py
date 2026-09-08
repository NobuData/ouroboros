"""The contract held against K.2's row, and against the vocabularies both sides enforce.

``POST /v0/estimate``'s response exists to be *persisted*: L.3
(`#107 <https://github.com/NobuData/ouroboros/issues/107>`_) writes it into K.2's
``issue_estimates`` (`#100 <https://github.com/NobuData/ouroboros/issues/100>`_) without
translating it, which is only true while the two shapes agree field for field. So this file
holds K.2's row as data — every column, every jsonb key, and which response field carries
each — and fails on a drift in either direction: a field added to the contract that no
column stores, and a column that nothing answers with.

**What this can and cannot see, stated rather than glossed.** K.2 has not landed yet, so the
table below is the ticket's specification of it rather than a reading of a migration. The two
are joined the moment the migration exists: :func:`_issue_estimates_migration` finds it by
name, and the tests at the bottom of this file assert that every column and jsonb key named
here appears in it. Until then those tests skip-by-vacuity rather than lie — they are written
so that the *arrival* of the migration is what starts checking it, and a migration that
renames ``est_minutes`` is a red build in this module on the day it lands.

What no test here can catch is a column K.2 adds that this contract has no field for. That is
deliberate and not a gap: five of the columns below are the persister's on purpose — the
row's identity, its version, its clock — and a sixth one arriving is far more likely to be
another of those than a field an estimator should have filled.
"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from ouroboros_engine.estimation.contract import (
    EFFORTS,
    MAX_CONFIDENCE,
    MIN_CONFIDENCE,
    RISKS,
    Breakdown,
    Estimate,
    Trace,
)

#: Every column of K.2's ``issue_estimates``, in the order the ticket lists them, mapped to
#: the response field that carries it — or to ``None`` for the five that are the *row
#: writer's* and never the estimator's. An estimator does not know which issue row it was
#: called for, cannot know which version its answer will become, and must not own the clock:
#: a timestamp in a response body is one two services can disagree about.
ESTIMATE_COLUMNS: dict[str, str | None] = {
    "id": None,
    "github_issue_id": None,
    "version": None,
    "effort": "effort",
    "confidence": "confidence",
    "suggested_workflow": "suggested_workflow",
    "routed_model": "routed_model",
    "breakdown": "breakdown",
    "risk": "risk",
    "risk_note": "risk_note",
    "trace": "trace",
    "created_at": None,
}

#: The ``breakdown`` jsonb's keys, mapped the same way. All five are the estimator's — the
#: panel renders four and M.3's queue write reads the fifth.
BREAKDOWN_KEYS: dict[str, str | None] = {
    "files": "files",
    "est_tokens": "est_tokens",
    "cycle_min": "cycle_min",
    "cycle_max": "cycle_max",
    "est_minutes": "est_minutes",
}

#: The ``trace`` jsonb's keys. ``sized_at`` is the one the response deliberately does not
#: carry, for the reason the header of this file gives.
TRACE_KEYS: dict[str, str | None] = {
    "estimator": "estimator",
    "sized_at": None,
    "tokens_used": "tokens_used",
    "signals": "signals",
}

#: K.2's two CHECK vocabularies, written out rather than read from the contract, so this is
#: a comparison rather than a restatement.
K2_EFFORTS = ("xs", "s", "m", "l", "xl")
K2_RISKS = ("low", "medium", "high")

#: Where ``ouroboros-db``'s migrations live, from this file rather than the working
#: directory — the same resolution ``tests/test_control_plane_contract.py`` uses to read the
#: control plane's committed document.
_MIGRATIONS = Path(__file__).resolve().parents[2] / "ouroboros-db" / "migrations"


def _carried(mapping: dict[str, str | None]) -> set[str]:
    """The fields a response actually carries, out of one of the tables above.

    Args:
        mapping: One of :data:`ESTIMATE_COLUMNS`, :data:`BREAKDOWN_KEYS`,
            :data:`TRACE_KEYS`.

    Returns:
        Every response field name in it, with the persister's ``None`` entries dropped.
    """
    return {field for field in mapping.values() if field is not None}


#: What creating K.2's table looks like, whichever way the migration writes it — with or
#: without a schema prefix, with or without ``if not exists``. Matched rather than searching
#: for the table's *name*, because K.1's migration already mentions ``issue_estimates`` in a
#: comment about what K.2 will attach, and a looser search finds that instead.
_CREATE_ISSUE_ESTIMATES = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_]+\.)?issue_estimates\b",
    re.IGNORECASE,
)


def _issue_estimates_migration() -> str | None:
    """The text of K.2's migration, if K.2 has landed.

    Returns:
        The contents of the migration that creates ``issue_estimates``, or ``None`` while
        no migration does — which is the state until
        `#100 <https://github.com/NobuData/ouroboros/issues/100>`_ lands.
    """
    if not _MIGRATIONS.is_dir():
        return None

    for migration in sorted(_MIGRATIONS.glob("V*.sql")):
        text = migration.read_text(encoding="utf-8")
        if _CREATE_ISSUE_ESTIMATES.search(text):
            return text

    return None


# ---------------------------------------------------------------------------
# The response is one version of K.2's row
# ---------------------------------------------------------------------------


def test_the_response_carries_every_column_the_estimator_owns() -> None:
    assert set(Estimate.model_fields) == _carried(ESTIMATE_COLUMNS), (
        "the response and issue_estimates have drifted — either a field was added that "
        "no column stores, or a column the estimator owns is not answered with"
    )


def test_the_breakdown_is_the_jsonb_shape_exactly() -> None:
    assert set(Breakdown.model_fields) == _carried(BREAKDOWN_KEYS)


def test_the_trace_is_the_jsonb_shape_minus_the_clock() -> None:
    assert set(Trace.model_fields) == _carried(TRACE_KEYS)


def test_the_estimator_does_not_report_when_it_was_sized() -> None:
    # `sized_at` is the row writer's. An estimator with a clock in its answer is two
    # services that can disagree about when something happened.
    assert "sized_at" not in Trace.model_fields
    assert TRACE_KEYS["sized_at"] is None


@pytest.mark.parametrize("column", sorted(_carried(ESTIMATE_COLUMNS)))
def test_each_carried_column_is_named_the_same_on_both_sides(column: str) -> None:
    # Named identically, not merely mapped: L.3 persists the parsed body, and a rename at
    # the boundary would be a translation table nobody remembers to update.
    assert ESTIMATE_COLUMNS[column] == column


def test_every_response_field_is_required() -> None:
    # K.2 stores all of them and the panel renders all of them, so an optional field would
    # be a column that is sometimes null for no reason a reader could work out.
    optional = [
        name for name, spec in Estimate.model_fields.items() if not spec.is_required()
    ]

    assert optional == []


# ---------------------------------------------------------------------------
# The closed vocabularies
# ---------------------------------------------------------------------------


def test_the_effort_vocabulary_is_the_one_the_database_checks() -> None:
    assert EFFORTS == K2_EFFORTS


def test_the_risk_vocabulary_is_the_one_the_database_checks() -> None:
    assert RISKS == K2_RISKS


@pytest.mark.parametrize("effort", K2_EFFORTS)
def test_every_effort_the_database_accepts_is_one_the_contract_can_answer(
    effort: str, mockup_estimate: Estimate
) -> None:
    assert mockup_estimate.model_copy(update={"effort": effort}).effort == effort


@pytest.mark.parametrize("risk", K2_RISKS)
def test_every_risk_the_database_accepts_is_one_the_contract_can_answer(
    risk: str, mockup_estimate: Estimate
) -> None:
    assert mockup_estimate.model_copy(update={"risk": risk}).risk == risk


@pytest.mark.parametrize("effort", ["", "xxl", "M", "medium", "unknown"])
def test_an_effort_outside_the_vocabulary_is_refused(
    effort: str, mockup_estimate: Estimate
) -> None:
    # The CHECK constraint would refuse it too, three hops later — after it had been
    # logged, measured and returned to the gateway.
    with pytest.raises(ValidationError, match="effort"):
        Estimate.model_validate(mockup_estimate.model_dump() | {"effort": effort})


@pytest.mark.parametrize("risk", ["", "none", "LOW", "critical"])
def test_a_risk_outside_the_vocabulary_is_refused(
    risk: str, mockup_estimate: Estimate
) -> None:
    with pytest.raises(ValidationError, match="risk"):
        Estimate.model_validate(mockup_estimate.model_dump() | {"risk": risk})


# ---------------------------------------------------------------------------
# The bounds K.2 enforces, enforced here too
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("confidence", [MIN_CONFIDENCE, 50, MAX_CONFIDENCE])
def test_confidence_spans_the_whole_percentage(
    confidence: int, mockup_estimate: Estimate
) -> None:
    assert (
        Estimate.model_validate(
            mockup_estimate.model_dump() | {"confidence": confidence}
        ).confidence
        == confidence
    )


@pytest.mark.parametrize("confidence", [-1, 101, 1_000])
def test_confidence_outside_the_percentage_is_refused(
    confidence: int, mockup_estimate: Estimate
) -> None:
    with pytest.raises(ValidationError, match="confidence"):
        Estimate.model_validate(
            mockup_estimate.model_dump() | {"confidence": confidence}
        )


def test_provenance_is_required_at_the_contract_and_not_only_at_the_column() -> None:
    # Decision K10. `not null` catches this at the last hop; two hops earlier it has
    # already been logged and returned.
    with pytest.raises(ValidationError, match="estimator"):
        Trace(tokens_used=0, signals=[])


@pytest.mark.parametrize("estimator", ["", "   x" * 100])
def test_provenance_that_is_empty_or_absurd_is_refused(estimator: str) -> None:
    with pytest.raises(ValidationError, match="estimator"):
        Trace(estimator=estimator, tokens_used=0, signals=[])


def test_a_risk_level_without_a_rationale_is_refused(mockup_estimate: Estimate) -> None:
    # The sentence under the meter is what a reviewer reads before overriding an
    # estimate. A level with no rationale is a colour nobody can argue with.
    with pytest.raises(ValidationError, match="risk_note"):
        Estimate.model_validate(mockup_estimate.model_dump() | {"risk_note": ""})


def test_a_cycle_range_that_runs_backwards_is_refused() -> None:
    with pytest.raises(ValidationError, match="cycle_min"):
        Breakdown(files=[], est_tokens=0, cycle_min=18, cycle_max=12, est_minutes=15)


def test_the_whole_job_estimate_is_not_confined_to_the_cycle_range() -> None:
    # K.2's own example: a 12-18 minute cycle beside 23 estimated minutes, because a job's
    # wall clock includes what happens either side of the model's part of it. A validator
    # tying the two together would have refused the ticket's own example.
    breakdown = Breakdown(
        files=[], est_tokens=0, cycle_min=12, cycle_max=18, est_minutes=23
    )

    assert breakdown.est_minutes > breakdown.cycle_max


def test_no_estimator_can_answer_with_a_field_the_row_has_no_column_for(
    mockup_estimate: Estimate,
) -> None:
    # The response is closed. /v0 does allow a field to be *added* — as an edit to the
    # model and to openapi.yaml together, not as something an implementation behind the
    # seam does at runtime and L.3 then has to drop.
    with pytest.raises(ValidationError, match="sized_by"):
        Estimate.model_validate(mockup_estimate.model_dump() | {"sized_by": "someone"})


# ---------------------------------------------------------------------------
# The other side of the drift check — live from the day K.2 lands
# ---------------------------------------------------------------------------


def test_the_migrations_of_the_sibling_module_are_reachable() -> None:
    # The other half of the drift check reads them. Asserted separately so a checkout
    # without ouroboros-db fails on the reason rather than on a comparison against nothing.
    assert _MIGRATIONS.is_dir(), (
        f"{_MIGRATIONS} is missing — this suite compares the contract against "
        "ouroboros-db's migrations, so it needs the sibling module in the checkout"
    )


def test_the_contract_agrees_with_k2s_row_once_that_migration_exists() -> None:
    # No skip and no `xfail`: the assertion this makes is different before and after K.2
    # lands, and both are real. Before, the tables above are K.2's specification and what
    # can be checked is that the contract matches them — which is every test above this
    # one. After, the migration is the other side of the comparison, and a column it
    # renames is a red build in this module on the day it lands.
    migration = _issue_estimates_migration()

    if migration is None:
        assert set(Estimate.model_fields) == _carried(ESTIMATE_COLUMNS), (
            "K.2 (#100) has not landed, so the tables in this module are its "
            "specification — and the contract has drifted from them"
        )
        return

    declared = dict(ESTIMATE_COLUMNS) | dict(BREAKDOWN_KEYS) | dict(TRACE_KEYS)
    missing = sorted(name for name in declared if name not in migration)

    assert missing == [], (
        f"issue_estimates does not mention {missing} — either the migration renamed "
        "them or this contract answers with fields nothing stores. Both are drift, and "
        "the fix is one edit to whichever of the two is wrong."
    )
