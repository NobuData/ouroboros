"""The tool manifest — what the copilot may do, and the one way it may change anything.

``ops + {ask_user, reads, propose_dry_run} - no file writes, no publish, no execution`` is the
issue's own summary of this file, and ``tests/test_copilot_tools.py`` holds it to that: every
tool that writes is one of :data:`OPERATION_KINDS`, and nothing else writes.

* **The typed operations** are the only write path. Their arguments are the DSL's own objects
  (a node, an edge, the trigger) by reference, so a change arrives as a reviewable, attributable
  operation that ``ouroboros-rest`` validates against the DSL schema (WF-P.2, #133) *before*
  applying it under the draft's etag (WF-P.3, #134) with ``copilot`` provenance (CC.2, #556).
  ``set_guard`` is in the vocabulary because the mockup's *"cap spend at $5 a run"* has to land
  somewhere typed; DSL v1 has no guard construct, so ``ouroboros-rest`` records it as a
  *proposal* and the copilot says so.
* **``ask_user``** is the copilot declining to guess. Its options render as chips, and the
  person's choice re-enters the loop as a user turn.
* **The reads** ground a proposal in what exists; they write nothing.
* **``propose_dry_run``** is the *"#489 — no CVE, a useful edge case"* moment: a proposal
  recorded on the reply, never a run started (CD.4, #562, starts one).

The arguments are pydantic models so a call is validated here, once, with a message a model can
correct from — and so the manifest the model reads is rendered from the same models that check
what it sends back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Final

from pydantic import BaseModel, ConfigDict, Field

#: A stage id — the DSL's own ``node_id`` grammar.
NODE_ID_PATTERN: Final = r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"

#: The typed operation vocabulary — ``draft_operations.op.kind`` (V110) plus ``set_guard``.
OPERATION_KINDS: Final[tuple[str, ...]] = (
    "add_stage",
    "set_stage",
    "remove_stage",
    "add_edge",
    "remove_edge",
    "set_trigger",
    "set_guard",
)

#: The tool whose answer is a chip row.
ASK_USER: Final = "ask_user"
#: The reads.
READ_DRAFT: Final = "read_draft"
READ_CATALOG: Final = "read_catalog"
READ_SKILLS: Final = "read_skills"
LOOKUP_TICKETS: Final = "lookup_tickets"
#: The dry-run proposal.
PROPOSE_DRY_RUN: Final = "propose_dry_run"

#: How many chips one question may offer, at most.
MAX_OPTIONS: Final = 6


class _Arguments(BaseModel):
    """What every argument model shares: a key nobody declared is a validation message."""

    model_config = ConfigDict(extra="forbid")


class AddStageArguments(_Arguments):
    """``add_stage`` — a whole DSL node, which must not already exist."""

    node: dict[str, Any] = Field(
        description="The DSL v1 node: {id, type, title, description?, position, config}."
    )


class SetStageArguments(_Arguments):
    """``set_stage`` — a whole DSL node replacing the one with the same id."""

    node: dict[str, Any] = Field(
        description="The DSL v1 node, complete — the whole stage is replaced."
    )


class RemoveStageArguments(_Arguments):
    """``remove_stage`` — by id; its edges go with it."""

    id: Annotated[str, Field(pattern=NODE_ID_PATTERN)]


class AddEdgeArguments(_Arguments):
    """``add_edge`` — a whole DSL edge between two existing stages."""

    edge: dict[str, Any] = Field(
        description="The DSL v1 edge: {from, to, kind, label?, condition?}."
    )


class RemoveEdgeArguments(_Arguments):
    """``remove_edge`` — by its ordered pair."""

    model_config = ConfigDict(
        extra="forbid", validate_by_name=True, serialize_by_alias=True
    )

    from_: Annotated[str, Field(alias="from", pattern=NODE_ID_PATTERN)]
    to: Annotated[str, Field(pattern=NODE_ID_PATTERN)]


class SetTriggerArguments(_Arguments):
    """``set_trigger`` — the document's trigger, whole."""

    trigger: dict[str, Any] = Field(
        description="The DSL v1 trigger: {event: 'ticket_queued', conditions: {...}}."
    )


class SetGuardArguments(_Arguments):
    """``set_guard`` — a guard from the workspace's vocabulary, with its parameters."""

    guard: Annotated[str, Field(min_length=1, max_length=64)] = Field(
        description="A guard name from the context's guard vocabulary — e.g. spend_guard."
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="The guard's parameters — e.g. {per_run_cap_cents: 500}.",
    )


class AskUserArguments(_Arguments):
    """``ask_user`` — one question with two to six chips."""

    prompt: Annotated[str, Field(min_length=1, max_length=200)]
    options: Annotated[list[str], Field(min_length=2, max_length=MAX_OPTIONS)]


class NoArguments(_Arguments):
    """A read that takes nothing."""


class LookupTicketsArguments(_Arguments):
    """``lookup_tickets`` — open tickets matching a query, for a dry-run proposal."""

    query: Annotated[str, Field(max_length=200)] = ""
    limit: Annotated[int, Field(ge=1, le=10)] = 5


class ProposeDryRunArguments(_Arguments):
    """``propose_dry_run`` — one ticket and why it is a useful case."""

    ticket: Annotated[str, Field(min_length=1, max_length=255)] = Field(
        description="The ticket's display key — '#489'."
    )
    reason: Annotated[str, Field(min_length=1, max_length=400)]


@dataclass(frozen=True, slots=True)
class Tool:
    """One tool of the manifest.

    Attributes:
        name: What the model calls it by.
        purpose: One sentence for the model.
        arguments: The model its arguments validate against.
        writes: Whether a call changes the draft. The test over the manifest asserts this is
            true for exactly the typed operations.
    """

    name: str
    purpose: str
    arguments: type[_Arguments]
    writes: bool


#: Every tool the copilot has. Order is the order the manifest is rendered in.
MANIFEST: Final[tuple[Tool, ...]] = (
    Tool("add_stage", "Add a stage to the draft.", AddStageArguments, writes=True),
    Tool(
        "set_stage",
        "Replace an existing stage's whole definition (title, config, position).",
        SetStageArguments,
        writes=True,
    ),
    Tool(
        "remove_stage",
        "Remove a stage and every edge touching it.",
        RemoveStageArguments,
        writes=True,
    ),
    Tool("add_edge", "Connect two existing stages.", AddEdgeArguments, writes=True),
    Tool("remove_edge", "Disconnect two stages.", RemoveEdgeArguments, writes=True),
    Tool(
        "set_trigger",
        "Set what starts a run — the event and its conditions.",
        SetTriggerArguments,
        writes=True,
    ),
    Tool(
        "set_guard",
        "Propose a guard from the workspace's vocabulary (recorded as a proposal — "
        "the DSL has no guard construct yet; tell the user it is proposed, not enforced).",
        SetGuardArguments,
        writes=True,
    ),
    Tool(
        ASK_USER,
        "Ask the user one question with two to six short options; stop and wait for "
        "the answer rather than guessing.",
        AskUserArguments,
        writes=False,
    ),
    Tool(READ_DRAFT, "Read the draft as it is right now.", NoArguments, writes=False),
    Tool(
        READ_CATALOG,
        "Read the stage types the canvas offers.",
        NoArguments,
        writes=False,
    ),
    Tool(
        READ_SKILLS,
        "Read the skills defined in this workspace.",
        NoArguments,
        writes=False,
    ),
    Tool(
        LOOKUP_TICKETS,
        "Find open tickets to propose a dry run on.",
        LookupTicketsArguments,
        writes=False,
    ),
    Tool(
        PROPOSE_DRY_RUN,
        "Propose a dry run of the draft on one ticket, with the reason it is a useful case.",
        ProposeDryRunArguments,
        writes=False,
    ),
)

#: The names of every tool that changes the draft — by construction, the operation kinds.
WRITE_TOOLS: Final[frozenset[str]] = frozenset(
    tool.name for tool in MANIFEST if tool.writes
)

_BY_NAME: Final[dict[str, Tool]] = {tool.name: tool for tool in MANIFEST}


def tool_named(name: str) -> Tool | None:
    """Look a tool up.

    Args:
        name: What the model called.

    Returns:
        The tool, or ``None`` for a name the manifest does not hold.
    """
    return _BY_NAME.get(name)


def manifest_text() -> str:
    """Render the manifest for the system prompt.

    Returns:
        One block per tool: its name, its purpose and the JSON schema of its arguments —
        the same models :mod:`.parser` validates a call against.
    """
    blocks = []
    for tool in MANIFEST:
        schema = tool.arguments.model_json_schema(by_alias=True)
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        if properties:
            lines = []
            for field, spec in properties.items():
                marker = "required" if field in required else "optional"
                description = spec.get("description") or spec.get("title") or ""
                lines.append(f"    - {field} ({marker}): {description}".rstrip())
            arguments = "\n".join(lines)
        else:
            arguments = "    (no arguments)"
        blocks.append(f"- {tool.name}: {tool.purpose}\n{arguments}")
    return "\n".join(blocks)
