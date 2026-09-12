"""pydantic's error types, translated into the DSL's vocabulary.

The translation is asserted through real pydantic failures rather than hand-built error dicts:
what this file is about is which of pydantic's types mean which of ours, and an error this suite
wrote itself would prove only that the table has the entry it has.

The TypeScript side asserts the same pairings through real zod failures
(``dsl.issues.spec.ts``). Between the two files, every code in the vocabulary has been produced
by both libraries from the same kind of mistake — which is what makes
``fixtures/expected.json`` a recording of the *rules* rather than of two coincidences.
"""

from typing import Annotated, Literal

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ouroboros_engine.workflows.errors import DslErrorCode
from ouroboros_engine.workflows.issues import (
    code_for,
    diagnostics_from_validation_error,
)


class Sample(BaseModel):
    """A model with one field per constraint the DSL uses."""

    model_config = ConfigDict(extra="forbid", strict=True)

    title: str
    kind: Literal["a", "b"]
    retries: int = Field(ge=0, le=10)
    names: Annotated[list[str], Field(min_length=1)]
    slug: str = Field(pattern=r"^[a-z]+$")


def translate(value: object, base: tuple[str | int, ...] = ()) -> list:
    """Run the model over a value and translate whatever it says."""
    try:
        Sample.model_validate(value)
    except ValidationError as exc:
        return diagnostics_from_validation_error(exc, base)
    raise AssertionError("expected the model to reject this value")


VALID = {"title": "t", "kind": "a", "retries": 1, "names": ["x"], "slug": "abc"}


def test_an_absent_property_is_required_not_a_type_mismatch() -> None:
    diagnostics = translate(
        {key: value for key, value in VALID.items() if key != "title"}
    )
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_REQUIRED, "/title")
    ]


def test_a_present_value_of_the_wrong_type_is_a_type_mismatch() -> None:
    diagnostics = translate({**VALID, "title": 7})
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_TYPE, "/title")
    ]


def test_a_value_outside_a_closed_vocabulary_is_an_enum_failure() -> None:
    diagnostics = translate({**VALID, "kind": "c"})
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_ENUM, "/kind")
    ]


def test_an_absent_enum_member_is_required_rather_than_an_enum_failure() -> None:
    # zod needs a value lookup to tell these apart; pydantic distinguishes them itself, which is
    # why the two agree without either side being taught the other's quirk.
    diagnostics = translate(
        {key: value for key, value in VALID.items() if key != "kind"}
    )
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_REQUIRED, "/kind")
    ]


def test_a_number_out_of_bounds_and_a_collection_of_the_wrong_size_are_different() -> (
    None
):
    diagnostics = translate({**VALID, "retries": 99, "names": []})
    assert sorted((d.code, d.path) for d in diagnostics) == [
        (DslErrorCode.SCHEMA_LENGTH, "/names"),
        (DslErrorCode.SCHEMA_RANGE, "/retries"),
    ]


def test_a_number_below_its_minimum_is_a_range_failure_too() -> None:
    diagnostics = translate({**VALID, "retries": -1})
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_RANGE, "/retries")
    ]


def test_a_string_that_fails_its_pattern_is_a_pattern_failure() -> None:
    diagnostics = translate({**VALID, "slug": "Not A Slug"})
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_PATTERN, "/slug")
    ]


def test_an_undeclared_property_is_named_and_anchored_at_itself() -> None:
    diagnostics = translate({**VALID, "colour": "green"})
    assert [(d.code, d.path) for d in diagnostics] == [
        (DslErrorCode.SCHEMA_UNKNOWN_PROPERTY, "/colour")
    ]
    assert "colour" in diagnostics[0].message


def test_every_path_is_prefixed_with_where_the_value_lives() -> None:
    diagnostics = translate({**VALID, "title": 7}, ("nodes", 3, "config"))
    assert diagnostics[0].path == "/nodes/3/config/title"


def test_the_anchor_is_attached_to_every_diagnostic() -> None:
    with pytest.raises(ValidationError) as raised:
        Sample.model_validate({**VALID, "title": 7})
    diagnostics = diagnostics_from_validation_error(
        raised.value, ("nodes", 0, "config"), node="implement"
    )
    assert diagnostics[0].node == "implement"
    assert diagnostics[0].edge is None


@pytest.mark.parametrize(
    ("error_type", "expected"),
    [
        ("missing", DslErrorCode.SCHEMA_REQUIRED),
        ("extra_forbidden", DslErrorCode.SCHEMA_UNKNOWN_PROPERTY),
        ("literal_error", DslErrorCode.SCHEMA_ENUM),
        ("enum", DslErrorCode.SCHEMA_ENUM),
        ("string_pattern_mismatch", DslErrorCode.SCHEMA_PATTERN),
        ("greater_than_equal", DslErrorCode.SCHEMA_RANGE),
        ("less_than_equal", DslErrorCode.SCHEMA_RANGE),
        ("too_short", DslErrorCode.SCHEMA_LENGTH),
        ("too_long", DslErrorCode.SCHEMA_LENGTH),
        ("string_too_short", DslErrorCode.SCHEMA_LENGTH),
        ("string_too_long", DslErrorCode.SCHEMA_LENGTH),
        ("string_type", DslErrorCode.SCHEMA_TYPE),
        ("int_type", DslErrorCode.SCHEMA_TYPE),
        ("float_type", DslErrorCode.SCHEMA_TYPE),
        ("bool_type", DslErrorCode.SCHEMA_TYPE),
        ("dict_type", DslErrorCode.SCHEMA_TYPE),
        ("list_type", DslErrorCode.SCHEMA_TYPE),
        ("model_attributes_type", DslErrorCode.SCHEMA_TYPE),
    ],
)
def test_the_table_classifies_every_type_the_dsl_can_produce(
    error_type: str, expected: str
) -> None:
    assert code_for(error_type) == expected


def test_an_error_type_the_table_does_not_know_degrades_rather_than_raising() -> None:
    # A pydantic release that adds an error kind should make a diagnostic slightly less
    # specific, not turn a validation into a 500. The conformance and parity suites are what
    # would report that the new kind needs a code of its own.
    assert code_for("some_future_pydantic_error") == DslErrorCode.SCHEMA_TYPE
