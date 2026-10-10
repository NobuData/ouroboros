"""The skill runner: the prompt, the validation, the one correction and the failures."""

import copy
import json
import re

import pytest
from pydantic import ValidationError

from ouroboros_engine.investigation.model import ModelFailureError
from ouroboros_engine.skills.contract import MAX_INPUT_BYTES, Roadmap, SkillRunRequest
from ouroboros_engine.skills.runner import (
    OUTPUT_RULES,
    SkillInputError,
    SkillOutputError,
    SkillRunner,
    item_keys,
    read_issue_bodies,
    read_roadmap,
    system_prompt,
)
from skills_fakes import (
    DOC,
    ROADMAP,
    ScriptedModel,
    fenced,
    issues_request,
    roadmap_request,
)


def test_a_roadmap_run_answers_the_validated_roadmap_and_its_usage() -> None:
    model = ScriptedModel(fenced(ROADMAP))

    result = SkillRunner(model).run(roadmap_request())

    assert result.skill == "create-roadmap"
    assert result.version == 3
    assert result.output == "roadmap"
    assert result.attempts == 1
    assert result.issues is None
    assert result.roadmap is not None
    assert result.roadmap.model_dump(mode="json") == ROADMAP
    assert [entry.cost_cents for entry in result.usage] == [1.5]


def test_the_procedure_is_the_system_prompt_and_the_input_the_question() -> None:
    model = ScriptedModel(json.dumps(ROADMAP))
    request = roadmap_request()

    SkillRunner(model).run(request)

    (call,) = model.calls
    assert call.system.startswith("Turn the brief into a roadmap of dated milestones.")
    assert call.system.endswith(OUTPUT_RULES["roadmap"])
    assert json.loads(call.messages[0]["content"]) == request.input
    assert (call.dry_run, call.stage_key, call.alias) == (
        DOC,
        "create-roadmap",
        "research",
    )
    assert call.resolution_version == "r1"
    assert call.cost_cap_cents == 100


def test_an_edited_procedure_cannot_change_the_output_rule() -> None:
    request = roadmap_request(
        skill={
            "slug": "create-roadmap",
            "version": 4,
            "body": "Answer in prose.  \n",
        }
    )

    assert (
        system_prompt(request) == f"Answer in prose.\n\n---\n{OUTPUT_RULES['roadmap']}"
    )


def test_an_invalid_answer_is_re_asked_once_with_what_was_wrong() -> None:
    broken = copy.deepcopy(ROADMAP)
    broken["milestones"][0]["items"][1]["key"] = "dock-mpc"
    model = ScriptedModel(json.dumps(broken), json.dumps(ROADMAP))

    result = SkillRunner(model).run(roadmap_request())

    assert result.attempts == 2
    assert len(result.usage) == 2
    second = model.calls[1]
    assert [message["role"] for message in second.messages] == [
        "user",
        "assistant",
        "user",
    ]
    assert "item keys must be unique" in second.messages[2]["content"]
    # The second call may spend only what the first left.
    assert second.cost_cap_cents == 98


def test_two_invalid_answers_are_an_output_error_carrying_the_usage() -> None:
    model = ScriptedModel("no object here", '{"title": ""}')

    with pytest.raises(SkillOutputError) as raised:
        SkillRunner(model).run(roadmap_request())

    assert "title" in raised.value.problem
    assert len(raised.value.usage) == 2
    assert len(model.calls) == 2


def test_a_failed_call_is_raised_with_everything_spent_so_far() -> None:
    model = ScriptedModel(
        "not json", ModelFailureError("gateway_unavailable", "The gateway is down.")
    )

    with pytest.raises(ModelFailureError) as raised:
        SkillRunner(model).run(roadmap_request())

    assert raised.value.code == "gateway_unavailable"
    assert len(raised.value.usage) == 1


def test_issue_bodies_come_back_in_the_inputs_order() -> None:
    model = ScriptedModel(
        json.dumps(
            {
                "issues": [
                    {"key": "dock-retry", "body": "Retry."},
                    {"key": "dock-mpc", "body": "MPC."},
                ]
            }
        )
    )

    result = SkillRunner(model).run(issues_request())

    assert result.roadmap is None
    assert [(issue.key, issue.body) for issue in result.issues or []] == [
        ("dock-mpc", "MPC."),
        ("dock-retry", "Retry."),
    ]


@pytest.mark.parametrize(
    ("answer", "problem"),
    [
        ({"issues": [{"key": "dock-mpc", "body": "MPC."}]}, "missing ['dock-retry']"),
        (
            {
                "issues": [
                    {"key": "dock-mpc", "body": "a"},
                    {"key": "dock-retry", "body": "b"},
                    {"key": "invented", "body": "c"},
                ]
            },
            "not asked for ['invented']",
        ),
        (
            {
                "issues": [
                    {"key": "dock-mpc", "body": "a"},
                    {"key": "dock-mpc", "body": "b"},
                ]
            },
            "described twice",
        ),
        ({"issues": "none"}, "must be a list"),
        ({"issues": [{"key": "dock-mpc", "body": ""}]}, "body"),
    ],
)
def test_issue_bodies_must_describe_exactly_the_items_asked_about(
    answer: dict, problem: str
) -> None:
    with pytest.raises(ValueError, match=re.escape(problem)):
        read_issue_bodies(answer, ["dock-mpc", "dock-retry"])


@pytest.mark.parametrize(
    "items",
    [None, [], "x", [{"title": "no key"}], [{"key": "a"}, {"key": "a"}], [3]],
)
def test_an_issue_run_without_keyed_items_calls_no_model(items: object) -> None:
    model = ScriptedModel()
    request = issues_request()
    request.input["items"] = items

    with pytest.raises(SkillInputError):
        SkillRunner(model).run(request)

    assert model.calls == []


def test_item_keys_are_read_in_order() -> None:
    assert item_keys(issues_request(["b", "a"])) == ["b", "a"]


def test_an_input_over_the_bound_is_refused_before_any_call() -> None:
    model = ScriptedModel()
    request = roadmap_request(input={"brief": "x" * MAX_INPUT_BYTES})

    with pytest.raises(SkillInputError, match="larger than"):
        SkillRunner(model).run(request)

    assert model.calls == []


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("title",), "   "),
        (("milestones",), []),
        (("milestones", 0, "key"), "M1"),
        (("milestones", 0, "name"), " "),
        (("milestones", 0, "target_date"), "2026-02-30"),
        (("milestones", 1, "key"), "m1"),
        (("milestones", 0, "items", 0, "effort"), "huge"),
        (("milestones", 0, "items", 0, "title"), " "),
        (("milestones", 0, "items", 0, "mvp"), None),
        (("milestones", 1, "items", 0, "key"), "dock-mpc"),
    ],
)
def test_a_roadmap_outside_the_documents_shape_is_refused(
    path: tuple, value: object
) -> None:
    answer = copy.deepcopy(ROADMAP)
    node = answer
    for part in path[:-1]:
        node = node[part]
    node[path[-1]] = value

    with pytest.raises(ValueError, match=r"\S"):
        read_roadmap(answer)


def test_a_roadmap_refuses_a_field_the_document_does_not_hold() -> None:
    answer = copy.deepcopy(ROADMAP)
    answer["milestones"][0]["items"][0]["ticket_id"] = "x"

    with pytest.raises(ValueError, match="ticket_id"):
        read_roadmap(answer)


def test_a_roadmap_holds_at_most_five_hundred_items() -> None:
    items = [
        {"key": f"i{index}", "title": "t", "mvp": False, "effort": None}
        for index in range(251)
    ]
    with pytest.raises(ValidationError, match="at most 500 items"):
        Roadmap.model_validate(
            {
                "title": "Big",
                "milestones": [
                    {"key": "a", "name": "A", "target_date": None, "items": items},
                    {
                        "key": "b",
                        "name": "B",
                        "target_date": None,
                        "items": [{**item, "key": "j" + item["key"]} for item in items],
                    },
                ],
            }
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"output": "prose"},
        {"alias": ""},
        {"run": ""},
        {"skill": {"slug": "Create Roadmap", "version": 1, "body": "x"}},
        {"skill": {"slug": "create-roadmap", "version": 0, "body": "x"}},
        {"skill": {"slug": "create-roadmap", "version": 1, "body": ""}},
        {"cost_cap_cents": -1},
        {"extra": True},
    ],
)
def test_a_malformed_request_does_not_validate(changes: dict) -> None:
    with pytest.raises(ValidationError):
        roadmap_request(**changes)


def test_the_request_round_trips() -> None:
    request = roadmap_request()

    assert SkillRunRequest.model_validate(request.model_dump(mode="json")) == request
