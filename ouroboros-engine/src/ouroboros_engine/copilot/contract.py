"""``POST /v0/copilot-workflow``'s shapes — what one turn is sent, and what it streams back.

The request carries everything a turn needs and the engine keeps nothing between turns: the
routed alias ``ouroboros-rest`` resolved for the ``copilot-workflow`` task kind (Z.1), the
session the invocation is attributed to, the grounding context (the draft, the stage catalog,
the skills and task routes that exist, the guard vocabulary the enforcement planes honour) and
the transcript so far — the person's messages, the copilot's replies with their tool calls, and
the results ``ouroboros-rest`` produced for those calls.

The answer is ``application/x-ndjson``, one :data:`CopilotEvent` per line, written as the model
writes: ``delta`` lines are reply text, ``tool_call`` lines are the structured calls the parser
recovered, ``usage`` is what the gateway metered, ``error`` is a turn that could not be made
and ``done`` closes a turn that could.

Every request model is closed (``extra="forbid"``), like every request under ``/v0``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

#: A UUID, as ``copilot_sessions.id`` spells one.
UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

#: The longest message a person may send in one turn, in characters.
MAX_USER_TEXT_LENGTH = 20_000

#: The longest tool result ``ouroboros-rest`` may hand back — a draft document, rendered.
MAX_TOOL_RESULT_LENGTH = 200_000

#: The most transcript entries one turn may carry. A conversation longer than this is one
#: ``ouroboros-rest`` windows before sending.
MAX_TRANSCRIPT_LENGTH = 400

#: The gateway could not make the call because nothing implements invocation yet — AF.2
#: (#235) answers ``501 invocation_not_implemented`` until it lands. An honest state, not a
#: fault: the page ships this state rather than a reply nobody's model produced.
GATEWAY_UNAVAILABLE = "gateway_unavailable"

#: The gateway could not be reached at all — a refused connection, a timeout.
GATEWAY_UNREACHABLE = "gateway_unreachable"

#: The gateway answered with a refusal other than *not implemented*; the message carries its
#: code so an operator can read which.
GATEWAY_REFUSED = "gateway_refused"


class _Closed(BaseModel):
    """The configuration every model here shares: a property nobody declared is refused."""

    model_config = ConfigDict(extra="forbid")


class CatalogEntry(_Closed):
    """One stage type of the catalog (R.3, #145), as the copilot is told about it.

    Attributes:
        type: The DSL node type — ``trigger``, ``llm``, ``infra``, ``flow`` or ``term``.
        label: The catalog's display name.
        summary: One line on what a stage of this type does.
    """

    type: Literal["trigger", "llm", "infra", "flow", "term"]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    summary: Annotated[str, Field(max_length=400)] = ""


class GuardEntry(_Closed):
    """One guard the workspace's enforcement planes honour (the org policy's rules, BQ.2).

    The copilot proposes guards from this vocabulary and no other, so a *"cap spend at $5 a
    run"* becomes the ``spend_guard`` the executor actually checks rather than a word in a
    prompt.

    Attributes:
        name: The rule id — ``spend_guard``.
        description: What it does, for the model.
    """

    name: Annotated[str, Field(min_length=1, max_length=64)]
    description: Annotated[str, Field(max_length=400)] = ""


class CopilotContext(_Closed):
    """What grounds a turn: the draft and the names that exist.

    Attributes:
        draft: The shared draft as stored (WF-P.3), or ``None`` before the first operation.
        draft_label: The draft's revision as the head prints it — ``v0.3``.
        catalog: The stage types the canvas offers.
        skills: Every skill slug the registry holds (BF.1, #410). A skill the copilot names
            outside this list does not resolve — decision W7.
        tasks: Every task kind the routing table has a route for (Z.1). A stage inheriting a
            task outside this list does not resolve — W7 again.
        guards: The guard vocabulary; see :class:`GuardEntry`.
    """

    draft: dict[str, Any] | None = None
    draft_label: Annotated[str, Field(min_length=1, max_length=32)] = "v0.0"
    catalog: Annotated[list[CatalogEntry], Field(max_length=32)] = Field(
        default_factory=list
    )
    skills: Annotated[list[str], Field(max_length=500)] = Field(default_factory=list)
    tasks: Annotated[list[str], Field(max_length=200)] = Field(default_factory=list)
    guards: Annotated[list[GuardEntry], Field(max_length=32)] = Field(
        default_factory=list
    )


class ToolCall(_Closed):
    """One call a copilot reply made, as the transcript records it.

    Attributes:
        id: The call's id within its reply — ``call-1``.
        tool: Which tool, by :mod:`.tools` name.
        arguments: What it was called with, as the parser validated it.
    """

    id: Annotated[str, Field(min_length=1, max_length=32)]
    tool: Annotated[str, Field(min_length=1, max_length=64)]
    arguments: dict[str, Any] = Field(default_factory=dict)


class UserTurn(_Closed):
    """Something the person said — a typed message, or a chip they chose.

    Attributes:
        role: Always ``"user"``.
        text: What they said.
    """

    role: Literal["user"]
    text: Annotated[str, Field(min_length=1, max_length=MAX_USER_TEXT_LENGTH)]


class CopilotTurn(_Closed):
    """A reply the copilot already gave, with the calls it made.

    Attributes:
        role: Always ``"copilot"``.
        text: The reply's prose, which may be empty for a reply that only called tools.
        tool_calls: The calls, in the order they were made.
    """

    role: Literal["copilot"]
    text: Annotated[str, Field(max_length=MAX_TOOL_RESULT_LENGTH)] = ""
    tool_calls: Annotated[list[ToolCall], Field(max_length=64)] = Field(
        default_factory=list
    )


class ToolResultTurn(_Closed):
    """What ``ouroboros-rest`` answered one call with.

    A bounced operation is ``ok: false`` with the validator's message as ``content`` — that is
    the whole of the self-correction loop's feedback, and why the message is written for a model.

    Attributes:
        role: Always ``"tool"``.
        call_id: Which call this answers.
        ok: Whether the call succeeded.
        content: The result, or the reason it did not.
    """

    role: Literal["tool"]
    call_id: Annotated[str, Field(min_length=1, max_length=32)]
    ok: bool
    content: Annotated[str, Field(max_length=MAX_TOOL_RESULT_LENGTH)]


#: One entry of the transcript, told apart by ``role``.
TranscriptEntry = Annotated[
    UserTurn | CopilotTurn | ToolResultTurn, Field(discriminator="role")
]


class CopilotTurnRequest(_Closed):
    """The body of ``POST /v0/copilot-workflow``.

    Attributes:
        alias: The routing alias the ``copilot-workflow`` task kind resolved to — the chain's
            primary, which the gateway re-resolves on its own side (AD.3, decision 1).
        session: The copilot session this turn belongs to; the invocation is attributed to it.
        resolution_version: Z.1's ``resolution_version`` the alias was resolved under.
        cost_cap_cents: The per-run cap the resolution carried, when it carried one.
        context: What grounds the turn.
        transcript: The conversation so far, oldest first, ending in what the model is to
            answer — a person's message, or the results of its own last calls.
    """

    alias: Annotated[str, Field(min_length=1, max_length=64)]
    session: Annotated[str, Field(pattern=UUID_PATTERN)]
    resolution_version: Annotated[str, Field(min_length=1, max_length=32)] | None = None
    cost_cap_cents: Annotated[int, Field(ge=0)] | None = None
    context: CopilotContext
    transcript: Annotated[
        list[TranscriptEntry], Field(min_length=1, max_length=MAX_TRANSCRIPT_LENGTH)
    ]


class CopilotDelta(_Closed):
    """A fragment of reply text, as the model wrote it.

    Attributes:
        kind: Always ``"delta"``.
        text: The fragment.
    """

    kind: Literal["delta"]
    text: str


class CopilotToolCall(_Closed):
    """A structured call the parser recovered from the reply.

    Attributes:
        kind: Always ``"tool_call"``.
        id: The call's id within this reply — ``call-1``, ``call-2``.
        tool: The tool named, verbatim — even when it names nothing.
        arguments: The validated arguments, or ``None`` when the call did not validate.
        error: Why it did not validate, written for the model, or ``None`` when it did.
            ``ouroboros-rest`` bounces a call carrying one like any invalid operation.
    """

    kind: Literal["tool_call"]
    id: str
    tool: str
    arguments: dict[str, Any] | None = None
    error: str | None = None


class CopilotUsage(_Closed):
    """What one hop of the invocation metered — the gateway's ``usage`` event, forwarded.

    Attributes:
        kind: Always ``"usage"``.
        input_tokens: Tokens sent.
        output_tokens: Tokens received.
        cost_cents: What it cost, or ``None`` when nothing prices it. Never ``0`` for
            *unpriced*: an exchange nobody priced is recorded as null, not as free.
        model: The model as the provider names it.
        connection: The provider connection that served it.
    """

    kind: Literal["usage"]
    input_tokens: Annotated[int, Field(ge=0)]
    output_tokens: Annotated[int, Field(ge=0)]
    cost_cents: Annotated[float, Field(ge=0)] | None = None
    model: str
    connection: str


class CopilotError(_Closed):
    """A turn that could not be completed.

    Attributes:
        kind: Always ``"error"``.
        code: :data:`GATEWAY_UNAVAILABLE`, :data:`GATEWAY_UNREACHABLE`,
            :data:`GATEWAY_REFUSED`, or one of the gateway's own per-hop codes when the
            invocation stream reported one (``cost_cap_exceeded``, ``floor_exhausted``, …).
        message: A sentence for a person.
    """

    kind: Literal["error"]
    code: str
    message: str


class CopilotDone(_Closed):
    """The turn finished.

    Attributes:
        kind: Always ``"done"``.
        finish_reason: Why generation stopped, in the provider's own vocabulary.
    """

    kind: Literal["done"]
    finish_reason: str


#: One line of the streamed turn.
CopilotEvent = (
    CopilotDelta | CopilotToolCall | CopilotUsage | CopilotError | CopilotDone
)
