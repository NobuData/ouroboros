"""Decision **P7**'s warnings: what a catalogue is, and what an absent one means.

``ouroboros-rest``'s ``dsl.references.spec.ts`` is the same file in TypeScript, case for case.
"""

from ouroboros_engine.workflows.dsl import (
    InfraConfig,
    LlmConfig,
    LlmLimits,
    LlmPermissions,
    LlmRouting,
    Position,
    Trigger,
    TriggerConditions,
    WorkflowDocument,
    WorkflowNode,
)
from ouroboros_engine.workflows.errors import DslWarningCode
from ouroboros_engine.workflows.references import Catalogue, check_references


def llm(node_id: str, **overrides: object) -> WorkflowNode:
    """A model stage, with the given config overrides."""
    config = {
        "mode": "prompt",
        "prompt_template": "Do the thing.",
        "routing": LlmRouting(inherit_task="implement"),
        "limits": LlmLimits(max_retries=1, token_budget=10000),
        "permissions": LlmPermissions(push_fixup=False, touch_ci=False),
        **overrides,
    }
    return WorkflowNode(
        id=node_id,
        type="llm",
        title=node_id,
        position=Position(x=0, y=0),
        config=LlmConfig(**config),
    )


def document(nodes: list[WorkflowNode]) -> WorkflowDocument:
    """A document around the given nodes."""
    return WorkflowDocument(
        dsl_version="1.0",
        trigger=Trigger(event="ticket_queued", conditions=TriggerConditions()),
        nodes=tuple(nodes),
        edges=(),
    )


DOCUMENT = document(
    [
        llm(
            "a",
            mode="skill",
            skill="repo-map",
            routing=LlmRouting(pinned_model="claude-sonnet-5"),
        ),
        llm("b", routing=LlmRouting(inherit_task="plan")),
    ]
)


def test_nothing_is_reported_when_the_caller_supplies_no_catalogue() -> None:
    # Decision P7: nothing in the system knows which skills exist, so nothing here claims to.
    assert check_references(DOCUMENT, None) == []


def test_nothing_is_reported_when_every_reference_is_in_the_catalogue() -> None:
    catalogue = Catalogue(
        skills=["repo-map"], models=["claude-sonnet-5"], tasks=["plan"]
    )
    assert check_references(DOCUMENT, catalogue) == []


def test_each_kind_of_unknown_reference_is_reported_at_its_own_field() -> None:
    warnings = check_references(DOCUMENT, Catalogue(skills=[], models=[], tasks=[]))
    assert [(w.code, w.path, w.node) for w in warnings] == [
        (DslWarningCode.REFERENCE_UNKNOWN_SKILL, "/nodes/0/config/skill", "a"),
        (
            DslWarningCode.REFERENCE_UNKNOWN_MODEL,
            "/nodes/0/config/routing/pinned_model",
            "a",
        ),
        (
            DslWarningCode.REFERENCE_UNKNOWN_TASK,
            "/nodes/1/config/routing/inherit_task",
            "b",
        ),
    ]
    assert "repo-map" in warnings[0].message


def test_an_absent_member_list_means_not_checked_rather_than_empty() -> None:
    # A caller that can enumerate skills but not models says so by supplying only `skills`.
    warnings = check_references(DOCUMENT, Catalogue(skills=[]))
    assert [w.code for w in warnings] == [DslWarningCode.REFERENCE_UNKNOWN_SKILL]


def test_nothing_is_said_about_a_node_that_is_not_a_model_stage() -> None:
    # `runner_pool` is a property of a deployment's build farm, not of the workspace's
    # catalogues, so it is deliberately outside decision P7's question.
    build = WorkflowNode(
        id="build",
        type="infra",
        title="Build",
        position=Position(x=0, y=0),
        config=InfraConfig(runner_pool="pool-nobody-has"),
    )
    catalogue = Catalogue(skills=[], models=[], tasks=[])
    assert check_references(document([build]), catalogue) == []


def test_nothing_is_said_about_a_prompt_mode_stage_that_names_no_skill() -> None:
    doc = document([llm("a", routing=LlmRouting(inherit_task="plan"))])
    assert check_references(doc, Catalogue(skills=[], tasks=["plan"])) == []
