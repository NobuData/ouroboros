"""The workflow DSL's diagnostic vocabulary, and the shape a diagnostic is reported in.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.errors.ts``, and deliberately
the same file seen twice: the codes, the anchoring rule, the two stage sets and the ordering
are all one contract, and the two files are meant to be read side by side.

Three decisions carried across from it:

* **Every diagnostic is anchored.** ``path`` is an RFC 6901 JSON Pointer into the document,
  and ``node`` / ``edge`` carry the graph anchor when there is one, so a canvas can select the
  offending stage rather than showing a banner. The issue's *never a bare "invalid document"*
  is that field being mandatory; the handful of codes that can only mean *the document as a
  whole* anchor at ``/nodes``, which is still a place a reader can look.
* **``message`` is presentation, not contract.** Each validator renders its own prose; what
  the parity suites compare is ``code``, ``path`` and the anchors.
* **Errors and warnings are separate lists, not a severity field.** Decision **P7**: an
  unknown skill or model reference must not fail a save, and a caller that has to filter by
  severity to learn that is a caller who will forget to.

A :class:`Diagnostic` is a dataclass rather than a pydantic model for one reason worth
stating: its edge anchor is spelled ``{"from": …, "to": …}`` on the wire, to match the
document's own edges, and ``from`` is a Python keyword. A pydantic model would carry the
mismatch as an alias on every field access; a dataclass carries it in one place,
:meth:`EdgeAnchor.as_dict`, which is also the only place the wire shape is produced.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final


class DslErrorCode:
    """Every code this validator reports as an error.

    Grouped by the half of the document they are about: ``document.*`` for the root,
    ``schema.*`` for a value that does not match the published JSON Schema, ``config.*`` for
    the conditional rules inside a node's config, and ``node.*`` / ``edge.*`` for the
    structural rules that run after the schema.
    """

    #: The document is not a JSON object at all.
    DOCUMENT_MALFORMED: Final = "document.malformed"
    #: ``dsl_version`` names a language this build does not implement.
    DOCUMENT_DSL_VERSION_UNSUPPORTED: Final = "document.dsl_version_unsupported"
    #: No node has ``type: "trigger"``, so nothing can start a run.
    DOCUMENT_NO_TRIGGER: Final = "document.no_trigger"
    #: More than one node has ``type: "trigger"``. Reported on the second and each after.
    DOCUMENT_MULTIPLE_TRIGGERS: Final = "document.multiple_triggers"
    #: No node has ``type: "term"``, so no path through the graph ends.
    DOCUMENT_NO_TERMINAL: Final = "document.no_terminal"

    #: A property the schema requires is absent.
    SCHEMA_REQUIRED: Final = "schema.required"
    #: A value is of the wrong JSON type.
    SCHEMA_TYPE: Final = "schema.type"
    #: A value is outside a closed vocabulary.
    SCHEMA_ENUM: Final = "schema.enum"
    #: A number is outside its bounds.
    SCHEMA_RANGE: Final = "schema.range"
    #: A string or array is shorter or longer than the schema allows.
    SCHEMA_LENGTH: Final = "schema.length"
    #: A string does not match its pattern.
    SCHEMA_PATTERN: Final = "schema.pattern"
    #: A property the schema does not declare. Every object in the DSL is closed.
    SCHEMA_UNKNOWN_PROPERTY: Final = "schema.unknown_property"

    #: ``mode: "skill"`` without a ``skill`` to load.
    CONFIG_SKILL_REQUIRED: Final = "config.skill_required"
    #: A ``skill`` in ``mode: "prompt"``, which would never be loaded.
    CONFIG_SKILL_NOT_ALLOWED: Final = "config.skill_not_allowed"
    #: ``routing`` names neither a task to inherit nor a model to pin.
    CONFIG_ROUTING_MISSING: Final = "config.routing_missing"
    #: ``routing`` names both, and the inspector's radios are exclusive.
    CONFIG_ROUTING_AMBIGUOUS: Final = "config.routing_ambiguous"

    #: Two nodes share an ``id``. Reported on the second and each one after.
    NODE_DUPLICATE_ID: Final = "node.duplicate_id"
    #: No path of edges reaches this node from the trigger.
    NODE_UNREACHABLE: Final = "node.unreachable"

    #: ``from`` is not the id of any node in the document.
    EDGE_UNKNOWN_FROM: Final = "edge.unknown_from"
    #: ``to`` is not the id of any node in the document.
    EDGE_UNKNOWN_TO: Final = "edge.unknown_to"
    #: A second edge joins a pair of nodes already joined.
    EDGE_DUPLICATE: Final = "edge.duplicate"
    #: ``from`` and ``to`` are the same node.
    EDGE_SELF_REFERENCE: Final = "edge.self_reference"
    #: An edge arrives at the trigger, which is where a run starts.
    EDGE_INTO_TRIGGER: Final = "edge.into_trigger"
    #: An edge leaves a terminal, which is where a run ends.
    EDGE_OUT_OF_TERMINAL: Final = "edge.out_of_terminal"
    #: A ``branch`` edge carries no ``condition``, so nothing decides whether it is taken.
    EDGE_BRANCH_WITHOUT_CONDITION: Final = "edge.branch_without_condition"
    #: A ``default`` edge carries a ``condition``, which is never consulted.
    EDGE_UNEXPECTED_CONDITION: Final = "edge.unexpected_condition"
    #: A ``loop`` edge points at a node that cannot reach its own source.
    EDGE_LOOP_NOT_UPSTREAM: Final = "edge.loop_not_upstream"


class DslWarningCode:
    """Every code this validator reports as a warning — decision **P7**, in full.

    A skill, a model or a task route the caller's catalogue does not list is reported and the
    document still saves. The model registry (mockups 06/21) and the skills catalogue (mockup
    14) do not exist, so today the only caller that can supply a catalogue is a test; a caller
    that supplies none gets no warnings of this kind, which is the honest answer to *is this
    reference known?* when nothing in the system knows.
    """

    #: The named skill is not in the catalogue the caller supplied.
    REFERENCE_UNKNOWN_SKILL: Final = "reference.unknown_skill"
    #: The pinned model is not in the catalogue the caller supplied.
    REFERENCE_UNKNOWN_MODEL: Final = "reference.unknown_model"
    #: The inherited task route is not in the catalogue the caller supplied.
    REFERENCE_UNKNOWN_TASK: Final = "reference.unknown_task"


#: The codes the **schema stage** can report — everything the published JSON Schema also says.
#:
#: Every other error code belongs to the structural stage, which JSON Schema deliberately does
#: not express: it describes values, and *every node is reachable from the trigger* is not a
#: property of a value. The split is a named constant because it is what
#: ``tests/test_workflows_conformance.py`` compares ``jsonschema`` against, and because a
#: document that is schema-clean and structurally broken is *expected* to satisfy the schema.
SCHEMA_STAGE_CODES: Final[frozenset[str]] = frozenset(
    {
        DslErrorCode.DOCUMENT_MALFORMED,
        DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED,
        DslErrorCode.SCHEMA_REQUIRED,
        DslErrorCode.SCHEMA_TYPE,
        DslErrorCode.SCHEMA_ENUM,
        DslErrorCode.SCHEMA_RANGE,
        DslErrorCode.SCHEMA_LENGTH,
        DslErrorCode.SCHEMA_PATTERN,
        DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
        DslErrorCode.CONFIG_SKILL_REQUIRED,
        DslErrorCode.CONFIG_SKILL_NOT_ALLOWED,
        DslErrorCode.CONFIG_ROUTING_MISSING,
        DslErrorCode.CONFIG_ROUTING_AMBIGUOUS,
    }
)

#: The codes the **structural stage** can report — the rules JSON Schema cannot express.
STRUCTURAL_STAGE_CODES: Final[frozenset[str]] = frozenset(
    {
        DslErrorCode.DOCUMENT_NO_TRIGGER,
        DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS,
        DslErrorCode.DOCUMENT_NO_TERMINAL,
        DslErrorCode.NODE_DUPLICATE_ID,
        DslErrorCode.NODE_UNREACHABLE,
        DslErrorCode.EDGE_UNKNOWN_FROM,
        DslErrorCode.EDGE_UNKNOWN_TO,
        DslErrorCode.EDGE_DUPLICATE,
        DslErrorCode.EDGE_SELF_REFERENCE,
        DslErrorCode.EDGE_INTO_TRIGGER,
        DslErrorCode.EDGE_OUT_OF_TERMINAL,
        DslErrorCode.EDGE_BRANCH_WITHOUT_CONDITION,
        DslErrorCode.EDGE_UNEXPECTED_CONDITION,
        DslErrorCode.EDGE_LOOP_NOT_UPSTREAM,
    }
)


@dataclass(frozen=True, slots=True)
class EdgeAnchor:
    """The graph anchor for a diagnostic about an edge.

    ``from_`` rather than ``from`` because the latter is a Python keyword. The wire spelling
    is the document's — :meth:`as_dict` is where the two meet, and the only place the wire
    shape is produced.
    """

    #: The edge's ``from``, verbatim — including when it names no node.
    from_: str
    #: The edge's ``to``, verbatim — including when it names no node.
    to: str

    def as_dict(self) -> dict[str, str]:
        """Render the anchor the way the document spells an edge.

        Returns:
            ``{"from": …, "to": …}``.
        """
        return {"from": self.from_, "to": self.to}


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """One thing wrong with a document, and where."""

    #: Which rule broke. One of :class:`DslErrorCode` or :class:`DslWarningCode`.
    code: str
    #: An RFC 6901 JSON Pointer to the offending value. ``""`` is the document itself.
    path: str
    #: What a person should read. Rendered here; never part of the parity contract.
    message: str
    #: The id of the node this anchors to, when it anchors to one.
    node: str | None = None
    #: The endpoints of the edge this anchors to, when it anchors to one.
    edge: EdgeAnchor | None = field(default=None)

    def as_dict(self) -> dict[str, object]:
        """Render the diagnostic as the JSON a caller receives.

        ``node`` and ``edge`` are omitted rather than sent as ``null``, so that a diagnostic
        with no graph anchor and one whose anchor failed to resolve are not the same payload.

        Returns:
            The diagnostic, with absent anchors left out.
        """
        payload: dict[str, object] = {
            "code": self.code,
            "path": self.path,
            "message": self.message,
        }
        if self.node is not None:
            payload["node"] = self.node
        if self.edge is not None:
            payload["edge"] = self.edge.as_dict()
        return payload


def _escape(segment: str) -> str:
    """Escape one path segment for an RFC 6901 JSON Pointer.

    ``~`` first and ``/`` second, which is the order the RFC requires: the other way round
    would turn a literal ``/`` into ``~1`` and then into ``~01``.

    Args:
        segment: A property name or an array index.

    Returns:
        The segment with ``~`` and ``/`` escaped.
    """
    return segment.replace("~", "~0").replace("/", "~1")


def pointer(*segments: str | int) -> str:
    """Build an RFC 6901 JSON Pointer from path segments.

    Args:
        *segments: Property names and array indices, outermost first.

    Returns:
        The pointer — ``""`` for the document root, ``/nodes/0/config`` for a node's config.
    """
    return "".join(f"/{_escape(str(segment))}" for segment in segments)


def _pointer_key(path: str) -> tuple[tuple[int, int, str], ...]:
    """The sort key that puts a pointer where a reader reads it.

    Segment by segment, with an all-digit segment compared as a number, so ``/nodes/2`` sorts
    before ``/nodes/10`` rather than after it. A pointer that is a prefix of another sorts
    first, because a shorter tuple that is a prefix compares smaller. A digit segment facing a
    name sorts first — a case the DSL's own shape cannot produce, and fixed only so that this
    and ``dsl.errors.ts``'s ``comparePointers`` are one function rather than two that agree on
    the inputs anyone has tried.

    Args:
        path: The JSON Pointer.

    Returns:
        A tuple that orders the way the TypeScript comparator does.
    """
    return tuple(
        (0, int(segment), "") if segment.isdigit() else (1, 0, segment)
        for segment in path.split("/")
    )


def sort_diagnostics(diagnostics: list[Diagnostic]) -> list[Diagnostic]:
    """Put diagnostics in the one order both validators must agree on.

    Document order by ``path``, then by ``code`` for two diagnostics anchored at the same
    value — a total order, because a parity suite comparing unordered lists would pass on two
    validators that disagree about which of two rules they report first, and an engineer
    reading the two outputs side by side would not.

    Args:
        diagnostics: The diagnostics to order.

    Returns:
        A new list in document order; the caller's list is left alone.
    """
    return sorted(diagnostics, key=lambda d: (_pointer_key(d.path), d.code))
