"""The structural rules, one at a time.

Documents are built here rather than read from ``schemas/workflow-dsl/fixtures/``. The golden
fixtures are the *parity* contract — the same document, the same verdict, in two languages — and
``test_workflows_parity.py`` is where they are asserted. This file is about the rules
themselves, including the combinations the fixture set has no reason to hold: a rule that is
skipped, two rules that could both fire on one edge, a graph with no trigger *and* no terminal.

``ouroboros-rest``'s ``dsl.structure.spec.ts`` is the same file in TypeScript, case for case.
"""

from ouroboros_engine.workflows.dsl import (
    AlwaysPredicate,
    InfraConfig,
    NeedsReviewOptions,
    Position,
    TermConfig,
    Trigger,
    TriggerConditions,
    TriggerConfig,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
)
from ouroboros_engine.workflows.errors import DslErrorCode
from ouroboros_engine.workflows.structure import check_structure

ALWAYS = AlwaysPredicate(kind="always")


def trigger(node_id: str) -> WorkflowNode:
    """A trigger node with the given id."""
    return WorkflowNode(
        id=node_id,
        type="trigger",
        title=node_id,
        position=Position(x=0, y=0),
        config=TriggerConfig(),
    )


def term(node_id: str) -> WorkflowNode:
    """A terminal node with the given id."""
    return WorkflowNode(
        id=node_id,
        type="term",
        title=node_id,
        position=Position(x=0, y=0),
        config=TermConfig(action="needs_review", options=NeedsReviewOptions()),
    )


def stage(node_id: str) -> WorkflowNode:
    """An infra node with the given id."""
    return WorkflowNode(
        id=node_id,
        type="infra",
        title=node_id,
        position=Position(x=0, y=0),
        config=InfraConfig(),
    )


def edge(
    source: str,
    target: str,
    kind: str = "default",
    condition: object = None,
) -> WorkflowEdge:
    """An edge between two nodes."""
    return WorkflowEdge(from_=source, to=target, kind=kind, condition=condition)


def document(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> WorkflowDocument:
    """A document around the given graph."""
    return WorkflowDocument(
        dsl_version="1.0",
        trigger=Trigger(event="ticket_queued", conditions=TriggerConditions()),
        nodes=tuple(nodes),
        edges=tuple(edges),
    )


def codes(doc: WorkflowDocument) -> list[str]:
    """The codes reported, in the order ``check_structure`` happened to produce them."""
    return [diagnostic.code for diagnostic in check_structure(doc)]


def test_a_trigger_a_terminal_and_the_edge_between_them_is_accepted() -> None:
    assert check_structure(document([trigger("a"), term("b")], [edge("a", "b")])) == []


def test_a_workflow_with_no_trigger_is_anchored_at_the_collection_that_lacks_one() -> (
    None
):
    [diagnostic] = check_structure(document([stage("a"), term("b")], [edge("a", "b")]))
    assert diagnostic.code == DslErrorCode.DOCUMENT_NO_TRIGGER
    assert diagnostic.path == "/nodes"
    assert diagnostic.node is None


def test_every_trigger_after_the_first_is_reported_at_its_own_node() -> None:
    doc = document(
        [trigger("a"), term("b"), trigger("c"), trigger("d")],
        [edge("a", "b"), edge("c", "b"), edge("d", "b")],
    )
    reported = [(d.code, d.path, d.node) for d in check_structure(doc)]
    assert reported == [
        (DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS, "/nodes/2", "c"),
        (DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS, "/nodes/3", "d"),
    ]


def test_a_workflow_no_path_through_which_ends_is_reported() -> None:
    assert codes(document([trigger("a"), stage("b")], [edge("a", "b")])) == [
        DslErrorCode.DOCUMENT_NO_TERMINAL
    ]


def test_a_graph_with_neither_a_trigger_nor_a_terminal_reports_both() -> None:
    assert codes(document([stage("a")], [])) == [
        DslErrorCode.DOCUMENT_NO_TRIGGER,
        DslErrorCode.DOCUMENT_NO_TERMINAL,
    ]


def test_every_node_after_the_first_that_reuses_an_id_is_reported() -> None:
    doc = document([trigger("a"), term("b"), term("b"), term("b")], [edge("a", "b")])
    reported = [(d.code, d.path, d.node) for d in check_structure(doc)]
    assert reported == [
        (DslErrorCode.NODE_DUPLICATE_ID, "/nodes/2/id", "b"),
        (DslErrorCode.NODE_DUPLICATE_ID, "/nodes/3/id", "b"),
    ]


def test_a_node_no_path_of_edges_reaches_is_reported() -> None:
    doc = document([trigger("a"), term("b"), stage("c")], [edge("a", "b")])
    [diagnostic] = check_structure(doc)
    assert (diagnostic.code, diagnostic.path, diagnostic.node) == (
        DslErrorCode.NODE_UNREACHABLE,
        "/nodes/2",
        "c",
    )


def test_a_node_reachable_only_by_a_loop_edge_counts_as_reachable() -> None:
    # A stage a run arrives at by looping back to it is a stage a run arrives at.
    doc = document(
        [trigger("a"), stage("b"), term("c"), stage("d")],
        [edge("a", "b"), edge("b", "c"), edge("b", "d"), edge("d", "b", "loop")],
    )
    assert check_structure(doc) == []


def test_reachability_is_not_asked_when_there_is_no_trigger_to_walk_from() -> None:
    # The node would be unreachable from *any* start; saying so would report the absence of the
    # trigger a second time, under a name that points at the wrong node.
    assert codes(document([term("b"), stage("c")], [])) == [
        DslErrorCode.DOCUMENT_NO_TRIGGER
    ]


def test_reachability_is_not_asked_when_two_triggers_make_it_ambiguous() -> None:
    # Walking from the first reports the second's subgraph as unreachable, which is an artefact
    # of the choice of start rather than a fact about the document.
    doc = document(
        [trigger("a"), term("b"), trigger("c"), stage("d")],
        [edge("a", "b"), edge("c", "d"), edge("d", "b")],
    )
    assert codes(doc) == [DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS]


def test_an_endpoint_that_names_no_node_is_reported_on_the_side_that_names_it() -> None:
    doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("x", "y")])
    reported = [
        (d.code, d.path, d.edge.as_dict()) for d in check_structure(doc) if d.edge
    ]
    assert reported == [
        (DslErrorCode.EDGE_UNKNOWN_FROM, "/edges/1/from", {"from": "x", "to": "y"}),
        (DslErrorCode.EDGE_UNKNOWN_TO, "/edges/1/to", {"from": "x", "to": "y"}),
    ]


def test_a_second_edge_between_a_pair_already_joined_is_a_duplicate_whatever_its_kind() -> (
    None
):
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "c"), edge("a", "b", "branch", ALWAYS)],
    )
    assert codes(doc) == [DslErrorCode.EDGE_DUPLICATE]


def test_a_reversed_edge_is_not_a_duplicate() -> None:
    # An edge is identified by its *ordered* pair: b to a is not a second a to b.
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "c"), edge("b", "a")],
    )
    assert codes(doc) == [DslErrorCode.EDGE_INTO_TRIGGER]


def test_a_self_edge_is_reported_once_and_stops_the_other_endpoint_rules() -> None:
    # A self edge is neither upstream nor downstream of itself; reporting the loop rule as well
    # would be two names for one mistake.
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "b", "loop"), edge("b", "c")],
    )
    assert codes(doc) == [DslErrorCode.EDGE_SELF_REFERENCE]


def test_an_edge_leaving_a_terminal_is_reported() -> None:
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "c"), edge("c", "b", "loop")],
    )
    assert codes(doc) == [DslErrorCode.EDGE_OUT_OF_TERMINAL]


def test_a_branch_edge_with_nothing_to_decide_it_is_anchored_at_the_missing_condition() -> (
    None
):
    doc = document([trigger("a"), term("b")], [edge("a", "b", "branch")])
    [diagnostic] = check_structure(doc)
    assert (diagnostic.code, diagnostic.path) == (
        DslErrorCode.EDGE_BRANCH_WITHOUT_CONDITION,
        "/edges/0/condition",
    )


def test_a_condition_on_an_edge_that_is_always_taken_is_reported() -> None:
    doc = document([trigger("a"), term("b")], [edge("a", "b", "default", ALWAYS)])
    assert codes(doc) == [DslErrorCode.EDGE_UNEXPECTED_CONDITION]


def test_a_loop_edge_may_carry_a_condition_or_not() -> None:
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "c"), edge("c", "b", "loop", ALWAYS)],
    )
    # The only complaint is the terminal the loop leaves, never the condition it carries.
    assert codes(doc) == [DslErrorCode.EDGE_OUT_OF_TERMINAL]


def test_the_ouroboros_edge_is_accepted() -> None:
    doc = document(
        [trigger("a"), stage("impl"), stage("gate"), term("done")],
        [
            edge("a", "impl"),
            edge("impl", "gate"),
            edge("gate", "done", "branch", ALWAYS),
            edge("gate", "impl", "loop", ALWAYS),
        ],
    )
    assert check_structure(doc) == []


def test_a_loop_edge_that_goes_forward_is_reported() -> None:
    doc = document(
        [trigger("a"), stage("b"), term("c")],
        [edge("a", "b"), edge("b", "c"), edge("a", "c", "loop")],
    )
    [diagnostic] = check_structure(doc)
    assert (diagnostic.code, diagnostic.path) == (
        DslErrorCode.EDGE_LOOP_NOT_UPSTREAM,
        "/edges/2",
    )


def test_a_loop_edge_does_not_prove_its_own_target_upstream() -> None:
    # Walking a to b would find b from a and call the loop legal; the edge has to be taken out
    # of the graph before the question is asked.
    doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("b", "a", "loop")])
    reported = codes(doc)
    assert DslErrorCode.EDGE_INTO_TRIGGER in reported
    assert DslErrorCode.EDGE_OUT_OF_TERMINAL in reported
    # …and a to b is genuinely upstream of b, so the loop rule itself does not fire.
    assert DslErrorCode.EDGE_LOOP_NOT_UPSTREAM not in reported


def test_nothing_is_said_about_the_endpoints_of_an_edge_that_does_not_resolve() -> None:
    # `x` might have been the terminal, or the trigger, or upstream. A second diagnostic derived
    # from a name that means nothing would crowd out the one that matters.
    doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("x", "b", "loop")])
    assert codes(doc) == [DslErrorCode.EDGE_UNKNOWN_FROM]


def test_a_duplicated_id_resolves_to_the_first_node_carrying_it() -> None:
    # The duplicate is already reported; resolving to the first keeps the edge rules from
    # reporting it a second time under another name.
    doc = document([trigger("a"), term("b"), stage("b")], [edge("a", "b")])
    assert codes(doc) == [DslErrorCode.NODE_DUPLICATE_ID]
