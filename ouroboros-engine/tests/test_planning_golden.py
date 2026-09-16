"""The published contract, and this planner's agreement with it.

``schemas/plan/v0.json`` is what AL.1 and AN.1
(`#289 <https://github.com/NobuData/ouroboros/issues/289>`_) both answer, and
``schemas/plan/fixtures/expected.json`` records what *this* implementation answers for one
case per rule. The acceptance criterion this file exists for is the last one on the issue:
**the response shape is identical to what AN.1 will return, verified by a shared schema
fixture.** A sentence in a docstring could not have been checked; this can.

Three things are asserted, and the difference between them matters:

* the **shape** — every recorded response validates against the published schema, and the
  schema describes the same fields the pydantic models do. That is the half AN.1 inherits.
* the **values** — the installed planner reproduces every recorded batch byte for byte.
  That is *this* planner's, and AN.1 is expected to answer several of these cases
  differently — a real planner decomposing a narrative is the whole point of it.
* the **recording itself** — that it covers what it claims to, so a case quietly dropped is
  a failure rather than a suite that passes more easily.
"""

import json
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import BaseModel

from ouroboros_engine.planning.contract import (
    Draft,
    Plan,
    PlanningContext,
    PlanRequest,
)
from ouroboros_engine.planning.outline_planner import OUTLINE_PLANNER, OutlinePlanner
from planning_golden import CASES, PlanCase, read_schema

SCHEMA = read_schema()
VALIDATOR = Draft202012Validator(SCHEMA)
REQUEST_VALIDATOR = Draft202012Validator(
    {**SCHEMA["$defs"]["plan_request"], "$defs": SCHEMA["$defs"]}
)

#: Each pydantic model beside the schema that describes it. A model added to the contract
#: without a schema beside it fails the exhaustiveness check below rather than travelling
#: undescribed.
_DESCRIBED: dict[str, type[BaseModel]] = {
    "draft": Draft,
    "planning_context": PlanningContext,
    "plan_request": PlanRequest,
}


def _plan_for(case: PlanCase) -> dict[str, Any]:
    """Run the installed planner over one recorded request.

    Args:
        case: The recorded case.

    Returns:
        The batch, as JSON.
    """
    plan = OutlinePlanner().plan(PlanRequest.model_validate(case.request))
    return plan.model_dump(mode="json")


# ---------------------------------------------------------------------------
# The shape — the half AN.1 inherits
# ---------------------------------------------------------------------------


def test_the_published_schema_is_a_valid_json_schema() -> None:
    Draft202012Validator.check_schema(SCHEMA)


def test_the_schema_is_published_under_an_id_that_names_its_version() -> None:
    # A contract nobody can reference by URL is a file, not a published artifact.
    assert SCHEMA["$id"] == "https://ouroboros.build/schemas/plan/v0.json"


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_every_recorded_response_satisfies_the_published_schema(
    case: PlanCase,
) -> None:
    VALIDATOR.validate(case.response)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_every_recorded_request_satisfies_the_published_schema(
    case: PlanCase,
) -> None:
    REQUEST_VALIDATOR.validate(case.request)


def test_the_schema_root_is_the_response() -> None:
    # Deliberate: the response is the half both implementations must agree on letter for
    # letter, so it is what a reader validating an answer points at.
    assert set(SCHEMA["required"]) == set(Plan.model_fields)


@pytest.mark.parametrize("name", sorted(_DESCRIBED))
def test_a_described_schema_carries_the_fields_its_model_does(name: str) -> None:
    # Field names and requiredness, not the whole JSON Schema — the part that can silently
    # rot when a field is added to a model or removed from one.
    schema = SCHEMA["$defs"][name]
    fields = _DESCRIBED[name].model_fields

    assert set(schema["properties"]) == set(fields)
    assert set(schema["required"]) == {
        field for field, spec in fields.items() if spec.is_required()
    }


def test_the_response_schema_carries_the_fields_the_model_does() -> None:
    fields = Plan.model_fields

    assert set(SCHEMA["properties"]) == set(fields)
    assert set(SCHEMA["required"]) == {
        field for field, spec in fields.items() if spec.is_required()
    }


@pytest.mark.parametrize("name", sorted(_DESCRIBED))
def test_every_described_object_is_closed(name: str) -> None:
    assert SCHEMA["$defs"][name]["additionalProperties"] is False


def test_the_response_is_closed() -> None:
    assert SCHEMA["additionalProperties"] is False


def test_a_batch_the_contract_refuses_is_a_batch_the_schema_refuses() -> None:
    # The two are written by hand and could drift apart; this is the cheapest case that
    # would notice. A draft with no `body` is a shape the models require and the schema has
    # to require too, or a caller reading only the schema builds something the engine
    # rejects.
    incomplete = {
        "drafts": [
            {
                "local_key": "OTA-1",
                "title": "A drafted ticket",
                "suggested_workflow": "feature-loop",
                "dependencies": [],
            }
        ],
        "planner": OUTLINE_PLANNER,
        "notes": [],
    }

    assert not VALIDATOR.is_valid(incomplete)
    with pytest.raises(ValueError, match="body"):
        Plan.model_validate(incomplete)


# ---------------------------------------------------------------------------
# The values — what this planner answers today
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_planner_answers_every_recorded_case_exactly(case: PlanCase) -> None:
    assert _plan_for(case) == case.response, (
        f"{case.name} drifted from schemas/plan/fixtures/expected.json — the recording "
        "is reviewed and frozen, so this is a change to the contract or a bug"
    )


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_every_recorded_batch_is_answered_identically_twice(case: PlanCase) -> None:
    # Determinism over the whole recorded set, through the model's own serialisation: the
    # same input is the same bytes, local keys and note order included.
    request = PlanRequest.model_validate(case.request)

    first = OutlinePlanner().plan(request).model_dump_json()
    second = OutlinePlanner().plan(request).model_dump_json()

    assert first == second


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_provenance_is_recorded_on_every_case(case: PlanCase) -> None:
    # Decision K10, in the recording as well as in the code: a case whose provenance was
    # absent or guessed would let a planner ship without saying what it was.
    assert case.response["planner"] == OUTLINE_PLANNER


# ---------------------------------------------------------------------------
# The recording itself
# ---------------------------------------------------------------------------


def test_every_case_is_named_once() -> None:
    names = [case.name for case in CASES]

    assert len(set(names)) == len(names)


def test_every_case_says_why_it_is_there() -> None:
    # The recording is reviewed rather than regenerated, and a case nobody can read the
    # purpose of is one a reviewer will wave through.
    for case in CASES:
        assert case.about.strip(), f"{case.name} carries no `about`"


def test_the_headline_cases_are_present() -> None:
    # The two the issue's acceptance criteria name by hand: the mockup's outline, and the
    # degradation that must not become an invention.
    assert {"ota-outline", "narrative-only"} <= {case.name for case in CASES}


def test_the_recording_is_formatted_the_way_it_is_committed() -> None:
    # It is a reviewed file, so how it is written is part of what has to stay reviewable —
    # the same rule openapi.json is held to.
    from planning_golden import FIXTURES_PATH

    text = FIXTURES_PATH.read_text(encoding="utf-8")
    parsed = json.loads(text)

    assert text == json.dumps(parsed, indent=2, ensure_ascii=False) + "\n"
