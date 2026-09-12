"""The conformance suite — *one schema*, the other half of the issue's headline.

``tests/test_workflows_parity.py`` holds the two validators to one recorded verdict. This file
holds *this* validator to the published contract: it compiles ``schemas/workflow-dsl/v1.json``
with ``jsonschema`` and asserts that the schema and the pydantic models classify every golden
document the same way. ``ouroboros-rest`` runs the same comparison with ``ajv`` against its zod
schemas, so the schema an outside reader is handed is the schema both services actually
enforce.

**What is compared, and what is deliberately not.** The verdict compared is the *schema
stage's*: valid or invalid against ``v1.json``. The structural rules are not in the schema and
are not meant to be — JSON Schema describes values, and *every node is reachable from the
trigger* is not a property of a value — so a document that is schema-clean and structurally
broken is *expected* to satisfy the schema, and the fixture set holds several. The second
assertion is about anchoring: every pointer the pydantic side reports has to be one the schema
reports an error at or under, which catches the drift that matters — a constraint one of them
has and the other does not.

The schema is not asked to agree on the *number* of errors. A conditional schema reports the
``if`` it failed as well as the failure inside it, and ``jsonschema`` and ``ajv`` differ in how
much of a ``oneOf``'s branch failures they surface — ``ajv`` flattens them into the error list
and ``jsonschema`` nests them under ``.context``. Those are artefacts of how a keyword
vocabulary composes, not differences of opinion about the document, so the comparison is
written to be indifferent to them.
"""

from typing import Any

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as SchemaValidationError

from ouroboros_engine.workflows.errors import SCHEMA_STAGE_CODES
from ouroboros_engine.workflows.validate import validate_workflow_document
from workflows_golden import CASES, ExpectedCase, read_fixture, read_schema

#: Keywords whose errors restate the dispatch rather than describe the value.
#:
#: ``if`` and ``allOf`` are the scaffolding the per-type and per-kind config schemas are
#: selected with, so their failures say *this branch was chosen and it did not hold* — which
#: the failure inside the branch already says, at the value. ``oneOf`` is deliberately **not**
#: here: the DSL uses it once, for a model stage's routing, and there the failure genuinely is
#: about the object — *exactly one of these two* is a property of ``routing`` and of nothing
#: inside it.
COMPOSITION_KEYWORDS = frozenset({"if", "allOf"})

SCHEMA = read_schema()
VALIDATOR = Draft202012Validator(SCHEMA)


def _pointer(path: Any) -> str:
    """An error's instance location as an RFC 6901 pointer."""
    return "".join(
        f"/{str(segment).replace('~', '~0').replace('/', '~1')}" for segment in path
    )


def _pointers(error: SchemaValidationError) -> set[str]:
    """The pointers to the *values* one schema error is about.

    ``required`` and the two additional-property keywords are anchored by the schema at the
    parent object and name the property in the message; the DSL's diagnostics anchor at the
    property itself, because that is what a canvas selects. Deriving the property names here is
    what lets the two be compared at all.

    Args:
        error: One error from :meth:`jsonschema.protocols.Validator.iter_errors`.

    Returns:
        One or more pointers.
    """
    base = _pointer(error.absolute_path)

    if error.validator == "required" and isinstance(error.instance, dict):
        missing = set(error.validator_value) - set(error.instance)
        return {f"{base}/{name}" for name in missing} or {base}

    if error.validator in {
        "additionalProperties",
        "unevaluatedProperties",
    } and isinstance(error.instance, dict):
        declared = (
            set(error.schema.get("properties", {}))
            if isinstance(error.schema, dict)
            else set()
        )
        extra = set(error.instance) - declared
        return {f"{base}/{name}" for name in extra} or {base}

    return {base}


def test_the_published_schema_is_a_valid_2020_12_document() -> None:
    # `check_schema` is the point of compiling it here: it refuses a schema with a keyword that
    # does not exist or a `$ref` that resolves to nothing — two of the ways a hand-written
    # schema is subtly not the document its author read.
    Draft202012Validator.check_schema(SCHEMA)


def test_the_schema_carries_the_id_the_dsl_is_published_under() -> None:
    # The `$id` is the name every consumer quotes; changing it is changing the contract's
    # identity, which is a new file rather than an edit to this one.
    assert SCHEMA["$id"] == "https://ouroboros.build/schemas/workflow-dsl/v1.json"
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_schema_and_the_models_classify_the_document_alike(
    case: ExpectedCase,
) -> None:
    document = read_fixture(case.document)
    verdict = validate_workflow_document(document)

    schema_clean = all(
        diagnostic.code not in SCHEMA_STAGE_CODES for diagnostic in verdict.errors
    )

    assert VALIDATOR.is_valid(document) is schema_clean


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_models_anchor_where_the_schema_anchors(case: ExpectedCase) -> None:
    document = read_fixture(case.document)
    if VALIDATOR.is_valid(document):
        return

    from_schema: set[str] = set()
    for error in VALIDATOR.iter_errors(document):
        if error.validator in COMPOSITION_KEYWORDS:
            continue
        from_schema |= _pointers(error)

    for diagnostic in validate_workflow_document(document).errors:
        if diagnostic.code not in SCHEMA_STAGE_CODES:
            continue
        assert any(
            candidate == diagnostic.path
            or candidate.startswith(f"{diagnostic.path}/")
            or diagnostic.path.startswith(f"{candidate}/")
            for candidate in from_schema
        ), f"{diagnostic.code} at {diagnostic.path} is anchored nowhere the schema is"
