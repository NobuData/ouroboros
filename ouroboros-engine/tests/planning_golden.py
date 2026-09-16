"""The recorded plan contract, read from the repository.

``schemas/plan/`` holds the published JSON Schema for ``POST /v0/plan`` and one recorded
case per rule the planner answers by. The files live above this module because this module
is not their only reader: AN.1 (`#289 <https://github.com/NobuData/ouroboros/issues/289>`_)
implements the *same* contract with a real planner, and AL.4
(`#280 <https://github.com/NobuData/ouroboros/issues/280>`_) persists what comes back — so
the shape is published once rather than asserted three times from memory.

A plain module rather than fixtures in ``conftest.py``, for the reason
:mod:`tests.workflows_golden` is one: the cases are read at *collection* time, because
``@pytest.mark.parametrize`` needs the list before any fixture could run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

#: Where the shared contract lives, resolved from this file rather than from the cwd.
SCHEMAS_DIR: Final[Path] = Path(__file__).resolve().parents[2] / "schemas" / "plan"

#: The committed JSON Schema's path.
SCHEMA_PATH: Final[Path] = SCHEMAS_DIR / "v0.json"

#: Where the recorded cases live.
FIXTURES_PATH: Final[Path] = SCHEMAS_DIR / "fixtures" / "expected.json"


@dataclass(frozen=True, slots=True)
class PlanCase:
    """One recorded case: a request, and the batch the planner has to answer it with."""

    #: The case name — unique, and what a failing assertion names.
    name: str
    #: Why this case is in the set. One sentence, read by a person reviewing a change.
    about: str
    #: The request body, exactly as a caller would send it.
    request: dict[str, Any]
    #: The response body, exactly as the planner must answer.
    response: dict[str, Any]


def read_schema() -> dict[str, Any]:
    """Read the committed JSON Schema.

    Returns:
        The parsed schema document.
    """
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def read_cases() -> tuple[PlanCase, ...]:
    """Read every recorded case, in the order the recording lists them.

    Returns:
        The cases.
    """
    recorded = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    return tuple(
        PlanCase(
            name=case["name"],
            about=case["about"],
            request=case["request"],
            response=case["response"],
        )
        for case in recorded["cases"]
    )


#: Every recorded case, read once at import.
CASES: Final[tuple[PlanCase, ...]] = read_cases()


def case_named(name: str) -> PlanCase:
    """Find one recorded case by name.

    Args:
        name: The case's ``name`` in the recording.

    Returns:
        The case.

    Raises:
        KeyError: If no case carries that name — which means a fixture was renamed and
            something still refers to it by the old one.
    """
    for case in CASES:
        if case.name == name:
            return case

    message = f"no recorded plan case named {name!r}"
    raise KeyError(message)
