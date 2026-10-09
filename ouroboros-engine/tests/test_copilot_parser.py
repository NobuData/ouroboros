"""The turn parser — prose streams, fenced tool blocks become validated calls."""

from ouroboros_engine.copilot.contract import CopilotDelta, CopilotToolCall
from ouroboros_engine.copilot.parser import TurnParser

_ADD = '{"tool": "add_stage", "arguments": {"node": {"id": "exploit-verify"}}}'


def _run(*fragments: str) -> list:
    parser = TurnParser()
    events = []
    for fragment in fragments:
        events.extend(parser.feed(fragment))
    events.extend(parser.finish())
    return events


def test_prose_streams_line_by_line_and_the_tail_at_the_end() -> None:
    events = _run("Drafted ", "security-patch.\nTwo ", "questions:")
    assert events == [
        CopilotDelta(kind="delta", text="Drafted security-patch.\n"),
        CopilotDelta(kind="delta", text="Two questions:"),
    ]


def test_a_fenced_block_becomes_a_validated_call() -> None:
    events = _run("Adding it.\n```tool\n", _ADD, "\n```\n")
    assert events[0] == CopilotDelta(kind="delta", text="Adding it.\n")
    call = events[1]
    assert isinstance(call, CopilotToolCall)
    assert call.id == "call-1"
    assert call.tool == "add_stage"
    assert call.arguments == {"node": {"id": "exploit-verify"}}
    assert call.error is None


def test_a_fence_split_across_fragments_is_held_until_whole() -> None:
    events = _run("``", '`tool\n{"tool": "read_draft"', ', "arguments": {}}\n`', "``\n")
    assert [type(event) for event in events] == [CopilotToolCall]
    assert events[0].tool == "read_draft"
    assert events[0].arguments == {}


def test_calls_are_numbered_in_order() -> None:
    events = _run(
        "```tool\n",
        _ADD,
        "\n```\n",
        '```tool\n{"tool": "ask_user", "arguments": {"prompt": "What triggers it?", '
        '"options": ["label:security", "CVE pattern in title"]}}\n```\n',
    )
    assert [event.id for event in events] == ["call-1", "call-2"]
    assert events[1].tool == "ask_user"


def test_a_block_that_is_not_json_is_a_call_with_an_error() -> None:
    [call] = _run("```tool\nnot json\n```\n")
    assert call.tool == "unknown"
    assert call.arguments is None
    assert "not valid JSON" in call.error


def test_an_unknown_tool_is_named_in_the_error() -> None:
    [call] = _run('```tool\n{"tool": "publish", "arguments": {}}\n```\n')
    assert call.tool == "publish"
    assert call.arguments is None
    assert "no tool named 'publish'" in call.error


def test_invalid_arguments_carry_a_message_the_model_can_correct_from() -> None:
    [call] = _run(
        '```tool\n{"tool": "remove_stage", "arguments": {"stage": "x"}}\n```\n'
    )
    assert call.tool == "remove_stage"
    assert call.arguments is None
    assert "remove_stage arguments are invalid" in call.error
    assert "id" in call.error


def test_arguments_that_are_not_an_object_are_refused() -> None:
    [call] = _run('```tool\n{"tool": "read_draft", "arguments": []}\n```\n')
    assert call.error == '"arguments" must be an object'


def test_an_unterminated_fence_is_reported_when_the_stream_ends() -> None:
    [call] = _run("```tool\n", _ADD)
    assert call.tool == "unknown"
    assert "never closed" in call.error


def test_a_multi_line_body_is_joined() -> None:
    [call] = _run(
        '```tool\n{"tool": "lookup_tickets",\n "arguments": {"query": "security"}}\n```\n'
    )
    assert call.arguments == {"query": "security", "limit": 5}
