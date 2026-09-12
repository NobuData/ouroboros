"""The diagnostic vocabulary: the pointer, the anchors, the two stage sets, and the ordering.

The ordering is the one thing in this file that is a *shared* contract rather than this
module's own: ``schemas/workflow-dsl/fixtures/expected.json`` records one order, and
``ouroboros-rest``'s ``dsl.errors.spec.ts`` asserts the same properties of the TypeScript
comparator. A sort that differs between the two would make every parity case a coin toss on a
document with more than one mistake in it.
"""

from ouroboros_engine.workflows.errors import (
    SCHEMA_STAGE_CODES,
    STRUCTURAL_STAGE_CODES,
    Diagnostic,
    DslErrorCode,
    DslWarningCode,
    EdgeAnchor,
    pointer,
    sort_diagnostics,
)


def at(path: str, code: str) -> Diagnostic:
    """A diagnostic with only the two fields these tests are about."""
    return Diagnostic(code=code, path=path, message="")


def test_the_document_root_is_the_empty_pointer() -> None:
    assert pointer() == ""


def test_property_names_and_array_indices_render_alike() -> None:
    assert pointer("nodes", 3, "config", "routing") == "/nodes/3/config/routing"


def test_tilde_is_escaped_before_slash() -> None:
    # RFC 6901 § 3: the order matters. Escaping `/` first would turn it into `~1` and the `~`
    # pass would then turn that into `~01`, which points somewhere else entirely.
    assert pointer("a/b") == "/a~1b"
    assert pointer("a~b") == "/a~0b"
    assert pointer("a~/b") == "/a~0~1b"


def test_an_undeclared_property_name_is_escaped() -> None:
    # Every other segment is a name from the schema, and none of them contains `/` or `~`. An
    # unknown key comes from the document, so this is where an unescaped pointer would be
    # produced.
    assert pointer("nodes", 0, "config", "a/b") == "/nodes/0/config/a~1b"


def test_array_indices_sort_numerically_rather_than_lexically() -> None:
    sorted_paths = [
        diagnostic.path
        for diagnostic in sort_diagnostics(
            [
                at("/nodes/10", DslErrorCode.NODE_UNREACHABLE),
                at("/nodes/2", DslErrorCode.NODE_UNREACHABLE),
                at("/nodes/1", DslErrorCode.NODE_UNREACHABLE),
            ]
        )
    ]
    assert sorted_paths == ["/nodes/1", "/nodes/2", "/nodes/10"]


def test_a_parent_sorts_before_its_children() -> None:
    sorted_paths = [
        diagnostic.path
        for diagnostic in sort_diagnostics(
            [
                at("/nodes/0/config/routing", DslErrorCode.CONFIG_ROUTING_MISSING),
                at("/nodes/0", DslErrorCode.NODE_UNREACHABLE),
            ]
        )
    ]
    assert sorted_paths == ["/nodes/0", "/nodes/0/config/routing"]


def test_two_diagnostics_at_one_value_are_ordered_by_code() -> None:
    ordered = sort_diagnostics(
        [
            at("/nodes/0/config/skill", DslWarningCode.REFERENCE_UNKNOWN_SKILL),
            at("/nodes/0/config/skill", DslErrorCode.CONFIG_SKILL_REQUIRED),
        ]
    )
    assert [diagnostic.code for diagnostic in ordered] == [
        DslErrorCode.CONFIG_SKILL_REQUIRED,
        DslWarningCode.REFERENCE_UNKNOWN_SKILL,
    ]


def test_sibling_properties_sort_lexically() -> None:
    ordered = sort_diagnostics(
        [
            at("/trigger/event", DslErrorCode.SCHEMA_ENUM),
            at("/trigger/conditions", DslErrorCode.SCHEMA_TYPE),
        ]
    )
    assert [d.path for d in ordered] == ["/trigger/conditions", "/trigger/event"]


def test_the_document_root_sorts_first() -> None:
    ordered = sort_diagnostics(
        [
            at("/nodes", DslErrorCode.DOCUMENT_NO_TRIGGER),
            at("", DslErrorCode.DOCUMENT_MALFORMED),
        ]
    )
    assert [d.path for d in ordered] == ["", "/nodes"]


def test_a_digit_segment_sorts_before_a_name_at_the_same_position() -> None:
    # The DSL's own shape cannot produce this — a position in a pointer is always an index or
    # always a property name — so it is fixed on both sides to make the two implementations one
    # function rather than two that happen to agree.
    ordered = sort_diagnostics(
        [
            at("/nodes/config", DslErrorCode.SCHEMA_TYPE),
            at("/nodes/2", DslErrorCode.SCHEMA_TYPE),
        ]
    )
    assert [d.path for d in ordered] == ["/nodes/2", "/nodes/config"]


def test_sorting_leaves_the_callers_list_alone() -> None:
    given = [at("/b", DslErrorCode.SCHEMA_TYPE), at("/a", DslErrorCode.SCHEMA_TYPE)]
    sort_diagnostics(given)
    assert [d.path for d in given] == ["/b", "/a"]


def test_an_edge_anchor_renders_the_way_a_document_spells_an_edge() -> None:
    # `from_` is a Python spelling, never a wire one.
    assert EdgeAnchor(from_="a", to="b").as_dict() == {"from": "a", "to": "b"}


def test_a_diagnostic_omits_the_anchors_it_does_not_carry() -> None:
    # Absent rather than null, so a diagnostic with no graph anchor and one whose anchor failed
    # to resolve are not the same payload.
    bare = Diagnostic(code=DslErrorCode.DOCUMENT_NO_TRIGGER, path="/nodes", message="x")
    assert bare.as_dict() == {
        "code": DslErrorCode.DOCUMENT_NO_TRIGGER,
        "path": "/nodes",
        "message": "x",
    }


def test_a_diagnostic_renders_both_anchors_when_it_carries_them() -> None:
    anchored = Diagnostic(
        code=DslErrorCode.EDGE_DUPLICATE,
        path="/edges/1",
        message="x",
        node="implement",
        edge=EdgeAnchor(from_="a", to="b"),
    )
    assert anchored.as_dict() == {
        "code": DslErrorCode.EDGE_DUPLICATE,
        "path": "/edges/1",
        "message": "x",
        "node": "implement",
        "edge": {"from": "a", "to": "b"},
    }


def test_the_two_stage_sets_partition_every_error_code() -> None:
    # `test_workflows_conformance.py` compares the schema's verdict against the schema stage's
    # alone, because the structural rules are deliberately outside the published schema. A code
    # that belonged to neither set — or to both — would make that comparison pass for the wrong
    # reason.
    declared = {
        value
        for name, value in vars(DslErrorCode).items()
        if not name.startswith("_") and isinstance(value, str)
    }
    assert declared == SCHEMA_STAGE_CODES | STRUCTURAL_STAGE_CODES
    assert frozenset() == SCHEMA_STAGE_CODES & STRUCTURAL_STAGE_CODES


def test_a_warning_code_belongs_to_neither_stage() -> None:
    for name, value in vars(DslWarningCode).items():
        if name.startswith("_") or not isinstance(value, str):
            continue
        assert value not in SCHEMA_STAGE_CODES
        assert value not in STRUCTURAL_STAGE_CODES
