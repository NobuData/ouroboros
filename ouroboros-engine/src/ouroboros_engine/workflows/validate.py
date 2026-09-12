"""The workflow DSL validator: this service's answer to whether a definition is runnable.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.validator.ts``. One entry point,
:func:`validate_workflow_document`, and four stages behind it in a fixed order:

1. **The document is an object**, and ``dsl_version`` names a language this build implements.
   Both short-circuit: a JSON array is not a workflow, and a document written in a later DSL is
   not one this build can honestly report rule violations about — the rules it would report
   against are not the rules it was written to.
2. **The schema stage** — the frame, then each node and each edge, then each node's
   type-dependent config and each edge's condition. The pieces are applied separately so that a
   mistake in one node does not hide a different one in the next.
3. **The structural stage** — :mod:`ouroboros_engine.workflows.structure`, and only over a
   document stage 2 accepted, for the reason that module gives.
4. **The reference stage** — :mod:`ouroboros_engine.workflows.references`, decision **P7**'s
   warnings.

The order is the contract. ``ouroboros-rest``'s ``dsl.validator.ts`` runs the same four stages
in the same order, and ``schemas/workflow-dsl/fixtures/expected.json`` records the verdict both
must produce for every fixture — including *which* diagnostics a document that fails an early
stage does and does not get. Two validators reporting the same rules in a different order would
still be two validators a client could tell apart.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from .dsl import (
    NODE_CONFIG_MODELS,
    PREDICATE_MODELS,
    SUPPORTED_DSL_VERSIONS,
    TERM_OPTION_MODELS,
    EdgeShape,
    FlowConfig,
    FlowConfigShape,
    LlmConfig,
    NodeShape,
    TermConfig,
    TermConfigShape,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowRoot,
)
from .errors import Diagnostic, DslErrorCode, EdgeAnchor, pointer, sort_diagnostics
from .issues import diagnostics_from_validation_error
from .references import Catalogue, check_references
from .structure import check_structure


@dataclass(frozen=True, slots=True)
class Verdict:
    """What :func:`validate_workflow_document` answers."""

    #: Whether the document may be saved and published — ``errors`` being empty.
    valid: bool
    #: Every rule that broke, in document order.
    errors: tuple[Diagnostic, ...] = ()
    #: Every decision-P7 reference the catalogue does not list, in document order.
    warnings: tuple[Diagnostic, ...] = ()
    #: The typed document, present exactly when :attr:`valid` is true.
    document: WorkflowDocument | None = field(default=None)

    def as_dict(self) -> dict[str, object]:
        """Render the verdict as the JSON a caller receives.

        The typed document is deliberately absent: a caller that sent a document does not need
        it read back, and R.2's dry-run answers with a walk rather than with a copy.

        Returns:
            ``valid``, ``errors`` and ``warnings``.
        """
        return {
            "valid": self.valid,
            "errors": [diagnostic.as_dict() for diagnostic in self.errors],
            "warnings": [diagnostic.as_dict() for diagnostic in self.warnings],
        }


@dataclass(frozen=True, slots=True)
class _Parsed:
    """A stage's product: what it parsed, and what went wrong doing so."""

    value: object | None
    errors: list[Diagnostic]


@dataclass(frozen=True, slots=True)
class _Dispatched:
    """What :func:`_dispatch` parsed, typed as the model it always is.

    A separate shape from :class:`_Parsed` so that the two callers below can use the value
    without re-asserting what it is — a narrowing assertion in production code is a runtime
    cost paid for a static claim, and the type here makes the claim for free.
    """

    value: BaseModel | None
    errors: list[Diagnostic]


def _dispatch(
    value: dict[str, object],
    tag: str,
    models: dict[str, type[BaseModel]],
    base: tuple[str | int, ...],
    *,
    node: str | None = None,
    edge: EdgeAnchor | None = None,
) -> _Dispatched:
    """Dispatch a tagged object on its tag and validate it against that tag's model.

    The hand-written half of the two-stage design :mod:`ouroboros_engine.workflows.dsl`
    explains: pydantic and zod anchor a tagged union's failures at different places, and the
    anchor is half of what the two validators have to agree on. Doing the dispatch by hand makes
    both sides report the tag's own failures at the tag, and everything else inside the one
    variant that was selected.

    Args:
        value: The object to dispatch, already known to be a mapping.
        tag: The property that names the variant — ``type``, ``kind`` or ``action``.
        models: The variant models, keyed by tag value.
        base: Where ``value`` lives in the document, as pointer segments.
        node: The node every resulting diagnostic belongs to, when there is one.
        edge: The edge every resulting diagnostic belongs to, when there is one.

    Returns:
        The parsed variant, or the diagnostics that stopped it.
    """
    if tag not in value:
        return _Dispatched(
            None,
            [
                Diagnostic(
                    code=DslErrorCode.SCHEMA_REQUIRED,
                    path=pointer(*base, tag),
                    message="This property is required.",
                    node=node,
                    edge=edge,
                )
            ],
        )

    selector = value[tag]
    if not isinstance(selector, str) or selector not in models:
        expected = ", ".join(f'"{key}"' for key in models)
        return _Dispatched(
            None,
            [
                Diagnostic(
                    code=DslErrorCode.SCHEMA_ENUM,
                    path=pointer(*base, tag),
                    message=f"Expected one of {expected}.",
                    node=node,
                    edge=edge,
                )
            ],
        )

    try:
        return _Dispatched(models[selector].model_validate(value), [])
    except ValidationError as exc:
        return _Dispatched(
            None, diagnostics_from_validation_error(exc, base, node=node, edge=edge)
        )


def _parse_node(shape: NodeShape, index: int) -> _Parsed:
    """Validate one node's type-dependent config.

    ``flow`` and ``term`` are dispatched a second time — a flow's predicate on its ``kind``, a
    terminal's options on its ``action`` — which is why this is not simply one
    ``model_validate``.

    Args:
        shape: The node's skeleton, already parsed.
        index: Its position in ``nodes``, for the pointer.

    Returns:
        The typed node, or the diagnostics that stopped it.
    """
    base: tuple[str | int, ...] = ("nodes", index, "config")

    try:
        config: object = NODE_CONFIG_MODELS[shape.type].model_validate(shape.config)
    except ValidationError as exc:
        return _Parsed(
            None, diagnostics_from_validation_error(exc, base, node=shape.id)
        )

    if isinstance(config, LlmConfig):
        errors = _check_llm_config(config, base, shape.id)
        if errors:
            return _Parsed(None, errors)

    if isinstance(config, FlowConfigShape):
        predicate = _dispatch(
            config.predicate,
            "kind",
            PREDICATE_MODELS,
            (*base, "predicate"),
            node=shape.id,
        )
        if predicate.value is None:
            return _Parsed(None, predicate.errors)
        config = FlowConfig(kind=config.kind, predicate=predicate.value)

    if isinstance(config, TermConfigShape):
        try:
            options = TERM_OPTION_MODELS[config.action].model_validate(config.options)
        except ValidationError as exc:
            return _Parsed(
                None,
                diagnostics_from_validation_error(
                    exc, (*base, "options"), node=shape.id
                ),
            )
        config = TermConfig(action=config.action, options=options)

    return _Parsed(
        WorkflowNode(
            id=shape.id,
            type=shape.type,
            title=shape.title,
            description=shape.description,
            position=shape.position,
            config=config,  # type: ignore[arg-type]
        ),
        [],
    )


def _check_llm_config(
    config: LlmConfig,
    base: tuple[str | int, ...],
    node_id: str,
) -> list[Diagnostic]:
    """Report the two conditional rules inside a model stage's config.

    Both are ``oneOf``-shaped in the published schema and both have a code of their own here,
    because *neither* and *both* are two different mistakes an author makes and a single
    "routing is invalid" would tell neither of them which.

    Args:
        config: The parsed config.
        base: Where it lives in the document, as pointer segments.
        node_id: The node to anchor the diagnostics to.

    Returns:
        The diagnostics, unsorted.
    """
    errors: list[Diagnostic] = []

    if config.mode == "skill" and config.skill is None:
        errors.append(
            Diagnostic(
                code=DslErrorCode.CONFIG_SKILL_REQUIRED,
                path=pointer(*base, "skill"),
                message="A stage in skill mode needs the skill to load before its prompt.",
                node=node_id,
            )
        )
    if config.mode == "prompt" and config.skill is not None:
        errors.append(
            Diagnostic(
                code=DslErrorCode.CONFIG_SKILL_NOT_ALLOWED,
                path=pointer(*base, "skill"),
                message=(
                    "A stage in direct-prompt mode loads no skill, so this one would be "
                    "ignored."
                ),
                node=node_id,
            )
        )

    inherited = config.routing.inherit_task
    pinned = config.routing.pinned_model
    if inherited is None and pinned is None:
        errors.append(
            Diagnostic(
                code=DslErrorCode.CONFIG_ROUTING_MISSING,
                path=pointer(*base, "routing"),
                message="Routing must either inherit the route for a task or pin a model.",
                node=node_id,
            )
        )
    if inherited is not None and pinned is not None:
        errors.append(
            Diagnostic(
                code=DslErrorCode.CONFIG_ROUTING_AMBIGUOUS,
                path=pointer(*base, "routing"),
                message=(
                    "Routing inherits a task's route or pins a model, never both — the "
                    "inspector's two radios are exclusive."
                ),
                node=node_id,
            )
        )

    return errors


def _read_node_anchor(candidate: object) -> str | None:
    """The node id to anchor a diagnostic to before the node has been validated.

    A node whose skeleton did not parse still has to be selectable on the canvas, and the canvas
    keys nodes by the id the document gave them — including when that id is the thing that is
    wrong. So the anchor is read verbatim when it is a string at all, and left off when the
    property is missing or of another type, where there is nothing honest to say.

    Args:
        candidate: A node, straight from the document.

    Returns:
        The id, or ``None``.
    """
    if isinstance(candidate, dict):
        value = candidate.get("id")
        if isinstance(value, str):
            return value
    return None


def _read_edge_anchor(candidate: object) -> EdgeAnchor | None:
    """The edge endpoints to anchor a diagnostic to before the edge has been validated.

    Both endpoints or neither: an edge is identified by its pair, and half of one would tell the
    canvas to highlight something it cannot find.

    Args:
        candidate: An edge, straight from the document.

    Returns:
        The anchor, or ``None``.
    """
    if isinstance(candidate, dict):
        source = candidate.get("from")
        target = candidate.get("to")
        if isinstance(source, str) and isinstance(target, str):
            return EdgeAnchor(from_=source, to=target)
    return None


def _parse_edge(candidate: object, index: int) -> _Parsed:
    """Validate one edge and its condition.

    Args:
        candidate: The edge, straight from the document.
        index: Its position in ``edges``, for the pointer.

    Returns:
        The typed edge, or the diagnostics that stopped it.
    """
    base: tuple[str | int, ...] = ("edges", index)

    try:
        shape = EdgeShape.model_validate(candidate)
    except ValidationError as exc:
        return _Parsed(
            None,
            diagnostics_from_validation_error(
                exc, base, edge=_read_edge_anchor(candidate)
            ),
        )

    anchor = EdgeAnchor(from_=shape.from_, to=shape.to)
    condition: BaseModel | None = None

    if shape.condition is not None:
        parsed = _dispatch(
            shape.condition, "kind", PREDICATE_MODELS, (*base, "condition"), edge=anchor
        )
        if parsed.value is None:
            return _Parsed(None, parsed.errors)
        condition = parsed.value

    return _Parsed(
        WorkflowEdge(
            from_=shape.from_,
            to=shape.to,
            kind=shape.kind,
            label=shape.label,
            condition=condition,
        ),
        [],
    )


def validate_workflow_document(
    document: object,
    catalogue: Catalogue | None = None,
) -> Verdict:
    """Validate a workflow definition.

    Args:
        document: The document, as it arrived — parsed JSON, not a string, and not trusted to be
            anything in particular.
        catalogue: What the caller knows beyond the document; see
            :class:`~ouroboros_engine.workflows.references.Catalogue`. ``None`` and decision
            P7's warnings are not reported.

    Returns:
        The verdict, with diagnostics in document order and the typed document when the document
        is valid.
    """
    if not isinstance(document, dict):
        return Verdict(
            valid=False,
            errors=(
                Diagnostic(
                    code=DslErrorCode.DOCUMENT_MALFORMED,
                    path="",
                    message="A workflow definition is a JSON object.",
                ),
            ),
        )

    version = document.get("dsl_version")
    if isinstance(version, str) and version not in SUPPORTED_DSL_VERSIONS:
        supported = ", ".join(SUPPORTED_DSL_VERSIONS)
        return Verdict(
            valid=False,
            errors=(
                Diagnostic(
                    code=DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED,
                    path=pointer("dsl_version"),
                    message=(
                        f"This build implements {supported} of the workflow language, and "
                        f"the document is written in {version}."
                    ),
                ),
            ),
        )

    try:
        root = WorkflowRoot.model_validate(document)
    except ValidationError as exc:
        return Verdict(
            valid=False,
            errors=tuple(sort_diagnostics(diagnostics_from_validation_error(exc))),
        )

    errors: list[Diagnostic] = []
    nodes: list[WorkflowNode] = []
    edges: list[WorkflowEdge] = []

    for index, candidate in enumerate(root.nodes):
        try:
            shape = NodeShape.model_validate(candidate)
        except ValidationError as exc:
            errors.extend(
                diagnostics_from_validation_error(
                    exc, ("nodes", index), node=_read_node_anchor(candidate)
                )
            )
            continue
        parsed = _parse_node(shape, index)
        if isinstance(parsed.value, WorkflowNode):
            nodes.append(parsed.value)
        errors.extend(parsed.errors)

    for index, candidate in enumerate(root.edges):
        parsed = _parse_edge(candidate, index)
        if isinstance(parsed.value, WorkflowEdge):
            edges.append(parsed.value)
        errors.extend(parsed.errors)

    if errors:
        return Verdict(valid=False, errors=tuple(sort_diagnostics(errors)))

    parsed_document = WorkflowDocument(
        dsl_version=root.dsl_version,
        trigger=root.trigger,
        nodes=tuple(nodes),
        edges=tuple(edges),
    )

    structural = check_structure(parsed_document)
    if structural:
        return Verdict(valid=False, errors=tuple(sort_diagnostics(structural)))

    return Verdict(
        valid=True,
        warnings=tuple(sort_diagnostics(check_references(parsed_document, catalogue))),
        document=parsed_document,
    )
