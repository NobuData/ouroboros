"""The predicate evaluator — every kind, both outcomes, and the trigger read through the same rules.

One evaluator is why P.2 made the predicate grammar flat and shared (#133), so the strongest
assertions here are the equivalence ones at the bottom: a trigger condition and the predicate it
means give the same answer for every input there is, which is what stops the two from drifting.
"""

from typing import get_args

import pytest
from pydantic import BaseModel

from ouroboros_engine.workflows.contract import DryRunTicket
from ouroboros_engine.workflows.dsl import (
    PREDICATE_MODELS,
    AlwaysPredicate,
    ChecksPredicate,
    EffortPredicate,
    LabelsPredicate,
    SourcePredicate,
    Trigger,
)
from ouroboros_engine.workflows.predicates import (
    EFFORT_ORDER,
    EFFORT_SYMBOLS,
    Evaluation,
    describe_predicate,
    describe_trigger,
    evaluate_predicate,
    evaluate_trigger,
)


def _ticket(
    effort: str | None = "m",
    labels: tuple[str, ...] = ("bug", "i2c"),
    source: str = "github",
) -> DryRunTicket:
    """A ticket keyed ``#485``, with whatever a test varies."""
    return DryRunTicket.model_validate(
        {
            "external_key": "#485",
            "source": source,
            "labels": list(labels),
            "estimate": None if effort is None else {"effort": effort},
        }
    )


def _trigger(**conditions: object) -> Trigger:
    """A ``ticket_queued`` trigger with the given conditions."""
    return Trigger.model_validate({"event": "ticket_queued", "conditions": conditions})


def _predicate(**fields: object) -> BaseModel:
    """A predicate, dispatched on its ``kind`` the way the validator dispatches one."""
    return PREDICATE_MODELS[str(fields["kind"])].model_validate(fields)


class _Stranger(BaseModel):
    """A model that is not one of the DSL's predicates."""

    kind: str = "stranger"


# ---------------------------------------------------------------------------
# Effort
# ---------------------------------------------------------------------------


def test_efforts_are_ordered_smallest_first() -> None:
    assert EFFORT_ORDER == ("xs", "s", "m", "l", "xl")


def test_every_effort_comparison_the_dsl_allows_has_a_symbol() -> None:
    operators = get_args(EffortPredicate.model_fields["op"].annotation)

    assert set(EFFORT_SYMBOLS) == set(operators)


@pytest.mark.parametrize(
    ("op", "value", "effort", "holds"),
    [
        ("lt", "m", "s", True),
        ("lt", "m", "m", False),
        ("lte", "m", "m", True),
        ("lte", "m", "l", False),
        ("eq", "m", "m", True),
        ("eq", "m", "xl", False),
        ("gte", "m", "m", True),
        ("gte", "m", "xs", False),
        ("gt", "m", "l", True),
        ("gt", "m", "m", False),
    ],
)
def test_an_effort_predicate_compares_positions_in_the_vocabulary(
    op: str, value: str, effort: str, holds: bool
) -> None:
    predicate = _predicate(kind="effort", op=op, value=value)

    evaluation = evaluate_predicate(predicate, _ticket(effort))

    assert evaluation.holds is holds
    assert evaluation.assumed is False


def test_an_effort_explanation_names_the_ticket_and_the_relation() -> None:
    ticket = _ticket("m")

    holds = evaluate_predicate(_predicate(kind="effort", op="lte", value="m"), ticket)
    fails = evaluate_predicate(_predicate(kind="effort", op="gt", value="m"), ticket)

    assert holds.sentence() == "#485 is effort M, and M ≤ M."
    assert fails.sentence() == "#485 is effort M, and M is not > M."


@pytest.mark.parametrize("op", sorted(EFFORT_SYMBOLS))
def test_an_unsized_ticket_satisfies_no_effort_comparison(op: str) -> None:
    # Unsized is not smaller than `xs`: it is unknown, so even `gte xs` does not hold.
    predicate = _predicate(kind="effort", op=op, value="xs")

    evaluation = evaluate_predicate(predicate, _ticket(None))

    assert evaluation.holds is False
    assert evaluation.clause == (
        f"#485 has no estimate, so effort {EFFORT_SYMBOLS[op]} XS cannot hold"
    )


# ---------------------------------------------------------------------------
# Labels, source, checks, always
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("op", "values", "holds", "clause"),
    [
        (
            "any",
            ["docs", "i2c"],
            True,
            "#485 carries `i2c`, and any of `docs`, `i2c` will do",
        ),
        ("any", ["docs"], False, "#485 carries none of `docs`"),
        ("all", ["bug", "i2c"], True, "#485 carries every one of `bug`, `i2c`"),
        (
            "all",
            ["bug", "docs"],
            False,
            "#485 lacks `docs`, and every one of `bug`, `docs` is required",
        ),
        ("none", ["docs"], True, "#485 carries none of `docs`"),
        (
            "none",
            ["docs", "bug"],
            False,
            "#485 carries `bug`, and none of `docs`, `bug` may be present",
        ),
    ],
)
def test_a_labels_predicate_names_the_labels_that_decided_it(
    op: str, values: list[str], holds: bool, clause: str
) -> None:
    predicate = _predicate(kind="labels", op=op, values=values)

    evaluation = evaluate_predicate(predicate, _ticket(labels=("bug", "i2c")))

    assert (evaluation.holds, evaluation.clause) == (holds, clause)


def test_labels_compare_exactly_as_the_tracker_spells_them() -> None:
    predicate = _predicate(kind="labels", op="any", values=["Bug"])

    assert evaluate_predicate(predicate, _ticket(labels=("bug",))).holds is False


@pytest.mark.parametrize(
    ("op", "values", "holds", "clause"),
    [
        ("in", ["github"], True, "#485 comes from `github`"),
        (
            "in",
            ["jira", "linear"],
            False,
            "#485 comes from `github`, not one of `jira`, `linear`",
        ),
        ("not_in", ["jira"], True, "#485 comes from `github`, none of `jira`"),
        (
            "not_in",
            ["github", "jira"],
            False,
            "#485 comes from `github`, which is excluded",
        ),
    ],
)
def test_a_source_predicate_tests_the_tracker_the_ticket_came_from(
    op: str, values: list[str], holds: bool, clause: str
) -> None:
    predicate = _predicate(kind="source", op=op, values=values)

    evaluation = evaluate_predicate(predicate, _ticket(source="github"))

    assert (evaluation.holds, evaluation.clause) == (holds, clause)


@pytest.mark.parametrize(
    ("op", "names", "holds", "clause"),
    [
        (
            "all_passed",
            None,
            True,
            "a dry run has no check results, so it assumes every check passes",
        ),
        (
            "all_passed",
            ["build", "test"],
            True,
            "a dry run has no check results, so it assumes `build`, `test` all pass",
        ),
        (
            "any_failed",
            None,
            False,
            "a dry run has no check results, so it assumes no check fails",
        ),
        (
            "any_failed",
            ["build"],
            False,
            "a dry run has no check results, so it assumes none of `build` fails",
        ),
    ],
)
def test_a_checks_predicate_is_the_green_path_and_says_it_is_an_assumption(
    op: str, names: list[str] | None, holds: bool, clause: str
) -> None:
    fields: dict[str, object] = {"kind": "checks", "op": op}
    if names is not None:
        fields["names"] = names

    evaluation = evaluate_predicate(_predicate(**fields), _ticket())

    assert (evaluation.holds, evaluation.assumed, evaluation.clause) == (
        holds,
        True,
        clause,
    )


def test_an_always_predicate_holds() -> None:
    evaluation = evaluate_predicate(AlwaysPredicate(kind="always"), _ticket(None))

    assert evaluation == Evaluation(
        holds=True, assumed=False, clause="the condition always holds"
    )


@pytest.mark.parametrize(
    "predicate",
    [
        AlwaysPredicate(kind="always"),
        EffortPredicate(kind="effort", op="eq", value="m"),
        LabelsPredicate(kind="labels", op="any", values=["bug"]),
        SourcePredicate(kind="source", op="in", values=["github"]),
    ],
    ids=lambda predicate: predicate.kind,
)
def test_only_a_checks_predicate_is_ever_an_assumption(predicate: BaseModel) -> None:
    assert evaluate_predicate(predicate, _ticket()).assumed is False


def test_a_model_that_is_not_a_predicate_is_refused_rather_than_guessed_at() -> None:
    with pytest.raises(TypeError, match="_Stranger is not a workflow predicate"):
        evaluate_predicate(_Stranger(), _ticket())
    with pytest.raises(TypeError, match="_Stranger is not a workflow predicate"):
        describe_predicate(_Stranger())


def test_an_evaluation_renders_as_a_sentence_and_as_the_wire_model() -> None:
    evaluation = Evaluation(
        holds=False, assumed=True, clause="a dry run has no check results"
    )

    assert evaluation.sentence() == "A dry run has no check results."
    assert evaluation.as_model().model_dump() == {
        "holds": False,
        "assumed": True,
        "explanation": "A dry run has no check results.",
    }


# ---------------------------------------------------------------------------
# The trigger
# ---------------------------------------------------------------------------


def test_a_trigger_with_no_conditions_fires_for_every_ticket() -> None:
    evaluation = evaluate_trigger(_trigger(), _ticket(None, labels=()))

    assert evaluation.holds is True
    assert evaluation.sentence() == (
        "The trigger has no conditions, so it fires for #485 as for every queued ticket."
    )


def test_a_trigger_fires_when_every_condition_holds_and_says_why() -> None:
    trigger = _trigger(effort_lte="l", labels=["bug"], source="github")

    evaluation = evaluate_trigger(trigger, _ticket("m"))

    assert evaluation.holds is True
    assert evaluation.clause == (
        "the trigger fires for #485: #485 is effort M, and M ≤ L; "
        "#485 carries every one of `bug`; #485 comes from `github`"
    )


def test_a_trigger_that_does_not_fire_names_only_the_conditions_that_failed() -> None:
    trigger = _trigger(effort_lte="s", labels=["bug"], source="jira")

    evaluation = evaluate_trigger(trigger, _ticket("m"))

    assert evaluation.holds is False
    assert evaluation.clause == (
        "the trigger does not fire for #485: #485 is effort M, and M is not ≤ S; "
        "#485 comes from `github`, not one of `jira`"
    )


def test_an_unsized_ticket_does_not_fire_an_effort_trigger() -> None:
    evaluation = evaluate_trigger(_trigger(effort_lte="xl"), _ticket(None))

    assert evaluation.holds is False
    assert "#485 has no estimate" in evaluation.clause


@pytest.mark.parametrize("wanted", EFFORT_ORDER)
@pytest.mark.parametrize("actual", [*EFFORT_ORDER, None])
def test_an_effort_condition_reads_exactly_as_the_predicate_it_means(
    wanted: str, actual: str | None
) -> None:
    ticket = _ticket(actual)
    predicate = _predicate(kind="effort", op="lte", value=wanted)

    assert (
        evaluate_trigger(_trigger(effort_lte=wanted), ticket).holds
        is evaluate_predicate(predicate, ticket).holds
    )


@pytest.mark.parametrize("labels", [["bug"], ["bug", "i2c"], ["bug", "docs"], ["docs"]])
def test_a_labels_condition_reads_exactly_as_an_all_labels_predicate(
    labels: list[str],
) -> None:
    ticket = _ticket(labels=("bug", "i2c"))
    predicate = _predicate(kind="labels", op="all", values=labels)

    assert (
        evaluate_trigger(_trigger(labels=labels), ticket).holds
        is evaluate_predicate(predicate, ticket).holds
    )


@pytest.mark.parametrize("source", ["github", "gitlab", "jira", "linear"])
def test_a_source_condition_reads_exactly_as_a_source_in_predicate(source: str) -> None:
    ticket = _ticket(source="gitlab")
    predicate = _predicate(kind="source", op="in", values=[source])

    assert (
        evaluate_trigger(_trigger(source=source), ticket).holds
        is evaluate_predicate(predicate, ticket).holds
    )


# ---------------------------------------------------------------------------
# Describing without evaluating
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "phrase"),
    [
        ({"kind": "always"}, "nothing — the condition always holds"),
        ({"kind": "effort", "op": "gte", "value": "l"}, "effort ≥ L"),
        (
            {"kind": "labels", "op": "any", "values": ["bug", "i2c"]},
            "any of the labels `bug`, `i2c`",
        ),
        (
            {"kind": "labels", "op": "none", "values": ["docs"]},
            "none of the labels `docs`",
        ),
        (
            {"kind": "source", "op": "in", "values": ["github"]},
            "a source among `github`",
        ),
        (
            {"kind": "source", "op": "not_in", "values": ["jira"]},
            "a source other than `jira`",
        ),
        ({"kind": "checks", "op": "all_passed"}, "every check passing"),
        (
            {"kind": "checks", "op": "all_passed", "names": ["build"]},
            "the checks `build` all passing",
        ),
        ({"kind": "checks", "op": "any_failed"}, "a failing check"),
        (
            {"kind": "checks", "op": "any_failed", "names": ["test"]},
            "a failure among the checks `test`",
        ),
    ],
)
def test_a_predicate_describes_what_it_requires(
    fields: dict[str, object], phrase: str
) -> None:
    assert describe_predicate(_predicate(**fields)) == phrase


def test_a_trigger_describes_when_it_starts_a_run() -> None:
    assert describe_trigger(_trigger()) == "Starts a run whenever a ticket is queued."
    assert describe_trigger(
        _trigger(effort_lte="m", labels=["bug"], source="github")
    ) == (
        "Starts a run when a ticket is queued with effort ≤ M, all of the labels `bug`, "
        "source `github`."
    )


def test_the_checks_predicate_model_is_the_one_the_evaluator_dispatches() -> None:
    # The dispatch is by class, so a predicate model the DSL table names but the evaluator does
    # not match would fall through to the TypeError above. Every model the table holds is one it
    # answers.
    samples = {
        "always": {"kind": "always"},
        "effort": {"kind": "effort", "op": "eq", "value": "m"},
        "labels": {"kind": "labels", "op": "any", "values": ["bug"]},
        "source": {"kind": "source", "op": "in", "values": ["github"]},
        "checks": {"kind": "checks", "op": "all_passed"},
    }

    assert set(samples) == set(PREDICATE_MODELS)
    assert isinstance(_predicate(**samples["checks"]), ChecksPredicate)
    for fields in samples.values():
        assert evaluate_predicate(_predicate(**fields), _ticket()).clause
        assert describe_predicate(_predicate(**fields))
