"""The structural rules — what a workflow document has to be true of that a schema cannot say.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.structure.ts``, rule for rule
and anchor for anchor.

JSON Schema describes *values*. It can say that a node has an id and that the id is a slug; it
cannot say that two nodes may not share one, that every node must be reachable from the
trigger, or that a loop edge has to point back up the graph it came down. Those are properties
of the graph, and the issue specifies them as post-schema validators for exactly that reason —
which is also why the published schema deliberately does not try: a contract that
half-expressed them would be one two implementations could read two ways.

**These rules run only over a document the schema stage accepted.** A half-parsed graph is a
graph whose edges may have no endpoints and whose nodes may have no types, and every answer
computed over one would be about the validator's guesses rather than the author's document.
:mod:`ouroboros_engine.workflows.validate` enforces the ordering; this module assumes it.

**Two questions are deliberately not asked when they are not well formed.** Reachability is
asked only when there is exactly one trigger — with none there is nowhere to start, and with
two, a walk from either reports the other's subgraph as unreachable, which is an artefact of
the choice rather than a fact about the document. Likewise the endpoint rules are skipped for
an edge whose endpoints do not resolve: it is already reported, and a second diagnostic derived
from a name that means nothing would only crowd the first out of the inspector.
"""

from __future__ import annotations

from .dsl import WorkflowDocument, WorkflowEdge, WorkflowNode
from .errors import Diagnostic, DslErrorCode, EdgeAnchor, pointer


def _reachable_from(
    start: str,
    edges: tuple[WorkflowEdge, ...],
    skip: int = -1,
) -> set[str]:
    """Every node id reachable from ``start`` by following edges forward.

    All three edge kinds are followed: a stage a run can only arrive at by looping back to it
    is still a stage a run arrives at.

    Args:
        start: The id to walk from.
        edges: Every edge in the document.
        skip: An edge to leave out of the walk, by index — used to ask whether a loop edge's
            target could reach its source without the loop edge itself.

    Returns:
        The set of reachable ids, including ``start``.
    """
    outgoing: dict[str, list[str]] = {}
    for index, edge in enumerate(edges):
        if index == skip:
            continue
        outgoing.setdefault(edge.from_, []).append(edge.to)

    seen = {start}
    pending = [start]
    while pending:
        current = pending.pop()
        for following in outgoing.get(current, ()):
            if following in seen:
                continue
            seen.add(following)
            pending.append(following)
    return seen


def _check_nodes(nodes: tuple[WorkflowNode, ...]) -> list[Diagnostic]:
    """Report duplicate ids, the trigger count, and that some path through the graph ends.

    ``document.no_trigger`` and ``document.no_terminal`` anchor at ``/nodes`` rather than at a
    node, because what is wrong is the absence of one. That is still a place the canvas can
    take a reader to, which is what the issue's *never a bare "invalid document"* asks for.

    Args:
        nodes: The document's nodes, in document order.

    Returns:
        The diagnostics, unsorted.
    """
    diagnostics: list[Diagnostic] = []

    seen_ids: set[str] = set()
    for index, node in enumerate(nodes):
        if node.id in seen_ids:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.NODE_DUPLICATE_ID,
                    path=pointer("nodes", index, "id"),
                    message=f"Another node already uses the id `{node.id}`.",
                    node=node.id,
                )
            )
        seen_ids.add(node.id)

    triggers = [
        (index, node) for index, node in enumerate(nodes) if node.type == "trigger"
    ]

    if not triggers:
        diagnostics.append(
            Diagnostic(
                code=DslErrorCode.DOCUMENT_NO_TRIGGER,
                path=pointer("nodes"),
                message="A workflow needs exactly one trigger node; this one has none.",
            )
        )

    for index, node in triggers[1:]:
        diagnostics.append(
            Diagnostic(
                code=DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS,
                path=pointer("nodes", index),
                message=(
                    "A workflow has exactly one trigger node, and an earlier node is "
                    "already it."
                ),
                node=node.id,
            )
        )

    if not any(node.type == "term" for node in nodes):
        diagnostics.append(
            Diagnostic(
                code=DslErrorCode.DOCUMENT_NO_TERMINAL,
                path=pointer("nodes"),
                message=(
                    "A workflow needs at least one terminal node; no path through this "
                    "one ends."
                ),
            )
        )

    return diagnostics


def _check_edges(
    edges: tuple[WorkflowEdge, ...],
    nodes_by_id: dict[str, WorkflowNode],
) -> list[Diagnostic]:
    """Report the edge-level structural rules.

    Args:
        edges: The document's edges, in document order.
        nodes_by_id: The first node carrying each id. Duplicate ids are reported by
            :func:`_check_nodes`; resolving to the first keeps this pass from reporting again.

    Returns:
        The diagnostics, unsorted.
    """
    diagnostics: list[Diagnostic] = []
    seen_pairs: set[tuple[str, str]] = set()

    for index, edge in enumerate(edges):
        anchor = EdgeAnchor(from_=edge.from_, to=edge.to)
        source = nodes_by_id.get(edge.from_)
        target = nodes_by_id.get(edge.to)

        if source is None:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_UNKNOWN_FROM,
                    path=pointer("edges", index, "from"),
                    message=f"No node in this workflow has the id `{edge.from_}`.",
                    edge=anchor,
                )
            )
        if target is None:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_UNKNOWN_TO,
                    path=pointer("edges", index, "to"),
                    message=f"No node in this workflow has the id `{edge.to}`.",
                    edge=anchor,
                )
            )

        pair = (edge.from_, edge.to)
        if pair in seen_pairs:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_DUPLICATE,
                    path=pointer("edges", index),
                    message="An earlier edge already joins these two stages.",
                    edge=anchor,
                )
            )
        seen_pairs.add(pair)

        if edge.kind == "branch" and edge.condition is None:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_BRANCH_WITHOUT_CONDITION,
                    path=pointer("edges", index, "condition"),
                    message=(
                        "A branch edge needs a condition; nothing decides whether this one "
                        "is taken."
                    ),
                    edge=anchor,
                )
            )
        if edge.kind == "default" and edge.condition is not None:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_UNEXPECTED_CONDITION,
                    path=pointer("edges", index, "condition"),
                    message=(
                        "A default edge is always taken, so its condition would never be "
                        "read. Make it a branch edge, or drop the condition."
                    ),
                    edge=anchor,
                )
            )

        if source is None or target is None:
            continue

        if edge.from_ == edge.to:
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_SELF_REFERENCE,
                    path=pointer("edges", index),
                    message="An edge cannot join a stage to itself.",
                    edge=anchor,
                )
            )
            continue

        if target.type == "trigger":
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_INTO_TRIGGER,
                    path=pointer("edges", index),
                    message="The trigger is where a run starts; nothing returns to it.",
                    edge=anchor,
                )
            )
        if source.type == "term":
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_OUT_OF_TERMINAL,
                    path=pointer("edges", index),
                    message="A terminal is where a run ends; no edge leaves one.",
                    edge=anchor,
                )
            )

        if edge.kind == "loop" and edge.from_ not in _reachable_from(
            edge.to, edges, index
        ):
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.EDGE_LOOP_NOT_UPSTREAM,
                    path=pointer("edges", index),
                    message=(
                        "A loop edge goes back up the graph, and this one does not: "
                        f"`{edge.to}` cannot reach `{edge.from_}` without it."
                    ),
                    edge=anchor,
                )
            )

    return diagnostics


def check_structure(document: WorkflowDocument) -> list[Diagnostic]:
    """Check every structural rule over a document the schema stage accepted.

    Args:
        document: The typed document.

    Returns:
        Every rule that broke, unsorted — :mod:`ouroboros_engine.workflows.validate` orders the
        whole verdict.
    """
    diagnostics = _check_nodes(document.nodes)

    nodes_by_id: dict[str, WorkflowNode] = {}
    for node in document.nodes:
        nodes_by_id.setdefault(node.id, node)

    diagnostics.extend(_check_edges(document.edges, nodes_by_id))

    triggers = [node for node in document.nodes if node.type == "trigger"]
    if len(triggers) == 1:
        reachable = _reachable_from(triggers[0].id, document.edges)
        for index, node in enumerate(document.nodes):
            if node.id in reachable:
                continue
            diagnostics.append(
                Diagnostic(
                    code=DslErrorCode.NODE_UNREACHABLE,
                    path=pointer("nodes", index),
                    message="No path of edges reaches this stage from the trigger.",
                    node=node.id,
                )
            )

    return diagnostics
