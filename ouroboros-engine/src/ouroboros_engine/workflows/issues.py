"""pydantic's errors, translated into the DSL's diagnostic vocabulary.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.issues.ts``.

pydantic names its failures after *its own* checks — ``missing``, ``less_than_equal``,
``extra_forbidden`` — and zod names the same failures after its own — ``invalid_type``,
``too_big``, ``unrecognized_keys``. Neither vocabulary is the product's, and a client that
switched on one would break the day the other validator answered it. So both sides translate
into :class:`~ouroboros_engine.workflows.errors.DslErrorCode`, and
``schemas/workflow-dsl/fixtures/expected.json`` records what the translation has to produce.

Two things about the translation are worth reading twice.

**pydantic distinguishes a missing property from one of the wrong type and zod does not**, so
the TypeScript side looks the value up in the input to decide. Here the distinction is
``missing`` versus a ``*_type`` error, and it comes for free — which is also why the two agree.

**The table below is a table of suffixes, not of exact names.** pydantic has a ``*_type`` error
per Python type and a ``too_short`` / ``string_too_short`` pair that mean the same thing at
different arities, and enumerating them would be a list that a pydantic upgrade could silently
outgrow. The fallback is a type failure rather than an exception, so a pydantic release that
adds an error kind degrades to a slightly less specific code instead of turning a validation
into a 500; the conformance and parity suites are what would report that the new kind needs a
code of its own.
"""

from __future__ import annotations

from typing import Final

from pydantic import ValidationError

from .errors import Diagnostic, DslErrorCode, EdgeAnchor, pointer

#: pydantic error types that mean exactly one thing, whatever the field.
_EXACT: Final[dict[str, str]] = {
    "missing": DslErrorCode.SCHEMA_REQUIRED,
    "extra_forbidden": DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
    "literal_error": DslErrorCode.SCHEMA_ENUM,
    "enum": DslErrorCode.SCHEMA_ENUM,
    "string_pattern_mismatch": DslErrorCode.SCHEMA_PATTERN,
    "greater_than": DslErrorCode.SCHEMA_RANGE,
    "greater_than_equal": DslErrorCode.SCHEMA_RANGE,
    "less_than": DslErrorCode.SCHEMA_RANGE,
    "less_than_equal": DslErrorCode.SCHEMA_RANGE,
    "multiple_of": DslErrorCode.SCHEMA_RANGE,
    "finite_number": DslErrorCode.SCHEMA_RANGE,
}

#: Suffixes that classify a family of pydantic error types, tried in order.
_SUFFIXES: Final[tuple[tuple[str, str], ...]] = (
    ("_too_short", DslErrorCode.SCHEMA_LENGTH),
    ("_too_long", DslErrorCode.SCHEMA_LENGTH),
    ("too_short", DslErrorCode.SCHEMA_LENGTH),
    ("too_long", DslErrorCode.SCHEMA_LENGTH),
    ("_type", DslErrorCode.SCHEMA_TYPE),
)


def code_for(error_type: str) -> str:
    """Translate one pydantic error type into a DSL error code.

    Args:
        error_type: pydantic's ``type`` for the error, e.g. ``"string_too_short"``.

    Returns:
        The code to report. A type this table does not know becomes
        :data:`~ouroboros_engine.workflows.errors.DslErrorCode.SCHEMA_TYPE`.
    """
    exact = _EXACT.get(error_type)
    if exact is not None:
        return exact
    for suffix, code in _SUFFIXES:
        if error_type.endswith(suffix):
            return code
    return DslErrorCode.SCHEMA_TYPE


def message_for(code: str, error: dict[str, object]) -> str:
    """Render the sentence a person reads for one translated error.

    The message is deliberately *not* part of the parity contract — each validator writes its
    own — so this leans on pydantic's own wording for the cases where pydantic says it better
    than a template could, and states the two codes that carry product meaning itself.

    Args:
        code: The translated code.
        error: One entry from :meth:`pydantic.ValidationError.errors`.

    Returns:
        One sentence, ending in a full stop.
    """
    if code == DslErrorCode.SCHEMA_REQUIRED:
        return "This property is required."
    if code == DslErrorCode.SCHEMA_UNKNOWN_PROPERTY:
        name = str(error.get("loc", ("",))[-1]) if error.get("loc") else ""
        return f"`{name}` is not a property the workflow schema declares."
    detail = str(error.get("msg", "")).rstrip(".")
    return f"{detail}." if detail else "This value does not match the workflow schema."


def diagnostics_from_validation_error(
    exc: ValidationError,
    base: tuple[str | int, ...] = (),
    *,
    node: str | None = None,
    edge: EdgeAnchor | None = None,
) -> list[Diagnostic]:
    """Translate a pydantic failure into diagnostics.

    Args:
        exc: The error one ``model_validate`` raised.
        base: Where the validated value lives in the whole document, as pointer segments —
            ``()`` for the document itself, ``("nodes", 3, "config")`` for a node's config.
        node: The node id to anchor every resulting diagnostic to, when there is one.
        edge: The edge endpoints to anchor them to, when there are ones.

    Returns:
        One diagnostic per error, unsorted.
    """
    diagnostics: list[Diagnostic] = []
    for error in exc.errors():
        code = code_for(str(error["type"]))
        location = tuple(str(segment) for segment in error["loc"])
        diagnostics.append(
            Diagnostic(
                code=code,
                path=pointer(*base, *location),
                message=message_for(code, dict(error)),
                node=node,
                edge=edge,
            )
        )
    return diagnostics
