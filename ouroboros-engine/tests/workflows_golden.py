"""The golden fixture set, read from the repository.

``schemas/workflow-dsl/`` holds the published JSON Schema, one document per rule, and
``fixtures/expected.json`` — the verdict every validator of this DSL has to produce for each of
them. The files live above both modules because neither owns them: this service's pydantic
validator and ``ouroboros-rest``'s zod validator each read the same directory, from their own
suite, and assert against the same recording. That is the issue's *CI parity test*, and it
holds without either module importing the other or a third process comparing two outputs.

A plain module rather than fixtures in ``conftest.py``, because the cases are read at
*collection* time — ``@pytest.mark.parametrize`` needs the list before any fixture could run —
and because two suites read them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from ouroboros_engine.workflows.references import Catalogue

#: Where the shared contract lives, resolved from this file rather than from the cwd.
SCHEMAS_DIR: Final[Path] = (
    Path(__file__).resolve().parents[2] / "schemas" / "workflow-dsl"
)

#: The committed JSON Schema's path.
SCHEMA_PATH: Final[Path] = SCHEMAS_DIR / "v1.json"

#: Where the fixtures live.
FIXTURES_DIR: Final[Path] = SCHEMAS_DIR / "fixtures"


@dataclass(frozen=True, slots=True)
class ExpectedCase:
    """One recorded case: a document, what it is validated with, and the verdict it must get."""

    #: The case name — unique, and what a failing assertion names.
    name: str
    #: Why this document is in the set. One sentence, read by a person reviewing a change.
    about: str
    #: The document's path under ``fixtures/``.
    document: str
    #: Whether the document may be saved and published.
    valid: bool
    #: Every error, in document order, as ``code``/``path``/``node``/``edge``.
    errors: tuple[dict[str, Any], ...]
    #: Every warning, in document order.
    warnings: tuple[dict[str, Any], ...]
    #: The catalogue's path under ``fixtures/``, when the case supplies one.
    catalogue: str | None = None


def read_fixture(relative_path: str) -> Any:
    """Read and parse a file under ``fixtures/``.

    Args:
        relative_path: The path under ``fixtures/``, as ``expected.json`` spells it.

    Returns:
        The parsed JSON.
    """
    return json.loads((FIXTURES_DIR / relative_path).read_text(encoding="utf-8"))


def read_schema() -> dict[str, Any]:
    """Read the committed JSON Schema.

    Returns:
        The parsed schema document.
    """
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def read_cases() -> tuple[ExpectedCase, ...]:
    """Read every recorded case, in the order ``expected.json`` lists them.

    Returns:
        The cases.
    """
    recorded = read_fixture("expected.json")
    return tuple(
        ExpectedCase(
            name=case["name"],
            about=case["about"],
            document=case["document"],
            valid=case["valid"],
            errors=tuple(case["errors"]),
            warnings=tuple(case["warnings"]),
            catalogue=case.get("catalogue"),
        )
        for case in recorded["cases"]
    )


def catalogue_for(case: ExpectedCase) -> Catalogue | None:
    """Build the catalogue a case validates against.

    Args:
        case: The recorded case.

    Returns:
        The catalogue, or ``None`` when the case supplies none — which is decision **P7**'s
        honest answer to *is this reference known?* when nothing in the system knows.
    """
    if case.catalogue is None:
        return None
    return Catalogue(**read_fixture(case.catalogue))


def recorded(diagnostic: Any) -> dict[str, Any]:
    """Reduce a diagnostic to the part the two validators contract over.

    The message is deliberately absent: each validator writes its own prose, and a contract
    over English sentences is one nobody can translate.

    Args:
        diagnostic: An :class:`ouroboros_engine.workflows.errors.Diagnostic`.

    Returns:
        Its ``code``, ``path`` and whichever graph anchor it carries.
    """
    entry: dict[str, Any] = {"code": diagnostic.code, "path": diagnostic.path}
    if diagnostic.node is not None:
        entry["node"] = diagnostic.node
    if diagnostic.edge is not None:
        entry["edge"] = diagnostic.edge.as_dict()
    return entry


#: Every recorded case, read once at import.
CASES: Final[tuple[ExpectedCase, ...]] = read_cases()
