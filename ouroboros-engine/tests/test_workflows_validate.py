"""The validator: the input it is handed, the stages and their order, and what it answers.

``ouroboros-rest``'s ``dsl.validator.spec.ts`` is the same file in TypeScript, case for case.
The stage *order* is a shared contract — ``fixtures/expected.json`` records which diagnostics a
document that fails an early stage does and does not get — so the cases here that pin it are the
ones that would catch the two validators drifting apart in a way the fixture set alone could not
name.
"""

from copy import deepcopy
from typing import Any

import pytest

from ouroboros_engine.workflows.errors import DslErrorCode, DslWarningCode
from ouroboros_engine.workflows.references import Catalogue
from ouroboros_engine.workflows.validate import validate_workflow_document
from workflows_golden import read_fixture

MINIMAL: dict[str, Any] = {
    "dsl_version": "1.0",
    "trigger": {"event": "ticket_queued", "conditions": {}},
    "nodes": [
        {
            "id": "start",
            "type": "trigger",
            "title": "Issue queued",
            "position": {"x": 0, "y": 0},
            "config": {},
        },
        {
            "id": "done",
            "type": "term",
            "title": "Needs review",
            "position": {"x": 240, "y": 0},
            "config": {"action": "needs_review", "options": {}},
        },
    ],
    "edges": [{"from": "start", "to": "done", "kind": "default"}],
}


def minimal() -> dict[str, Any]:
    """The smallest legal document, fresh each call so a test may mutate it."""
    return deepcopy(MINIMAL)


def codes(document: object) -> list[str]:
    """The codes reported as errors, in the order the verdict gives them."""
    return [
        diagnostic.code for diagnostic in validate_workflow_document(document).errors
    ]


@pytest.mark.parametrize("document", [None, [], "dsl_version: 1.0", 7])
def test_something_that_is_not_an_object_is_refused_without_raising(
    document: object,
) -> None:
    verdict = validate_workflow_document(document)
    assert verdict.valid is False
    assert [(d.code, d.path) for d in verdict.errors] == [
        (DslErrorCode.DOCUMENT_MALFORMED, "")
    ]


def test_this_builds_rules_are_not_asserted_against_a_later_language() -> None:
    # The rules it would report against are not the rules the document was written to. So a
    # version it does not implement is the whole answer, and the graph is not walked at all.
    document = {**minimal(), "dsl_version": "2.0", "nodes": []}
    verdict = validate_workflow_document(document)
    assert [(d.code, d.path) for d in verdict.errors] == [
        (DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED, "/dsl_version")
    ]
    assert "2.0" in verdict.errors[0].message


def test_an_absent_version_is_required_rather_than_unsupported() -> None:
    document = minimal()
    del document["dsl_version"]
    assert codes(document) == [DslErrorCode.SCHEMA_REQUIRED]


def test_a_non_string_version_is_a_vocabulary_failure_rather_than_unsupported() -> None:
    # The short-circuit is for a *later language*, which is a thing a string can name. The
    # number 1 is not a version at all, so it is the closed vocabulary that refuses it — which
    # is also what zod's enum answers, so the two agree.
    assert codes({**minimal(), "dsl_version": 1}) == [DslErrorCode.SCHEMA_ENUM]


def test_an_undeclared_property_at_the_document_root_is_refused() -> None:
    verdict = validate_workflow_document({**minimal(), "name": "standard-fix"})
    assert [(d.code, d.path) for d in verdict.errors] == [
        (DslErrorCode.SCHEMA_UNKNOWN_PROPERTY, "/name")
    ]


def test_a_mistake_in_each_node_is_reported_rather_than_only_the_first() -> None:
    # A canvas that reports one error, is corrected, and then reports another is a canvas an
    # author stops trusting — so the element models are applied one node at a time.
    document = minimal()
    document["nodes"][0]["title"] = 4
    document["nodes"][1]["position"] = {"x": 0}
    verdict = validate_workflow_document(document)
    assert [(d.code, d.path) for d in verdict.errors] == [
        (DslErrorCode.SCHEMA_TYPE, "/nodes/0/title"),
        (DslErrorCode.SCHEMA_REQUIRED, "/nodes/1/position/y"),
    ]


def test_a_config_that_is_not_an_object_is_a_type_failure_not_an_empty_one() -> None:
    # pydantic's `dict[str, object]` and zod's `z.record` both refuse an array here, and both
    # call it a type failure at the config itself. A validator that read `[]` as *no
    # properties* would then report whatever the type's own model requires, which is a
    # different diagnostic about a document nobody wrote.
    document = minimal()
    document["nodes"][1]["config"] = []
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path, diagnostic.node) == (
        DslErrorCode.SCHEMA_TYPE,
        "/nodes/1/config",
        "done",
    )


def test_the_graph_is_not_walked_when_the_frame_of_the_document_is_wrong() -> None:
    # `nodes` is not a collection, so there is no graph to have rules about.
    assert codes({**minimal(), "nodes": {}}) == [DslErrorCode.SCHEMA_TYPE]


def test_the_graph_is_not_walked_when_a_nodes_config_did_not_parse() -> None:
    # The graph would be one node short, and every answer about it would be about the
    # validator's guesses rather than about the author's document.
    document = minimal()
    document["nodes"][1]["config"] = {"action": "close_issue", "options": {}}
    document["edges"] = []
    assert codes(document) == [DslErrorCode.SCHEMA_ENUM]


def test_the_structural_rules_run_once_the_schema_stage_is_clean() -> None:
    document = minimal()
    document["edges"] = []
    assert codes(document) == [DslErrorCode.NODE_UNREACHABLE]


def test_warnings_are_held_back_until_the_document_is_otherwise_valid() -> None:
    # An unknown reference is advice about a document somebody can save. Advising on one they
    # cannot would bury the reason they cannot.
    document = minimal()
    document["edges"] = []
    verdict = validate_workflow_document(document, Catalogue(skills=[]))
    assert verdict.valid is False
    assert verdict.warnings == ()


def test_a_nodes_schema_failure_is_anchored_to_the_id_the_document_gave_it() -> None:
    # Including when the id is the thing that is wrong: the canvas keys nodes by it.
    document = minimal()
    document["nodes"][1]["id"] = "Needs Review"
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path, diagnostic.node) == (
        DslErrorCode.SCHEMA_PATTERN,
        "/nodes/1/id",
        "Needs Review",
    )


def test_an_edges_schema_failure_is_anchored_to_both_its_endpoints() -> None:
    document = minimal()
    document["edges"][0]["kind"] = "maybe"
    [diagnostic] = validate_workflow_document(document).errors
    assert diagnostic.code == DslErrorCode.SCHEMA_ENUM
    assert diagnostic.path == "/edges/0/kind"
    assert diagnostic.edge is not None
    assert diagnostic.edge.as_dict() == {"from": "start", "to": "done"}


def test_an_unknown_node_type_is_anchored_at_the_type_rather_than_at_the_node() -> None:
    document = minimal()
    document["nodes"][1]["type"] = "notify"
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path) == (
        DslErrorCode.SCHEMA_ENUM,
        "/nodes/1/type",
    )


def test_an_unknown_predicate_kind_is_anchored_at_the_kind() -> None:
    document = minimal()
    document["nodes"].insert(
        1,
        {
            "id": "fork",
            "type": "flow",
            "title": "Decide",
            "position": {"x": 120, "y": 0},
            "config": {"kind": "decision", "predicate": {"kind": "assignee"}},
        },
    )
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path, diagnostic.node) == (
        DslErrorCode.SCHEMA_ENUM,
        "/nodes/1/config/predicate/kind",
        "fork",
    )


def test_an_absent_predicate_kind_is_anchored_at_the_kind_and_called_required() -> None:
    document = minimal()
    document["edges"][0] = {
        "from": "start",
        "to": "done",
        "kind": "branch",
        "condition": {},
    }
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path) == (
        DslErrorCode.SCHEMA_REQUIRED,
        "/edges/0/condition/kind",
    )
    assert diagnostic.edge is not None


def test_a_terminals_options_are_validated_against_its_own_action() -> None:
    document = minimal()
    document["nodes"][1]["config"] = {
        "action": "needs_review",
        "options": {"merge_method": "squash"},
    }
    [diagnostic] = validate_workflow_document(document).errors
    assert (diagnostic.code, diagnostic.path) == (
        DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
        "/nodes/1/config/options/merge_method",
    )


@pytest.mark.parametrize(
    ("routing", "expected"),
    [
        ({}, DslErrorCode.CONFIG_ROUTING_MISSING),
        (
            {"inherit_task": "implement", "pinned_model": "claude-fable-5"},
            DslErrorCode.CONFIG_ROUTING_AMBIGUOUS,
        ),
    ],
)
def test_the_two_routing_mistakes_are_reported_under_different_codes(
    routing: dict[str, str], expected: str
) -> None:
    document = minimal()
    document["nodes"].insert(
        1,
        {
            "id": "stage",
            "type": "llm",
            "title": "Code the change",
            "position": {"x": 120, "y": 0},
            "config": {
                "mode": "prompt",
                "prompt_template": "Do the thing.",
                "routing": routing,
                "limits": {"max_retries": 1, "token_budget": 10000},
                "permissions": {"push_fixup": False, "touch_ci": False},
            },
        },
    )
    assert codes(document) == [expected]


def test_the_typed_document_comes_back_for_a_valid_one_and_not_for_an_invalid_one() -> (
    None
):
    assert validate_workflow_document(minimal()).document is not None
    assert validate_workflow_document({**minimal(), "edges": []}).document is None


def test_parsing_is_not_rewriting() -> None:
    # Decision P3 makes the stored JSON the canonical artifact, so what the canvas saved and
    # what the engine runs have to be the same document. The node ids, titles, positions and
    # edges all come back as they went in.
    source = read_fixture("valid/standard-fix.json")
    document = validate_workflow_document(source).document
    assert document is not None
    assert [node.id for node in document.nodes] == [
        node["id"] for node in source["nodes"]
    ]
    assert [(edge.from_, edge.to, edge.kind) for edge in document.edges] == [
        (edge["from"], edge["to"], edge["kind"]) for edge in source["edges"]
    ]
    assert document.dsl_version == source["dsl_version"]


def test_no_warnings_are_carried_when_the_caller_supplies_no_catalogue() -> None:
    verdict = validate_workflow_document(read_fixture("valid/standard-fix.json"))
    assert verdict.valid is True
    assert verdict.errors == ()
    assert verdict.warnings == ()


def test_a_document_whose_references_are_unknown_still_saves() -> None:
    # The issue's last acceptance criterion, and decision P7, in one assertion.
    verdict = validate_workflow_document(
        read_fixture("valid/standard-fix.json"),
        Catalogue(skills=[], models=[], tasks=[]),
    )
    assert verdict.valid is True
    assert verdict.errors == ()
    assert {warning.code for warning in verdict.warnings} == {
        DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        DslWarningCode.REFERENCE_UNKNOWN_MODEL,
        DslWarningCode.REFERENCE_UNKNOWN_TASK,
    }


def test_no_diagnostic_is_ever_unanchored() -> None:
    # The issue's second acceptance criterion: never a bare "invalid document". Every
    # diagnostic carries a pointer, and every one but the handful that are about the document
    # as a whole carries a node or an edge as well.
    document = minimal()
    document["nodes"][1]["config"] = {}
    for diagnostic in validate_workflow_document(document).errors:
        assert isinstance(diagnostic.path, str)
        assert diagnostic.node is not None or diagnostic.edge is not None
        assert diagnostic.message
