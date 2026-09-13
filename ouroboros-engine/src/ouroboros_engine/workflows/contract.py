"""``/v0/workflows``' shapes — what R.2's two operations accept, and what they answer.

R.2 (`#144 <https://github.com/NobuData/ouroboros/issues/144>`_). ``POST /v0/workflows/validate``
is the engine's opinion on a definition before it is published, and ``POST
/v0/workflows/dry-run`` is the simulator behind the studio's *Dry run with issue #485*. This
module is the part of both that ``ouroboros-rest`` is written against; *how* a verdict or a walk
is reached is :mod:`ouroboros_engine.workflows.validate` and
:mod:`ouroboros_engine.workflows.simulate`.

Three decisions are the contract rather than this build's taste:

* **A finding is a diagnostic, renamed at one boundary.** :class:`WorkflowFinding` carries the
  DSL's own ``code`` and ``path``, and its node anchor travels as ``node_id`` — the name #144
  gives it, and the name ``ouroboros-rest``'s ``engine.contract.ts`` already parses. An anchor
  that is absent is *omitted* rather than sent as ``null``, which is
  :meth:`.errors.Diagnostic.as_dict`'s rule for the same reason: a finding about the document as
  a whole and one whose anchor failed to resolve are not the same payload.
* **Warnings are not findings.** Decision **P7**'s reference warnings need a catalogue, neither
  request carries one, and a publish gate that has to filter findings by severity is one that
  will forget to. So ``findings`` is the verdict's errors and nothing else; empty is green.
* **An edge is named by its ordered pair, spelled ``{from, to}``** — the document's own spelling
  and the canvas's key for an edge. ``from`` is a Python keyword, so the models below carry it as
  ``from_`` with an alias, and serialise by the alias.

Every request is closed, like every request under ``/v0``: a caller that misspells ``ticket`` is
told so instead of having it dropped.
"""

from __future__ import annotations

from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer
from pydantic_core.core_schema import SerializerFunctionWrapHandler

from .dsl import Effort, SourceKind
from .errors import Diagnostic
from .validate import Verdict

#: The longest display key a ticket may carry — ``#485``, ``PROJ-142``. Bounded as the label it
#: is (V030's ``external_key`` is a label, never an identity), not because a key is ever close.
MAX_TICKET_KEY_LENGTH: Final = 255

#: V030's own caps on ``tickets.labels``: at most 100 names, each at most 255 characters
#: (``jsonb_string_list_valid(labels, 100, 255)``). The request is held to what the column holds.
MAX_TICKET_LABELS: Final = 100
MAX_TICKET_LABEL_LENGTH: Final = 255

#: What happened to an edge on a walk. ``loop`` is its own outcome rather than ``not_taken``:
#: a loop is reported with its retry bound and never walked, which is a different statement from
#: *this branch's condition does not hold*.
EdgeOutcome = Literal["taken", "not_taken", "loop"]

#: What a stage on the walk is. ``matched`` and ``not_matched`` belong to the trigger alone,
#: ``ended`` to a terminal, and ``halted`` to a stage the walk reached and could not leave.
StepVerdict = Literal["matched", "not_matched", "reached", "halted", "ended"]

#: What any stage in the document is, walked or not.
NodeVerdictValue = Literal[
    "matched", "not_matched", "reached", "halted", "ended", "not_reached"
]


class _Closed(BaseModel):
    """The configuration every model here shares: a property nobody declared is refused."""

    model_config = ConfigDict(extra="forbid")


class EdgeRef(_Closed):
    """An edge, named the way the document names one — by its ordered pair.

    Attributes:
        from_: The id of the node the edge leaves. ``from`` on the wire.
        to: The id of the node the edge arrives at.
    """

    model_config = ConfigDict(validate_by_name=True, serialize_by_alias=True)

    from_: str = Field(alias="from", examples=["effort-recheck"])
    to: str = Field(examples=["plan"])


class WorkflowFinding(_Closed):
    """One thing wrong with a definition, anchored where the canvas can select it.

    Attributes:
        code: Which rule broke — one of the DSL's error codes (``docs/WORKFLOW_DSL.md`` § 8).
        message: What a person should read. Presentation, never contract.
        path: An RFC 6901 JSON Pointer to the offending value. ``""`` is the document itself.
        node_id: The node the finding anchors to. Omitted when there is none.
        edge: The edge the finding anchors to. Omitted when there is none.
    """

    code: str = Field(min_length=1, examples=["node.unreachable"])
    message: str = Field(min_length=1)
    path: str = Field(examples=["/nodes/2"])
    node_id: str | None = Field(default=None, examples=["orphan"])
    edge: EdgeRef | None = None

    @model_serializer(mode="wrap")
    def _omit_absent_anchors(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        """Leave an absent anchor out of the payload rather than sending ``null``.

        Args:
            handler: pydantic's own serialisation of the model.

        Returns:
            The serialised finding, without ``node_id`` or ``edge`` when either is unset.
        """
        payload: dict[str, Any] = handler(self)
        for anchor in ("node_id", "edge"):
            if payload.get(anchor) is None:
                payload.pop(anchor, None)
        return payload

    @classmethod
    def from_diagnostic(cls, diagnostic: Diagnostic) -> WorkflowFinding:
        """Translate one DSL diagnostic into the finding a caller receives.

        Args:
            diagnostic: What :func:`~ouroboros_engine.workflows.validate.validate_workflow_document`
                reported.

        Returns:
            The same fact, with the node anchor renamed ``node_id``.
        """
        edge = diagnostic.edge
        return cls(
            code=diagnostic.code,
            message=diagnostic.message,
            path=diagnostic.path,
            node_id=diagnostic.node,
            edge=None if edge is None else EdgeRef(from_=edge.from_, to=edge.to),
        )


def findings_from(verdict: Verdict) -> list[WorkflowFinding]:
    """Every error in a verdict, as findings in the verdict's own document order.

    Args:
        verdict: A validator's verdict.

    Returns:
        One finding per error. Warnings are deliberately left out — see the module docstring.
    """
    return [
        WorkflowFinding.from_diagnostic(diagnostic) for diagnostic in verdict.errors
    ]


class WorkflowValidateRequest(_Closed):
    """The body of a ``POST /v0/workflows/validate`` request.

    Attributes:
        definition: The document, exactly as it is stored. Any JSON value is accepted here —
            whether it is a workflow is the validator's question, and a body that is not one is
            a ``200`` carrying ``document.malformed`` rather than a ``422``.
    """

    definition: Any


class WorkflowValidation(_Closed):
    """The body of a ``POST /v0/workflows/validate`` response.

    Attributes:
        findings: Every error, in document order. Empty is the green verdict — there is no
            separate flag.
    """

    findings: list[WorkflowFinding]


class TicketEstimate(_Closed):
    """The part of a ticket's latest estimate a predicate reads.

    Attributes:
        effort: How much work it is, in ``issue_estimates.effort``'s vocabulary.
    """

    effort: Effort


class DryRunTicket(_Closed):
    """The ticket a dry run is about, and as much of it as a predicate can test.

    The trigger's conditions and the DSL's predicates read three things — effort, labels and the
    tracker a ticket came from — so those are what the caller sends, plus the key every
    explanation names the ticket by. Nothing here is fetched: the engine holds no tickets, and a
    simulator that went looking for one would be a simulator that makes provider calls.

    Attributes:
        external_key: The display form, as V030's ``external_key`` holds it — ``#485``.
        source: Which kind of tracker it came from, as ``ticket_sources.kind`` spells it.
        labels: The tracker's label names, compared exactly as the tracker spells them.
        estimate: The latest estimate, or ``None`` for a ticket nobody has sized. Required
            rather than optional, so *unsized* is something the caller states.
    """

    external_key: str = Field(
        min_length=1, max_length=MAX_TICKET_KEY_LENGTH, examples=["#485"]
    )
    source: SourceKind = Field(examples=["github"])
    labels: list[
        Annotated[str, Field(min_length=1, max_length=MAX_TICKET_LABEL_LENGTH)]
    ] = Field(max_length=MAX_TICKET_LABELS, examples=[["bug", "i2c", "watchdog"]])
    estimate: TicketEstimate | None


class WorkflowDryRunRequest(_Closed):
    """The body of a ``POST /v0/workflows/dry-run`` request.

    Attributes:
        definition: The document to walk, exactly as it is stored. Validated first; a document
            that does not validate is answered with its findings and no walk.
        ticket: The ticket to walk it for.
    """

    definition: Any
    ticket: DryRunTicket


class PredicateEvaluation(_Closed):
    """One predicate, tested against the ticket.

    Attributes:
        holds: Whether it holds.
        assumed: ``True`` when the predicate reads what only a run produces — check results —
            and :attr:`holds` is the simulator's stated assumption rather than a fact about the
            ticket.
        explanation: Why, in one sentence.
    """

    holds: bool
    assumed: bool
    explanation: str = Field(min_length=1)


class DryRunEdge(_Closed):
    """One edge out of a stage on the walk, and what the walk did with it.

    Attributes:
        from_: The stage it leaves. ``from`` on the wire.
        to: The stage it arrives at.
        kind: ``default``, ``branch`` or ``loop``, as the document says.
        label: What the canvas prints beside it, or ``None``.
        outcome: Whether the walk followed it — and ``loop`` for a loop, which is reported and
            never walked.
        explanation: Why, in a sentence or two. For a branch that is not taken, this is the road
            not taken, explained.
        evaluation: The edge's condition tested against the ticket, or ``None`` when it has none.
        max_retries: For a loop, how many retries bound it — the ``limits.max_retries`` of the
            model stage it returns to. ``None`` for any other edge, and for a loop into a stage
            that declares no limit.
    """

    model_config = ConfigDict(validate_by_name=True, serialize_by_alias=True)

    from_: str = Field(alias="from")
    to: str
    kind: Literal["default", "branch", "loop"]
    label: str | None
    outcome: EdgeOutcome
    explanation: str = Field(min_length=1)
    evaluation: PredicateEvaluation | None
    max_retries: int | None


class DryRunStep(_Closed):
    """One stage the walk reached, in the order it reached them.

    Attributes:
        node_id: The stage.
        type: Which of the DSL's five node types it is.
        title: What the canvas prints as its name.
        verdict: What the walk concluded about it.
        annotation: What the stage would do, or require — a gate's requirements, a model
            stage's routing and limits. Always said without doing it.
        evaluation: The trigger's conditions or a fork's predicate, tested against the ticket;
            ``None`` for every other stage.
        edges: Every edge out of it, in document order, each with its outcome.
    """

    node_id: str
    type: Literal["trigger", "llm", "infra", "flow", "term"]
    title: str
    verdict: StepVerdict
    annotation: str = Field(min_length=1)
    evaluation: PredicateEvaluation | None
    edges: list[DryRunEdge]


class NodeVerdict(_Closed):
    """What the walk concluded about one stage, walked or not.

    Attributes:
        node_id: The stage.
        verdict: The conclusion — :data:`StepVerdict` for a stage the walk reached, and
            ``not_reached`` for one it did not.
        explanation: Why, naming the edge that reached it or the one that did not.
    """

    node_id: str
    verdict: NodeVerdictValue
    explanation: str = Field(min_length=1)


class WorkflowDryRun(_Closed):
    """The body of a ``POST /v0/workflows/dry-run`` response.

    Attributes:
        findings: The definition's errors. Non-empty means the document did not validate and
            nothing was walked, so the three lists below are empty.
        steps: The ordered walk.
        verdicts: One verdict per stage, in document order.
        highlight_path: Every edge the walk took, in the order it took them — the segments the
            canvas draws in the accent treatment.
    """

    findings: list[WorkflowFinding]
    steps: list[DryRunStep]
    verdicts: list[NodeVerdict]
    highlight_path: list[EdgeRef]
