"""The parity suite — this service's half of the issue's *CI parity test*.

``schemas/workflow-dsl/fixtures/expected.json`` records one case per rule and the verdict every
validator of this language has to produce for it. This file asserts that the pydantic validator
produces it; ``ouroboros-rest``'s ``dsl.parity.spec.ts`` asserts the same of the zod one,
against the same file. Neither module imports the other and no third process compares two
outputs — a rule added to one and forgotten in the other is simply a red check in the half that
forgot it.

The recording is the contract, so this suite also asserts things *about the recording*: that
every fixture on disk is in it, and that every code the validator can emit is exercised by it.
A golden file that has quietly stopped covering a rule is a golden file that passes everything.
"""

from typing import Any

import pytest

from ouroboros_engine.workflows.errors import DslErrorCode, DslWarningCode
from ouroboros_engine.workflows.validate import validate_workflow_document
from workflows_golden import (
    CASES,
    FIXTURES_DIR,
    ExpectedCase,
    catalogue_for,
    read_fixture,
    recorded,
)


def _run(case: ExpectedCase) -> dict[str, Any]:
    """Validate one recorded case and reduce the verdict to the contract."""
    verdict = validate_workflow_document(
        read_fixture(case.document), catalogue_for(case)
    )
    return {
        "valid": verdict.valid,
        "errors": [recorded(diagnostic) for diagnostic in verdict.errors],
        "warnings": [recorded(diagnostic) for diagnostic in verdict.warnings],
    }


def _declared_codes() -> set[str]:
    """Every code either vocabulary declares."""
    return {
        value
        for holder in (DslErrorCode, DslWarningCode)
        for name, value in vars(holder).items()
        if not name.startswith("_") and isinstance(value, str)
    }


def test_every_case_is_named_once() -> None:
    names = [case.name for case in CASES]
    assert len(set(names)) == len(names)


def test_every_fixture_document_on_disk_is_covered() -> None:
    # A fixture nobody asserts against is a fixture that proves nothing, and the way one gets
    # there is being added in the same change as the rule it was written for and forgotten in
    # expected.json.
    on_disk = {
        f"{directory}/{path.name}"
        for directory in ("valid", "invalid")
        for path in (FIXTURES_DIR / directory).iterdir()
    }
    assert on_disk == {case.document for case in CASES}


def test_every_code_the_validator_can_emit_is_exercised() -> None:
    # The other direction of the same argument: a code with no case behind it is a rule whose
    # anchoring nobody has ever looked at.
    exercised = {
        diagnostic["code"]
        for case in CASES
        for diagnostic in (*case.errors, *case.warnings)
    }
    assert _declared_codes() - exercised == set()


def test_every_case_says_why_it_is_in_the_set() -> None:
    for case in CASES:
        assert case.about


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_verdict_is_the_one_recorded(case: ExpectedCase) -> None:
    assert _run(case) == {
        "valid": case.valid,
        "errors": list(case.errors),
        "warnings": list(case.warnings),
    }


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_every_diagnostic_renders_a_sentence(case: ExpectedCase) -> None:
    # The message is not part of the parity contract — each validator writes its own — so this
    # is the assertion that keeps the exemption from becoming an excuse for none.
    verdict = validate_workflow_document(
        read_fixture(case.document), catalogue_for(case)
    )
    for diagnostic in (*verdict.errors, *verdict.warnings):
        assert diagnostic.message.strip()


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_the_wire_payload_carries_the_anchors_and_omits_the_absent_ones(
    case: ExpectedCase,
) -> None:
    verdict = validate_workflow_document(
        read_fixture(case.document), catalogue_for(case)
    )
    payload = verdict.as_dict()
    assert payload["valid"] == case.valid
    assert len(payload["errors"]) == len(case.errors)
    for rendered, expected in zip(payload["errors"], case.errors, strict=True):
        assert rendered["code"] == expected["code"]
        assert rendered["path"] == expected["path"]
        assert rendered.get("node") == expected.get("node")
        assert rendered.get("edge") == expected.get("edge")
        assert "node" in rendered or "node" not in expected
