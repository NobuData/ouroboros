"""Reading a validated workflow document as a graph to walk — no I/O, no judgement.

#160. The interpreter needs four questions answered about the pinned document: which node is
the trigger, what a node is by id, which edges leave it, and which of those is its *default*
way forward. Everything else — whether a branch holds, whether a gate passes — is
:mod:`~ouroboros_engine.execution.facts`'.
"""

from __future__ import annotations

from ouroboros_engine.workflows.dsl import WorkflowDocument, WorkflowEdge, WorkflowNode


class WorkflowGraph:
    """A validated document, indexed for walking."""

    def __init__(self, document: WorkflowDocument) -> None:
        """Index the document.

        Args:
            document: A document :func:`validate_workflow_document` accepted.
        """
        self.document = document
        self._nodes = {node.id: node for node in document.nodes}
        self._outgoing: dict[str, list[WorkflowEdge]] = {
            node.id: [] for node in document.nodes
        }
        for edge in document.edges:
            self._outgoing.setdefault(edge.from_, []).append(edge)

    def node(self, node_id: str) -> WorkflowNode | None:
        """A node by id.

        Args:
            node_id: The DSL node id.

        Returns:
            The node, or ``None`` when the document has none by that id.
        """
        return self._nodes.get(node_id)

    def trigger(self) -> WorkflowNode:
        """The node a run starts at.

        Returns:
            The first ``trigger`` node, else the first node (a validated document has one).
        """
        return next(
            (node for node in self.document.nodes if node.type == "trigger"),
            self.document.nodes[0],
        )

    def outgoing(self, node_id: str, kind: str | None = None) -> list[WorkflowEdge]:
        """The edges leaving a node, in document order.

        Args:
            node_id: The node.
            kind: Only edges of this kind — ``default``, ``branch`` or ``loop``.

        Returns:
            The edges.
        """
        edges = self._outgoing.get(node_id, [])
        return [edge for edge in edges if kind is None or edge.kind == kind]

    def default_next(self, node_id: str) -> str | None:
        """Where a node goes when nothing is decided — its first ``default`` edge.

        Args:
            node_id: The node.

        Returns:
            The target, or ``None`` when no default edge leaves it.
        """
        defaults = self.outgoing(node_id, "default")
        return defaults[0].to if defaults else None

    def loop_edge(self, node_id: str) -> WorkflowEdge | None:
        """The loop edge a failing gate follows back up the graph.

        Args:
            node_id: The gate.

        Returns:
            Its first ``loop`` edge, or ``None``.
        """
        loops = self.outgoing(node_id, "loop")
        return loops[0] if loops else None
