"""The tool manifest — the copilot's one write path, asserted over the manifest itself.

#559's second acceptance criterion: *the copilot has no write capability other than the
operation set — asserted by a test over the tool manifest.*
"""

import pytest
from pydantic import ValidationError

from ouroboros_engine.copilot.tools import (
    ASK_USER,
    LOOKUP_TICKETS,
    MANIFEST,
    OPERATION_KINDS,
    PROPOSE_DRY_RUN,
    PROPOSE_SUGGESTION,
    READ_CATALOG,
    READ_DRAFT,
    READ_SKILLS,
    WRITE_TOOLS,
    AskUserArguments,
    ProposeSuggestionArguments,
    RemoveEdgeArguments,
    manifest_text,
    tool_named,
)

#: The suggestion mockup 20 shows: put the PoC stage behind a branch on the `cve` label.
_SUGGESTION: dict = {
    "title": "Skip exploit-verify when the ticket has no CVE",
    "body": "exploit-verify had nothing to do on #489: the ticket carries no cve label.",
    "ops": [
        {"kind": "remove_edge", "params": {"from": "test", "to": "exploit-verify"}},
        {
            "kind": "add_edge",
            "params": {
                "edge": {
                    "from": "test",
                    "to": "exploit-verify",
                    "kind": "branch",
                    "condition": {"kind": "labels", "op": "any", "values": ["cve"]},
                }
            },
        },
    ],
}

_OP: dict = {"kind": "remove_stage", "params": {"id": "x"}}


def test_the_only_write_tools_are_the_typed_operations() -> None:
    assert set(OPERATION_KINDS) == WRITE_TOOLS


def test_every_operation_kind_is_a_tool_that_writes() -> None:
    for kind in OPERATION_KINDS:
        tool = tool_named(kind)
        assert tool is not None, kind
        assert tool.writes, kind


def test_no_read_question_or_proposal_writes() -> None:
    for name in (
        ASK_USER,
        READ_DRAFT,
        READ_CATALOG,
        READ_SKILLS,
        LOOKUP_TICKETS,
        PROPOSE_DRY_RUN,
        PROPOSE_SUGGESTION,
    ):
        tool = tool_named(name)
        assert tool is not None, name
        assert not tool.writes, name


def test_the_manifest_has_no_file_write_publish_or_execution_tool() -> None:
    names = {tool.name for tool in MANIFEST}
    for forbidden in (
        "write_file",
        "publish",
        "run",
        "execute",
        "save_draft",
        "set_definition",
    ):
        assert forbidden not in names


def test_names_are_unique() -> None:
    names = [tool.name for tool in MANIFEST]
    assert len(names) == len(set(names))


def test_every_argument_model_refuses_an_undeclared_key() -> None:
    for tool in MANIFEST:
        with pytest.raises(ValidationError):
            tool.arguments.model_validate({"undeclared": 1, **_minimal(tool.name)})


def test_the_rendered_manifest_names_every_tool_and_its_arguments() -> None:
    text = manifest_text()
    for tool in MANIFEST:
        assert f"- {tool.name}:" in text
    assert "- node (required)" in text
    assert "- from (required)" in text
    assert "(no arguments)" in text


def test_ask_user_needs_two_to_six_options() -> None:
    with pytest.raises(ValidationError):
        AskUserArguments.model_validate(
            {"prompt": "What triggers it?", "options": ["only"]}
        )
    with pytest.raises(ValidationError):
        AskUserArguments.model_validate(
            {"prompt": "Pick", "options": [str(n) for n in range(7)]}
        )
    asked = AskUserArguments.model_validate(
        {
            "prompt": "What triggers it?",
            "options": ["label:security", "CVE pattern in title"],
        }
    )
    assert asked.options == ["label:security", "CVE pattern in title"]


def test_remove_edge_speaks_the_document_spelling() -> None:
    parsed = RemoveEdgeArguments.model_validate(
        {"from": "test", "to": "review-primary"}
    )
    assert parsed.model_dump(by_alias=True) == {"from": "test", "to": "review-primary"}


def test_the_manifest_lists_the_suggestion_proposal_after_the_dry_run_proposal() -> (
    None
):
    names = [tool.name for tool in MANIFEST]

    assert names[-2:] == [PROPOSE_DRY_RUN, PROPOSE_SUGGESTION]
    assert tool_named(PROPOSE_SUGGESTION).arguments is ProposeSuggestionArguments
    text = manifest_text()
    assert "- propose_suggestion:" in text
    for field in ("title", "body", "ops"):
        assert f"- {field} (required)" in text


def test_a_suggestion_carries_a_title_a_body_and_typed_operations() -> None:
    parsed = ProposeSuggestionArguments.model_validate(_SUGGESTION)

    assert parsed.model_dump() == _SUGGESTION
    # What an operation's params hold is the DSL validator's question, not this model's.
    ProposeSuggestionArguments.model_validate(
        {**_SUGGESTION, "ops": [{"kind": "set_trigger", "params": {"anything": 1}}]}
    )


@pytest.mark.parametrize(
    "change",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "t" * 201},
        {"body": ""},
        {"body": " \n "},
        {"body": "b" * 2001},
        {"ops": []},
        {"ops": [_OP] * 51},
        {"ops": [{"kind": "set_guard", "params": {}}]},
        {"ops": [{"kind": "publish", "params": {}}]},
        {"ops": [{"kind": "remove_stage"}]},
        {"ops": [{**_OP, "confidence": 0.9}]},
    ],
)
def test_a_suggestion_out_of_bounds_is_refused(change: dict) -> None:
    with pytest.raises(ValidationError):
        ProposeSuggestionArguments.model_validate({**_SUGGESTION, **change})


def test_a_suggestion_may_carry_fifty_operations_and_the_longest_texts() -> None:
    parsed = ProposeSuggestionArguments.model_validate(
        {"title": "t" * 200, "body": "b" * 2000, "ops": [_OP] * 50}
    )
    assert len(parsed.ops) == 50


def test_an_unknown_tool_is_none() -> None:
    assert tool_named("publish") is None


def _minimal(name: str) -> dict:
    """The smallest valid arguments for a tool, so the undeclared key is the only problem."""
    return {
        "add_stage": {"node": {}},
        "set_stage": {"node": {}},
        "remove_stage": {"id": "test"},
        "add_edge": {"edge": {}},
        "remove_edge": {"from": "a", "to": "b"},
        "set_trigger": {"trigger": {}},
        "set_guard": {"guard": "spend_guard"},
        ASK_USER: {"prompt": "?", "options": ["a", "b"]},
        READ_DRAFT: {},
        READ_CATALOG: {},
        READ_SKILLS: {},
        LOOKUP_TICKETS: {},
        PROPOSE_DRY_RUN: {"ticket": "#489", "reason": "edge case"},
        PROPOSE_SUGGESTION: {
            "title": "t",
            "body": "b",
            "ops": [{"kind": "remove_stage", "params": {"id": "test"}}],
        },
    }[name]
