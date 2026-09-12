"""The bounds themselves.

``test_workflows_parity.py`` proves the whole verdict for one document per rule and
``test_workflows_conformance.py`` proves the published schema agrees with these models; what
neither does is stand at the edge of each bound and check which side of it is accepted. An
off-by-one in a ``le=`` is invisible to a fixture set that never sits on the boundary, and it is
the kind of mistake a schema keeps for years.

``ouroboros-rest``'s ``dsl.schema.spec.ts`` is the same file in TypeScript, bound for bound.
"""

import pytest
from pydantic import BaseModel, ValidationError

from ouroboros_engine.workflows.dsl import (
    NODE_CONFIG_MODELS,
    PREDICATE_MODELS,
    SUPPORTED_DSL_VERSIONS,
    TERM_OPTION_MODELS,
    AlwaysPredicate,
    ChecksPredicate,
    EdgeShape,
    EffortPredicate,
    InfraConfig,
    LlmConfig,
    NodeShape,
    Position,
    SourcePredicate,
    Trigger,
    WorkflowRoot,
)


def accepts(model: type[BaseModel], value: object) -> bool:
    """Whether the model accepts the value."""
    try:
        model.model_validate(value)
    except ValidationError:
        return False
    return True


NODE = {
    "id": "implement",
    "type": "llm",
    "title": "Code the change",
    "position": {"x": 0, "y": 0},
    "config": {},
}

LLM = {
    "mode": "prompt",
    "prompt_template": "Do the thing.",
    "routing": {"inherit_task": "implement"},
    "limits": {"max_retries": 2, "token_budget": 400000},
    "permissions": {"push_fixup": True, "touch_ci": False},
}

ROOT = {
    "dsl_version": "1.0",
    "trigger": {"event": "ticket_queued", "conditions": {}},
    "nodes": [{}],
    "edges": [],
}


@pytest.mark.parametrize("value", ["a", "0", "standard-fix", "a-b-c", "x" * 64])
def test_a_node_id_may_be_a_slug(value: str) -> None:
    assert accepts(NodeShape, {**NODE, "id": value})


@pytest.mark.parametrize(
    "value", ["", "-a", "a-", "Implement", "back to queue", "back_to_queue", "x" * 65]
)
def test_a_node_id_may_be_nothing_else(value: str) -> None:
    assert not accepts(NodeShape, {**NODE, "id": value})


def test_a_position_may_be_fractional_because_dragging_produces_one() -> None:
    assert accepts(Position, {"x": 12.5, "y": -3.25})


def test_a_position_accepts_each_bound_and_refuses_the_value_past_it() -> None:
    assert accepts(Position, {"x": -100000, "y": 100000})
    assert not accepts(Position, {"x": -100001, "y": 0})
    assert not accepts(Position, {"x": 0, "y": 100001})


def test_a_position_refuses_a_coordinate_that_is_not_a_number_or_is_missing() -> None:
    # Strict mode: pydantic's lax reading would take "0" and zod would not, and a validator
    # that accepts what the other refuses is the divergence this design exists to prevent.
    assert not accepts(Position, {"x": "0", "y": 0})
    assert not accepts(Position, {"x": 0})


def test_an_empty_conditions_object_is_a_trigger_that_fires_on_every_occurrence() -> (
    None
):
    assert accepts(Trigger, {"event": "ticket_queued", "conditions": {}})


def test_decision_p8s_three_conditions_may_be_used_together() -> None:
    assert accepts(
        Trigger,
        {
            "event": "ticket_queued",
            "conditions": {
                "effort_lte": "m",
                "labels": ["bug"],
                "source": "github",
            },
        },
    )


def test_an_empty_label_list_is_refused_because_it_would_mean_nothing() -> None:
    assert not accepts(
        Trigger, {"event": "ticket_queued", "conditions": {"labels": []}}
    )


def test_a_condition_the_schema_does_not_declare_is_refused() -> None:
    assert not accepts(
        Trigger, {"event": "ticket_queued", "conditions": {"assignee": "me"}}
    )


def test_the_predicate_grammar_is_the_five_kinds_the_dsl_publishes() -> None:
    assert list(PREDICATE_MODELS) == ["always", "effort", "labels", "source", "checks"]
    for kind, model in PREDICATE_MODELS.items():
        assert accepts(model, {"kind": kind}) is (kind == "always")


@pytest.mark.parametrize("op", ["lt", "lte", "eq", "gte", "gt"])
@pytest.mark.parametrize("value", ["xs", "s", "m", "l", "xl"])
def test_every_effort_operator_works_with_every_effort_value(
    op: str, value: str
) -> None:
    assert accepts(EffortPredicate, {"kind": "effort", "op": op, "value": value})


def test_a_gates_names_are_optional_but_never_empty() -> None:
    # Absent means every check the run produced; empty would mean none, which is not a gate.
    assert accepts(ChecksPredicate, {"kind": "checks", "op": "all_passed"})
    assert not accepts(
        ChecksPredicate, {"kind": "checks", "op": "all_passed", "names": []}
    )


def test_a_source_outside_the_trackers_the_intake_model_knows_is_refused() -> None:
    assert accepts(
        SourcePredicate, {"kind": "source", "op": "in", "values": ["github"]}
    )
    assert not accepts(
        SourcePredicate, {"kind": "source", "op": "in", "values": ["bugzilla"]}
    )


def test_a_predicate_refuses_a_member_another_kind_declares() -> None:
    # The grammar is closed per kind, not per predicate: `value` belongs to `effort` alone.
    assert not accepts(AlwaysPredicate, {"kind": "always", "value": "m"})


def test_a_model_stage_accepts_the_inspectors_field_set() -> None:
    assert accepts(LlmConfig, LLM)


def test_a_skill_mode_stage_still_needs_a_prompt_template() -> None:
    # The skill is loaded into context *before* the prompt; a stage with no prompt has nothing
    # for the skill to precede.
    without_template = {
        key: value for key, value in LLM.items() if key != "prompt_template"
    }
    assert not accepts(
        LlmConfig, {**without_template, "mode": "skill", "skill": "repo-map"}
    )


@pytest.mark.parametrize(
    ("retries", "expected"),
    [(0, True), (10, True), (-1, False), (11, False), (1.5, False)],
)
def test_the_retry_bound_accepts_its_edges_and_refuses_past_them(
    retries: object, expected: bool
) -> None:
    limits = {"max_retries": retries, "token_budget": 400000}
    assert accepts(LlmConfig, {**LLM, "limits": limits}) is expected


@pytest.mark.parametrize(
    ("budget", "expected"),
    [(1000, True), (10000000, True), (999, False), (10000001, False)],
)
def test_the_token_budget_bound_accepts_its_edges_and_refuses_past_them(
    budget: int, expected: bool
) -> None:
    limits = {"max_retries": 2, "token_budget": budget}
    assert accepts(LlmConfig, {**LLM, "limits": limits}) is expected


def test_a_whole_number_written_as_json_floating_point_is_still_an_integer() -> None:
    # JSON's 2.0 *is* an integer and JavaScript cannot tell it from 2. Without this, the two
    # validators would disagree about a document neither author would call ambiguous.
    assert accepts(
        LlmConfig, {**LLM, "limits": {"max_retries": 2.0, "token_budget": 400000.0}}
    )


def test_both_permissions_are_required_because_one_nobody_decided_binds_nobody() -> (
    None
):
    assert not accepts(LlmConfig, {**LLM, "permissions": {"push_fixup": True}})
    assert not accepts(LlmConfig, {**LLM, "permissions": {}})


def test_an_empty_prompt_template_is_refused() -> None:
    assert not accepts(LlmConfig, {**LLM, "prompt_template": ""})


def test_the_routing_exclusivity_is_left_to_the_validator_which_has_two_codes_for_it() -> (
    None
):
    # The shape accepts both members and neither; the validator is what tells *neither* from
    # *both*, because they are two different mistakes an author makes.
    assert accepts(LlmConfig, {**LLM, "routing": {}})
    assert accepts(
        LlmConfig,
        {
            **LLM,
            "routing": {"inherit_task": "implement", "pinned_model": "claude-fable-5"},
        },
    )
    assert not accepts(LlmConfig, {**LLM, "routing": {"model": "claude-fable-5"}})


def test_an_infra_stage_may_have_neither_a_pool_nor_a_command() -> None:
    assert accepts(InfraConfig, {})


def test_an_infra_stage_may_have_either_or_both() -> None:
    assert accepts(InfraConfig, {"runner_pool": "pool-a"})
    assert accepts(InfraConfig, {"command": "twister -p native_sim"})
    assert accepts(InfraConfig, {"runner_pool": "pool-a", "command": "make"})


def test_an_empty_command_is_not_the_same_as_no_command() -> None:
    assert not accepts(InfraConfig, {"command": ""})


def test_the_terminal_actions_are_the_three_the_issue_specifies() -> None:
    assert list(TERM_OPTION_MODELS) == [
        "open_pr_automerge",
        "back_to_queue",
        "needs_review",
    ]


def test_auto_merge_requires_the_two_options_the_mockups_chip_prints() -> None:
    model = TERM_OPTION_MODELS["open_pr_automerge"]
    assert accepts(model, {"merge_method": "squash", "delete_branch": True})
    assert not accepts(model, {"merge_method": "squash"})
    assert not accepts(model, {})


def test_the_other_two_actions_take_no_options_at_all() -> None:
    # So adding one is an edit to the published schema rather than a field that appears.
    assert accepts(TERM_OPTION_MODELS["back_to_queue"], {})
    assert accepts(TERM_OPTION_MODELS["needs_review"], {})
    assert not accepts(TERM_OPTION_MODELS["back_to_queue"], {"priority": "high"})


def test_a_nodes_config_is_left_opaque_for_the_dispatch_to_judge() -> None:
    assert accepts(NodeShape, {**NODE, "config": {"anything": True}})


def test_a_nodes_description_is_optional_and_bounded() -> None:
    assert accepts(NodeShape, {**NODE, "description": "x" * 400})
    assert not accepts(NodeShape, {**NODE, "description": "x" * 401})


def test_a_nodes_title_may_be_neither_empty_nor_past_the_bound() -> None:
    assert not accepts(NodeShape, {**NODE, "title": ""})
    assert accepts(NodeShape, {**NODE, "title": "x" * 80})
    assert not accepts(NodeShape, {**NODE, "title": "x" * 81})


def test_a_config_model_is_declared_for_every_node_type() -> None:
    assert sorted(NODE_CONFIG_MODELS) == ["flow", "infra", "llm", "term", "trigger"]


def test_an_edges_label_and_condition_are_optional_and_the_label_is_bounded() -> None:
    edge = {"from": "a", "to": "b", "kind": "default"}
    assert accepts(EdgeShape, edge)
    assert accepts(EdgeShape, {**edge, "label": "x" * 40})
    assert not accepts(EdgeShape, {**edge, "label": "x" * 41})
    assert not accepts(EdgeShape, {**edge, "label": ""})


def test_an_edge_has_no_id_because_its_ordered_pair_is_its_identity() -> None:
    assert not accepts(
        EdgeShape, {"from": "a", "to": "b", "kind": "default", "id": "e1"}
    )


def test_an_edge_is_keyed_by_from_on_the_wire_and_from_underscore_in_python() -> None:
    # `from` is a Python keyword; the alias is where the two spellings meet, and the Python
    # name is deliberately not accepted on input.
    assert accepts(EdgeShape, {"from": "a", "to": "b", "kind": "default"})
    assert not accepts(EdgeShape, {"from_": "a", "to": "b", "kind": "default"})


def test_the_root_accepts_exactly_the_minors_this_build_implements() -> None:
    assert SUPPORTED_DSL_VERSIONS == ("1.0",)
    assert accepts(WorkflowRoot, ROOT)
    assert not accepts(WorkflowRoot, {**ROOT, "dsl_version": "1.1"})


def test_the_root_refuses_a_workflow_with_no_stages_or_more_than_the_canvas_holds() -> (
    None
):
    assert not accepts(WorkflowRoot, {**ROOT, "nodes": []})
    assert accepts(WorkflowRoot, {**ROOT, "nodes": [{}] * 200})
    assert not accepts(WorkflowRoot, {**ROOT, "nodes": [{}] * 201})


def test_the_root_accepts_a_workflow_with_no_edges_and_leaves_the_graph_to_the_rules() -> (
    None
):
    # A single unreachable terminal is a structural failure, not a frame one; keeping the two
    # apart is what lets `check_structure` report the rule rather than the array length.
    assert accepts(WorkflowRoot, {**ROOT, "edges": []})
    assert not accepts(WorkflowRoot, {**ROOT, "edges": [{}] * 401})


def test_the_root_leaves_the_elements_of_both_collections_opaque() -> None:
    assert accepts(WorkflowRoot, {**ROOT, "nodes": [1], "edges": ["x"]})
