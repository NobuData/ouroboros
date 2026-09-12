"""The workflow DSL in pydantic — the shapes, and the two stages they are applied in.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.schema.ts``. The published
contract is ``schemas/workflow-dsl/v1.json``; this file is that schema written in the language
this service validates in, and ``tests/test_workflows_conformance.py`` is what holds the two
together.

**Why the document is validated in two stages** rather than as one nested model. A node's
``config`` shape depends on its ``type``, and so does a predicate's on its ``kind`` and a
terminal's options on its ``action``. Both pydantic and zod can express that — pydantic with a
tagged ``Union``, zod with ``discriminatedUnion`` — and the two libraries anchor the resulting
errors at *different* places: pydantic reports an unknown tag at the object and prepends the
matched tag to every path underneath it, zod reports it at the discriminator. Since the anchor
is half of what the two validators have to agree on, the dispatch is done by hand on both
sides instead: :class:`WorkflowRoot` validates the frame, :class:`NodeShape` and
:class:`EdgeShape` each element, and :data:`NODE_CONFIG_MODELS` is applied afterwards by
:mod:`ouroboros_engine.workflows.validate`.

**Every model is strict and closed.** ``strict=True`` because pydantic's lax mode would accept
``"12"`` where the document says a number and zod would not, and a validator that accepts what
the other refuses is the divergence this whole design exists to prevent; ``extra="forbid"``
because every object in the DSL is closed, so an undeclared property is named rather than
dropped. The one relaxation is :data:`Integer`, and it exists for the opposite reason: JSON's
``2.0`` *is* an integer (RFC 8259, and JSON Schema's ``"type": "integer"`` says so), JavaScript
cannot tell it from ``2``, and Python's ``json`` module makes it a ``float``. Without the
coercion the two validators would disagree about a document neither author would call
ambiguous.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Final, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

#: The ``dsl_version`` values this build implements — the 1.x minors ``v1.json`` lists.
SUPPORTED_DSL_VERSIONS: Final[tuple[str, ...]] = ("1.0",)

#: A node id: a slug, unique in the document, that edges and run journals both quote.
NODE_ID_PATTERN: Final = r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"

#: How much work a ticket is, in the vocabulary ``issue_estimates.effort`` stores.
Effort = Literal["xs", "s", "m", "l", "xl"]

#: Which tracker a ticket came from, in the vocabulary ``ticket_sources.kind`` stores.
SourceKind = Literal["github", "gitlab", "jira", "linear"]


def _integral(value: object) -> object:
    """Read JSON's ``2.0`` as the integer it is.

    Args:
        value: A value on its way into an integer field.

    Returns:
        The value as an ``int`` when it is a float with nothing after the point, and unchanged
        otherwise — including for ``bool``, which is an ``int`` in Python and a mistake here.
    """
    if type(value) is float and value.is_integer():
        return int(value)
    return value


#: An integer, read the way JSON means one.
Integer = Annotated[int, BeforeValidator(_integral)]

#: A skill name, a model identifier or a task-route name (decision **P7**: a string).
Reference = Annotated[str, Field(min_length=1, max_length=128)]

#: A ticket label, as a tracker spells it.
Label = Annotated[str, Field(min_length=1, max_length=64)]

#: One node's id.
NodeId = Annotated[str, Field(pattern=NODE_ID_PATTERN)]


class _Model(BaseModel):
    """The configuration every model in this file shares.

    Strict and closed, for the reasons the module docstring gives. Stated once so that a model
    added later cannot quietly be neither.
    """

    model_config = ConfigDict(extra="forbid", strict=True)


class Position(_Model):
    """Where a node sits on the canvas."""

    x: float = Field(ge=-100000, le=100000)
    y: float = Field(ge=-100000, le=100000)


class TriggerConditions(_Model):
    """What has to hold for the trigger to fire — all present conditions, ANDed.

    An empty object is a trigger that fires on every occurrence of its event, which is a thing
    an author may legitimately mean.
    """

    effort_lte: Effort | None = None
    labels: Annotated[list[Label], Field(min_length=1, max_length=32)] | None = None
    source: SourceKind | None = None


class Trigger(_Model):
    """What starts a run — decision **P8**, structured rather than free code."""

    event: Literal["ticket_queued"]
    conditions: TriggerConditions


class AlwaysPredicate(_Model):
    """A test that always holds — the *otherwise* branch of a decision."""

    kind: Literal["always"]


class EffortPredicate(_Model):
    """A test on the ticket's effort, as the mockup's ``≤ M`` chip reads it."""

    kind: Literal["effort"]
    op: Literal["lt", "lte", "eq", "gte", "gt"]
    value: Effort


class LabelsPredicate(_Model):
    """A test on the ticket's labels."""

    kind: Literal["labels"]
    op: Literal["any", "all", "none"]
    values: Annotated[list[Label], Field(min_length=1, max_length=32)]


class SourcePredicate(_Model):
    """A test on which tracker the ticket came from."""

    kind: Literal["source"]
    op: Literal["in", "not_in"]
    values: Annotated[list[SourceKind], Field(min_length=1, max_length=4)]


class ChecksPredicate(_Model):
    """A test on the run's check results.

    ``names`` absent means every check the run produced — the mockup's ``required checks: 14``
    is a count of what a repository declares, not a list this document pins.
    """

    kind: Literal["checks"]
    op: Literal["all_passed", "any_failed"]
    names: (
        Annotated[
            list[Annotated[str, Field(min_length=1, max_length=128)]],
            Field(min_length=1, max_length=64),
        ]
        | None
    ) = None


#: One structured test. Flat by design: composition would need recursion in three validators,
#: and the canvas draws branches rather than boolean trees.
Predicate = (
    AlwaysPredicate
    | EffortPredicate
    | LabelsPredicate
    | SourcePredicate
    | ChecksPredicate
)

#: The predicate models, by ``kind`` — the table the hand-written dispatch reads.
PREDICATE_MODELS: Final[dict[str, type[BaseModel]]] = {
    "always": AlwaysPredicate,
    "effort": EffortPredicate,
    "labels": LabelsPredicate,
    "source": SourcePredicate,
    "checks": ChecksPredicate,
}


class TriggerConfig(_Model):
    """The trigger node configures nothing: its predicate is the document's own ``trigger``.

    Closed and empty on purpose — a field put here would be a second place to look for the
    thing the root already holds.
    """


class LlmRouting(_Model):
    """The inspector's Model routing radios.

    Both members are optional here and the exclusivity is
    :mod:`ouroboros_engine.workflows.validate`'s, because *neither* and *both* are two
    different mistakes an author makes and each has a code of its own.
    """

    inherit_task: Reference | None = None
    pinned_model: Reference | None = None


class LlmLimits(_Model):
    """What a model stage may spend.

    ``token_budget`` is a number of tokens; the inspector renders 400000 as ``400k``, and the
    formatting is the UI's and never the document's.
    """

    max_retries: Integer = Field(ge=0, le=10)
    token_budget: Integer = Field(ge=1000, le=10000000)


class LlmPermissions(_Model):
    """Decision **P9**: enforced declarations.

    Both are required and neither defaults, because a permission nobody decided is a permission
    nobody can be held to. Enforcement itself lands with the interpreter (T.6).
    """

    push_fixup: bool
    touch_ci: bool


class LlmConfig(_Model):
    """A model stage's config — the inspector's exact field set (mockup 04).

    ``skill`` is declared optional and made conditional by
    :mod:`ouroboros_engine.workflows.validate`, which is where ``config.skill_required`` and
    ``config.skill_not_allowed`` are reported: a model validator's failure carries a
    ``value_error`` that says nothing about which rule broke, and the codes are what the parity
    fixtures record.
    """

    mode: Literal["prompt", "skill"]
    skill: Reference | None = None
    prompt_template: Annotated[str, Field(min_length=1, max_length=20000)]
    routing: LlmRouting
    limits: LlmLimits
    permissions: LlmPermissions


class InfraConfig(_Model):
    """A build-farm or test stage's config.

    Both fields are optional, as the issue specifies: a stage with neither runs the
    repository's default command on the default pool, and which pool that is belongs to a
    deployment rather than to a document a workspace publishes once and runs everywhere.
    """

    runner_pool: Reference | None = None
    command: Annotated[str, Field(min_length=1, max_length=2000)] | None = None


class FlowConfigShape(_Model):
    """A fork's config, with its predicate still opaque.

    ``decision`` diverges and ``gate`` holds; the difference is topological — it is what the
    edges say — so neither restricts which predicate kinds it accepts.
    """

    kind: Literal["decision", "gate"]
    predicate: dict[str, object]


@dataclass(frozen=True, slots=True)
class FlowConfig:
    """A fork's config, once its predicate has been dispatched."""

    #: Whether the fork diverges (``decision``) or holds (``gate``).
    kind: str
    #: What it evaluates.
    predicate: BaseModel


class OpenPrAutomergeOptions(_Model):
    """What the mockup's ``squash · delete branch`` chip prints, as fields."""

    merge_method: Literal["squash", "merge", "rebase"]
    delete_branch: bool


class BackToQueueOptions(_Model):
    """Nothing configures returning a ticket to the queue.

    Closed and empty so that adding an option is an edit to the published schema rather than a
    field that quietly appears in stored documents.
    """


class NeedsReviewOptions(_Model):
    """Nothing configures handing a run to a person. See :class:`BackToQueueOptions`."""


#: The per-action option models for a terminal.
TERM_OPTION_MODELS: Final[dict[str, type[BaseModel]]] = {
    "open_pr_automerge": OpenPrAutomergeOptions,
    "back_to_queue": BackToQueueOptions,
    "needs_review": NeedsReviewOptions,
}


class TermConfigShape(_Model):
    """A terminal's config, with its options still opaque."""

    action: Literal["open_pr_automerge", "back_to_queue", "needs_review"]
    options: dict[str, object]


@dataclass(frozen=True, slots=True)
class TermConfig:
    """Where a run ends, once its options have been dispatched."""

    #: Which of the three actions it is.
    action: str
    #: The options for that action.
    options: BaseModel


#: The per-type config models, applied after a node's skeleton parses.
#:
#: ``flow`` and ``term`` are the *shape* models: their own tagged members are dispatched a
#: second time, by the same helper and for the same reason.
NODE_CONFIG_MODELS: Final[dict[str, type[BaseModel]]] = {
    "trigger": TriggerConfig,
    "llm": LlmConfig,
    "infra": InfraConfig,
    "flow": FlowConfigShape,
    "term": TermConfigShape,
}


class NodeShape(_Model):
    """One node's skeleton — everything but the type-dependent config."""

    id: NodeId
    type: Literal["trigger", "llm", "infra", "flow", "term"]
    title: Annotated[str, Field(min_length=1, max_length=80)]
    description: Annotated[str, Field(max_length=400)] | None = None
    position: Position
    config: dict[str, object]


class EdgeShape(_Model):
    """One edge's skeleton, with its condition still opaque.

    An edge carries no id: it is identified by its ordered pair, which is also why at most one
    edge may join a given one.
    """

    from_: NodeId = Field(alias="from")
    to: NodeId
    kind: Literal["default", "branch", "loop"]
    label: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    condition: dict[str, object] | None = None


class WorkflowRoot(_Model):
    """The document's frame: the root properties, with both collections left opaque.

    Their elements are validated one at a time, so that a mistake in one node does not hide a
    different mistake in the next — a canvas that reports one error, is corrected, and then
    reports another is a canvas an author stops trusting.
    """

    dsl_version: Literal["1.0"]
    trigger: Trigger
    nodes: Annotated[list[object], Field(min_length=1, max_length=200)]
    edges: Annotated[list[object], Field(max_length=400)]


@dataclass(frozen=True, slots=True)
class WorkflowNode:
    """One stage, with its config dispatched to the model its type names."""

    #: The slug edges and run journals quote.
    id: str
    #: Which of the five types it is.
    type: str
    #: What the canvas prints as the node's name.
    title: str
    #: Where it sits on the canvas.
    position: Position
    #: The type-dependent configuration.
    config: TriggerConfig | LlmConfig | InfraConfig | FlowConfig | TermConfig
    #: The sentence the inspector prints under the title.
    description: str | None = None


@dataclass(frozen=True, slots=True)
class WorkflowEdge:
    """One connection, with its condition dispatched.

    ``from_`` rather than ``from`` for the reason :class:`.errors.EdgeAnchor` gives.
    """

    #: The id of the node the edge leaves.
    from_: str
    #: The id of the node the edge arrives at.
    to: str
    #: Which of the three kinds it is.
    kind: str
    #: What the canvas prints beside it. Presentation, never evaluated.
    label: str | None = None
    #: For a ``branch``, the test that selects it; for a ``loop``, the outcome it carries.
    condition: BaseModel | None = None


@dataclass(frozen=True, slots=True)
class WorkflowDocument:
    """A whole workflow definition, typed."""

    #: Which minor of the 1.x line the document is written against.
    dsl_version: str
    #: What starts a run.
    trigger: Trigger
    #: Every stage on the canvas.
    nodes: tuple[WorkflowNode, ...]
    #: Every connection between them.
    edges: tuple[WorkflowEdge, ...]
