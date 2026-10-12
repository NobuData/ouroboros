"""The copilot certification suite: the call validator's matrix, and the turn's goldens (CD.6, #564).

The engine's half of *"an operation that does not validate never lands"* is narrow and worth
pinning for exactly that reason: :class:`~ouroboros_engine.copilot.parser.TurnParser` checks
that a call names a tool of the manifest and that its arguments fit that tool's model, and
reports anything else as a call carrying an ``error`` — which ``ouroboros-rest`` bounces.
Whether a node, an edge or a trigger is *valid DSL* is ``ouroboros-rest``'s validator's
answer (WF-P.2), and is certified there.

Two things are held here, both through a whole turn rather than the parser alone:

* **the validator matrix** — every call that must bounce does, every tool of the manifest is
  swept, and each of the validator's two checks is switched off in turn to prove the matrix's
  own check then fails;
* **the turn's goldens** — prose and calls arrive in the order the model wrote them however
  the provider fragments the text, a bounced call is reported in its place rather than
  dropped, usage and cost are carried per hop, and a turn ends exactly once.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneRequest,
)
from ouroboros_engine.copilot import parser
from ouroboros_engine.copilot.contract import (
    GATEWAY_UNREACHABLE,
    CopilotDelta,
    CopilotDone,
    CopilotError,
    CopilotEvent,
    CopilotToolCall,
    CopilotTurnRequest,
    CopilotUsage,
)
from ouroboros_engine.copilot.gateway import GatewayError
from ouroboros_engine.copilot.tools import (
    MANIFEST,
    OPERATION_KINDS,
    WRITE_TOOLS,
    Tool,
    tool_named,
)
from ouroboros_engine.copilot.turn import CopilotTurnRunner

SESSION = "5eed008a-0000-4000-8000-000000000001"


class ScriptedGateway:
    """Answers with scripted lines, then — if told to — dies as a dropped connection would."""

    def __init__(
        self, lines: list[dict[str, Any]], *, then: GatewayError | None = None
    ) -> None:
        """Script the answer."""
        self.lines = lines
        self.then = then

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:  # noqa: ARG002 - the protocol's signature
        """Answer the script."""
        for line in self.lines:
            yield json.dumps(line) + "\n"
        if self.then is not None:
            raise self.then


def _turn(
    lines: list[dict[str, Any]], *, then: GatewayError | None = None
) -> list[CopilotEvent]:
    """Run one turn against scripted gateway lines and collect every event."""
    request = CopilotTurnRequest.model_validate(
        {
            "alias": "coder-max",
            "session": SESSION,
            "context": {"draft": None},
            "transcript": [{"role": "user", "text": "security patches: second review"}],
        }
    )
    runner = CopilotTurnRunner(
        ControlPlaneClient("http://rest:4000", "secret"),
        ScriptedGateway(lines, then=then),
    )
    return list(runner.run(request))


def _deltas(*fragments: str) -> list[dict[str, Any]]:
    """The gateway's ``delta`` lines for a reply sent in these fragments."""
    return [{"kind": "delta", "hop": 0, "text": text} for text in fragments]


DONE = {"kind": "done", "hop": 0, "finish_reason": "end_turn"}


def _block(name: object, arguments: object) -> str:
    """A fenced tool block, closed, on lines of its own."""
    return "```tool\n" + json.dumps({"tool": name, "arguments": arguments}) + "\n```\n"


# -- the validator matrix -----------------------------------------------------------------

#: The check that refuses a name the manifest does not hold.
MANIFEST_MEMBERSHIP = "manifest_membership"

#: The check that refuses arguments the tool's own model does not accept.
ARGUMENT_SCHEMA = "argument_schema"

#: The smallest valid arguments of every tool of the manifest.
MINIMAL: dict[str, dict[str, Any]] = {
    "add_stage": {"node": {"id": "review-second", "type": "llm"}},
    "set_stage": {"node": {"id": "review-second", "type": "llm"}},
    "remove_stage": {"id": "review-second"},
    "add_edge": {"edge": {"from": "test", "to": "review-second", "kind": "default"}},
    "remove_edge": {"from": "test", "to": "review-second"},
    "set_trigger": {"trigger": {"event": "ticket_queued"}},
    "set_guard": {"guard": "spend_guard"},
    "ask_user": {"prompt": "What triggers it?", "options": ["a label", "a title"]},
    "read_draft": {},
    "read_catalog": {},
    "read_skills": {},
    "lookup_tickets": {},
    "propose_dry_run": {"ticket": "#489", "reason": "no CVE: a useful edge case"},
    "propose_suggestion": {
        "title": "Skip exploit-verify when there is no CVE",
        "body": "exploit-verify had nothing to do on #489.",
        "ops": [{"kind": "remove_stage", "params": {"id": "exploit-verify"}}],
    },
}


@dataclasses.dataclass(frozen=True, slots=True)
class Bounce:
    """One call that must not come out of a turn as a valid call.

    Attributes:
        validator: Which of the parser's checks must refuse it.
        what: What is being attempted, for the test id.
        tool: The tool named.
        arguments: What it is called with.
    """

    validator: str
    what: str
    tool: str
    arguments: object

    @property
    def label(self) -> str:
        """The row's test id."""
        return f"{self.validator}:{self.what}"


#: Calls no tool of the manifest answers to — the things the copilot must not be able to do.
UNLISTED: tuple[Bounce, ...] = tuple(
    Bounce(MANIFEST_MEMBERSHIP, name.strip() or "blank", name, arguments)
    for name, arguments in (
        ("publish", {}),
        ("publish_workflow", {"version": "v0.4"}),
        ("save_draft", {"definition": {"nodes": []}}),
        ("set_definition", {"definition": {"nodes": []}}),
        ("write_file", {"path": "workflow.json", "content": "{}"}),
        ("start_dry_run", {"ticket": "#489"}),
        ("run_workflow", {"ticket": "#489"}),
        ("execute", {"command": "git push"}),
        ("merge_pr", {"number": 504}),
        ("accept_suggestion", {"id": "s-1"}),
        ("ADD_STAGE", MINIMAL["add_stage"]),
        ("add_stage ", MINIMAL["add_stage"]),
        ("", {}),
    )
)

#: Every tool of the manifest, called with one key more than its model declares.
SMUGGLED: tuple[Bounce, ...] = tuple(
    Bounce(
        ARGUMENT_SCHEMA,
        f"{tool.name} with an undeclared key",
        tool.name,
        {**MINIMAL[tool.name], "definition": {"nodes": [], "edges": []}},
    )
    for tool in MANIFEST
)

#: Arguments of the wrong shape, tool by tool.
MISSHAPEN: tuple[Bounce, ...] = (
    Bounce(ARGUMENT_SCHEMA, "a node that is not an object", "add_stage", {"node": 7}),
    Bounce(ARGUMENT_SCHEMA, "a stage with no node", "set_stage", {}),
    Bounce(
        ARGUMENT_SCHEMA, "an id outside the grammar", "remove_stage", {"id": "../x"}
    ),
    Bounce(ARGUMENT_SCHEMA, "an edge that is a string", "add_edge", {"edge": "a->b"}),
    Bounce(ARGUMENT_SCHEMA, "an edge with one end", "remove_edge", {"from": "test"}),
    Bounce(ARGUMENT_SCHEMA, "a trigger that is a list", "set_trigger", {"trigger": []}),
    Bounce(ARGUMENT_SCHEMA, "a guard with no name", "set_guard", {"guard": ""}),
    Bounce(
        ARGUMENT_SCHEMA,
        "a question with one option",
        "ask_user",
        {"prompt": "Sure?", "options": ["yes"]},
    ),
    Bounce(
        ARGUMENT_SCHEMA, "a lookup past its limit", "lookup_tickets", {"limit": 500}
    ),
    Bounce(
        ARGUMENT_SCHEMA,
        "a dry run with no reason",
        "propose_dry_run",
        {"ticket": "#489"},
    ),
    Bounce(
        ARGUMENT_SCHEMA,
        "a suggestion that publishes",
        "propose_suggestion",
        {**MINIMAL["propose_suggestion"], "ops": [{"kind": "publish", "params": {}}]},
    ),
    Bounce(
        ARGUMENT_SCHEMA,
        "a suggestion with no operations",
        "propose_suggestion",
        {**MINIMAL["propose_suggestion"], "ops": []},
    ),
)

BOUNCES: tuple[Bounce, ...] = UNLISTED + SMUGGLED + MISSHAPEN


def certify(row: Bounce) -> None:
    """Hold one row: a turn reports the call as bounced, in its place, and still finishes.

    Args:
        row: The call.

    Raises:
        AssertionError: When the call came out of the turn as a valid call, was dropped, or
            disturbed the prose around it.
    """
    reply = "Doing that now.\n" + _block(row.tool, row.arguments) + "Done.\n"
    events = _turn([*_deltas(reply), DONE])

    assert [type(event) for event in events] == [
        CopilotDelta,
        CopilotToolCall,
        CopilotDelta,
        CopilotDone,
    ], f"{row.label} was not reported as one call"
    before, call, after, _ = events
    assert (before.text, after.text) == ("Doing that now.\n", "Done.\n")
    assert isinstance(call, CopilotToolCall)
    assert (call.id, call.tool) == ("call-1", row.tool)
    assert call.arguments is None, f"{row.label} came out with arguments"
    assert call.error, f"{row.label} came out with no error to bounce on"


@pytest.mark.parametrize("row", BOUNCES, ids=lambda row: row.label)
def test_a_call_that_does_not_validate_is_reported_as_bounced(row: Bounce) -> None:
    """Every row of the validator matrix leaves the turn as a call with an error."""
    certify(row)


@pytest.mark.parametrize("tool", MANIFEST, ids=lambda tool: tool.name)
def test_every_tool_of_the_manifest_is_accepted_with_valid_arguments(
    tool: Tool,
) -> None:
    """The matrix is not red for everything: each tool's valid call comes out clean."""
    events = _turn([*_deltas(_block(tool.name, MINIMAL[tool.name])), DONE])

    [call, done] = events
    assert isinstance(call, CopilotToolCall) and isinstance(done, CopilotDone)
    assert (call.tool, call.error) == (tool.name, None)
    assert call.arguments == tool.arguments.model_validate(
        MINIMAL[tool.name]
    ).model_dump(by_alias=True)


def test_the_matrix_covers_the_whole_manifest_and_both_checks() -> None:
    """A tool added to the manifest without a row here, or a check without rows, is red."""
    assert set(MINIMAL) == {tool.name for tool in MANIFEST}
    assert {row.tool for row in SMUGGLED} == {tool.name for tool in MANIFEST}
    assert set(OPERATION_KINDS) == WRITE_TOOLS <= {row.tool for row in MISSHAPEN}
    assert {row.validator for row in BOUNCES} == set(DISABLED)
    # Nothing the matrix calls unlisted has quietly become a tool.
    assert not [row.tool for row in UNLISTED if tool_named(row.tool) is not None]


class _Anything(BaseModel):
    """An argument model that accepts whatever it is given."""

    model_config = ConfigDict(extra="allow")


def _without_manifest_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the manifest check off: a name nobody listed resolves to a tool."""
    monkeypatch.setattr(
        parser,
        "tool_named",
        lambda name: tool_named(name) or Tool(name, "", _Anything, writes=True),  # type: ignore[arg-type]
    )


def _without_the_argument_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the argument check off: a listed tool takes any arguments."""

    def permissive(name: str) -> Tool | None:
        tool = tool_named(name)
        return None if tool is None else dataclasses.replace(tool, arguments=_Anything)  # type: ignore[arg-type]

    monkeypatch.setattr(parser, "tool_named", permissive)


#: How to switch each of the validator's checks off.
DISABLED: dict[str, Callable[[pytest.MonkeyPatch], None]] = {
    MANIFEST_MEMBERSHIP: _without_manifest_membership,
    ARGUMENT_SCHEMA: _without_the_argument_schema,
}


@pytest.mark.parametrize("validator", list(DISABLED))
def test_removing_a_check_turns_its_rows_red_and_only_its_rows(
    validator: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With one check switched off, the matrix's own check fails for each of its rows."""
    DISABLED[validator](monkeypatch)

    for row in BOUNCES:
        if row.validator == validator:
            with pytest.raises(AssertionError):
                certify(row)
        else:
            certify(row)


# -- the turn's goldens -------------------------------------------------------------------

#: A reply with everything in it: prose, a good call, two bounced ones, a block that is not
#: JSON, a question, and a last line with no newline.
REPLY = (
    "Adding a second review.\n"
    + _block("add_stage", MINIMAL["add_stage"])
    + "Then I will publish it.\n"
    + _block("publish", {})
    + _block("remove_edge", {"from": "test"})
    + "```tool\nnot json at all\n```\n"
    + "\n"
    + _block("ask_user", MINIMAL["ask_user"])
    + "Which one?"
)

#: What that reply is, event by event: ``(kind, text)`` or ``(kind, id, tool, bounced)``.
GOLDEN: list[tuple[Any, ...]] = [
    ("delta", "Adding a second review.\n"),
    ("tool_call", "call-1", "add_stage", False),
    ("delta", "Then I will publish it.\n"),
    ("tool_call", "call-2", "publish", True),
    ("tool_call", "call-3", "remove_edge", True),
    ("tool_call", "call-4", "unknown", True),
    ("delta", "\n"),
    ("tool_call", "call-5", "ask_user", False),
    ("delta", "Which one?"),
    ("done", "end_turn"),
]


def _shape(events: list[CopilotEvent]) -> list[tuple[Any, ...]]:
    """Reduce a turn's events to the golden's rows."""
    rows: list[tuple[Any, ...]] = []
    for event in events:
        if isinstance(event, CopilotDelta):
            rows.append(("delta", event.text))
        elif isinstance(event, CopilotToolCall):
            assert (event.error is None) != (event.arguments is None)
            rows.append(("tool_call", event.id, event.tool, event.error is not None))
        elif isinstance(event, CopilotDone):
            rows.append(("done", event.finish_reason))
        elif isinstance(event, CopilotError):
            rows.append(("error", event.code))
        else:
            rows.append(("usage", event.cost_cents))
    return rows


def _chunks(text: str, size: int) -> list[str]:
    """Cut text into fragments of one size."""
    return [text[at : at + size] for at in range(0, len(text), size)]


@pytest.mark.parametrize("size", [1, 2, 3, 5, 7, 11, 64, len(REPLY)])
def test_prose_and_calls_arrive_in_the_order_the_model_wrote_them(size: int) -> None:
    """The reply's events are the golden, whatever size of fragment it streams in."""
    events = _turn([*_deltas(*_chunks(REPLY, size)), DONE])

    assert _shape(events) == GOLDEN


def test_no_split_of_the_reply_changes_or_drops_an_event() -> None:
    """Cutting the reply in two at every possible place yields the same events each time."""
    whole = _turn([*_deltas(REPLY), DONE])

    for at in range(1, len(REPLY)):
        assert _turn([*_deltas(REPLY[:at], REPLY[at:]), DONE]) == whole, at
    assert _shape(whole) == GOLDEN


def test_a_bounced_call_says_why_and_keeps_its_place_in_the_numbering() -> None:
    """Each bounced call carries a reason a model can correct from; none is swallowed."""
    calls = [
        e for e in _turn([*_deltas(REPLY), DONE]) if isinstance(e, CopilotToolCall)
    ]

    assert len(calls) == REPLY.count("```tool\n")
    assert [call.id for call in calls] == [f"call-{n}" for n in range(1, 6)]
    assert calls[0].arguments == MINIMAL["add_stage"]
    assert "no tool named 'publish'" in (calls[1].error or "")
    assert (calls[2].error or "").startswith("remove_edge arguments are invalid")
    assert "not valid JSON" in (calls[3].error or "")
    assert calls[4].arguments == MINIMAL["ask_user"]


def test_usage_and_cost_are_carried_per_hop_in_the_order_they_were_metered() -> None:
    """A turn that failed over reports each hop's tokens, cost, model and connection."""
    events = _turn(
        [
            {
                "kind": "hop",
                "hop": 0,
                "connection": "conn-primary",
                "outcome": "failed_over",
                "code": "provider_unavailable",
                "latency_ms": 900,
            },
            {
                "kind": "usage",
                "hop": 0,
                "connection": "conn-primary",
                "model": "claude-opus-5",
                "input_tokens": 1200,
                "output_tokens": 0,
                "cost_cents": 0.36,
            },
            {"kind": "delta", "hop": 1, "text": "Drafted it.\n"},
            {
                "kind": "usage",
                "hop": 1,
                "connection": "conn-local",
                "model": "qwen3-coder",
                "input_tokens": 1200,
                "output_tokens": 48,
                "cost_cents": None,
            },
            {"kind": "done", "hop": 1, "finish_reason": "stop"},
        ]
    )

    assert events == [
        CopilotUsage(
            kind="usage",
            input_tokens=1200,
            output_tokens=0,
            cost_cents=0.36,
            model="claude-opus-5",
            connection="conn-primary",
        ),
        CopilotDelta(kind="delta", text="Drafted it.\n"),
        CopilotUsage(
            kind="usage",
            input_tokens=1200,
            output_tokens=48,
            cost_cents=None,
            model="qwen3-coder",
            connection="conn-local",
        ),
        CopilotDone(kind="done", finish_reason="stop"),
    ]


#: Ways a turn can be cut short with a tool block still open.
CUT_SHORT: dict[str, dict[str, Any]] = {
    "the gateway reports an error": {
        "lines": [
            *_deltas('Adding.\n```tool\n{"tool": "add_st'),
            {"kind": "error", "hop": 0, "code": "cost_cap_exceeded", "message": "cap"},
        ],
        "code": "cost_cap_exceeded",
    },
    "the connection drops": {
        "lines": _deltas('Adding.\n```tool\n{"tool": "add_st'),
        "then": GatewayError(GATEWAY_UNREACHABLE, "stopped answering mid-stream"),
        "code": GATEWAY_UNREACHABLE,
    },
    "the stream just ends": {
        "lines": [*_deltas('Adding.\n```tool\n{"tool": "add_st'), DONE],
        "code": None,
    },
}


@pytest.mark.parametrize("how", list(CUT_SHORT))
def test_a_call_cut_off_mid_block_is_reported_before_the_turn_ends(how: str) -> None:
    """A half-written call is surfaced as a bounced call, then the turn ends exactly once."""
    case = CUT_SHORT[how]
    events = _turn(case["lines"], then=case.get("then"))
    ending = ("done", "end_turn") if case["code"] is None else ("error", case["code"])

    assert _shape(events) == [
        ("delta", "Adding.\n"),
        ("tool_call", "call-1", "unknown", True),
        ending,
    ]
    assert "never closed" in (events[1].error or "")  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "lines",
    [
        [*_deltas(REPLY), DONE],
        [
            *_deltas("Partial"),
            {"kind": "error", "code": "floor_exhausted", "message": "x"},
        ],
        [*_deltas("Partial"), {"kind": "surprise"}],
        [],
    ],
    ids=["a whole reply", "a gateway error", "a line outside the contract", "silence"],
)
def test_a_turn_ends_exactly_once_and_nothing_follows_the_ending(
    lines: list[dict[str, Any]],
) -> None:
    """However a turn goes, its last event is its only ``done`` or ``error``."""
    events = _turn(lines)
    endings = [e for e in events if isinstance(e, CopilotDone | CopilotError)]

    assert len(endings) == 1
    assert events[-1] is endings[0]
