"""The investigation loop — plan, work the tools, synthesize, deliver (``loop-v1``).

CM.1 (`#620 <https://github.com/NobuData/ouroboros/issues/620>`_). One loop serves every
investigation kind; a kind is the playbook the request carries (decision V10)::

    plan(question)  ─▶ research questions                    1 model call
    iterate         ─▶ choose operations ─▶ run each ─▶ digest what it archived
                       (bounded by the depth preset and the budget)
    synthesize      ─▶ candidate claims ─▶ the citation gate ─▶ findings | open questions
    deliver         ─▶ brief + the playbook's deliverable inputs

**State is saved after every step, not only every iteration.** Each tool operation, each
synthesis pass and each deliverable ends in a checkpoint write, and the operations chosen for
an iteration are part of the state. So a restarted worker continues with the next operation
it had already chosen: at most the one operation in flight is repeated, and the ledger
deduplicates that one (same locator, same content hash) — no duplicate rows, nothing paid
for twice.

**Every checkpoint is also the cancel check.** The control plane answers each write with
whether a person asked the run to stop, so a cancel is honoured between operations and lands
as ``cancelled`` with the ledger, the checkpoint and the actuals intact.

**Failures are designed.** ``tool_exhaustion`` (nothing citable came back),
``budget_breach`` (the spend ceiling was reached), ``synthesis_failure`` (no model answer, or
none usable) and ``engine_error`` (this code broke) each end the investigation as ``failed``
with the final state attached. What was gathered is never discarded.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .claims import Candidate, Ledger, compose_brief, gate_claims, gate_deliverable
from .contract import (
    DEPTH_PRESETS,
    LOOP_VERSION,
    FailureReason,
    InvestigateRequest,
    InvestigationTool,
    Stage,
    ToolOperation,
    task_ref,
)
from .control import (
    BUDGET_EXHAUSTED,
    CHECKPOINT_STALE,
    NOT_RUNNING,
    ControlRefusalError,
    ControlUnavailableError,
    Delivery,
    Finish,
    InvestigationControl,
    LedgerSource,
    UsageEntry,
)
from .model import (
    CallUsage,
    ModelCall,
    ModelCaller,
    ModelFailureError,
    json_object,
    remaining_cap,
)
from .playbooks import SynthesisTemplate, UnsupportedPlaybookError, template_for
from .prompts import (
    DIGEST_SYSTEM,
    PLAN_SYSTEM,
    SELECT_SYSTEM,
    SYNTHESIS_SYSTEM,
    deliverable_prompt,
    digest_prompt,
    plan_prompt,
    select_prompt,
    synthesis_prompt,
)

#: The most research questions a plan keeps.
MAX_QUESTIONS = 8

#: How many times a step is re-asked when the model's answer is not the JSON it was asked for.
MAX_REASKS = 1

#: Hits a search asks for when the model names no limit.
DEFAULT_SEARCH_LIMIT = 3

#: The most hits a search may ask for — the tool surface's own bound.
MAX_SEARCH_LIMIT = 50

#: How many failed operations the selection step is reminded of.
MAX_REMEMBERED_FAILURES = 12

#: The longest digest note kept per source, in characters.
MAX_NOTE_LENGTH = 1_200

#: What a person reads when this code, not the investigation, broke.
ENGINE_ERROR_DETAIL = "The investigation loop stopped unexpectedly."

#: How a run of the loop ended. ``superseded`` — another attempt owns the investigation, or
#: it ended elsewhere; ``interrupted`` — the control plane stopped answering, and the
#: checkpoint is what the next attempt resumes from; ``refused`` — it could not be started.
Outcome = Literal[
    "brief_ready", "failed", "cancelled", "superseded", "interrupted", "refused"
]

_logger = logging.getLogger(__name__)


class Operation(BaseModel):
    """One tool operation the selection step chose.

    Attributes:
        tool: The tool's slug.
        op: The operation.
        input: Its input.
    """

    model_config = ConfigDict(extra="ignore")

    tool: str
    op: ToolOperation
    input: dict[str, Any]


class LoopState(BaseModel):
    """Everything the loop needs to continue — the checkpoint.

    The ledger is not in it: sources live in ``source_records`` and are read back when an
    attempt starts.

    Attributes:
        version: The loop version that wrote it.
        phase: The step the loop is in.
        questions: The plan's research questions.
        iteration: The iteration being worked, zero-based.
        selected: Whether this iteration's operations have been chosen.
        pending: The chosen operations not yet run.
        operations_used: Tool operations attempted.
        operations_failed: Of those, the ones that failed.
        failures: The most recent failures, for the selection step.
        notes: Digest notes by ``source_records`` id.
        sections: The gated candidates of each finished synthesis pass.
        deliverables: The gated deliverable inputs produced so far.
        usage_seq: The number of the last model usage recorded.
        spend_cents: Priced model spend so far.
        demoted: Candidates demoted to open questions so far.
    """

    model_config = ConfigDict(extra="ignore")

    version: str = LOOP_VERSION
    phase: Literal["plan", "iterate", "synthesize", "deliver"] = "plan"
    questions: list[str] = Field(default_factory=list)
    iteration: int = 0
    selected: bool = False
    pending: list[Operation] = Field(default_factory=list)
    operations_used: int = 0
    operations_failed: int = 0
    failures: list[str] = Field(default_factory=list)
    notes: dict[str, str] = Field(default_factory=dict)
    sections: list[list[Candidate]] = Field(default_factory=list)
    deliverables: dict[str, dict[str, Any]] = Field(default_factory=dict)
    usage_seq: int = 0
    spend_cents: float = 0.0
    demoted: int = 0


class _CancelledError(Exception):
    """A person asked for the run to stop."""


class _SupersededError(Exception):
    """Another attempt owns the investigation, or it has already ended."""


class _FailedError(Exception):
    """A designed failure.

    Attributes:
        reason: Which one.
        detail: A sentence for a person.
    """

    def __init__(self, reason: FailureReason, detail: str) -> None:
        """Name the failure.

        Args:
            reason: The taxonomy entry.
            detail: The sentence.
        """
        super().__init__(detail)
        self.reason: FailureReason = reason
        self.detail = detail


class InvestigationLoop:
    """Runs investigations against one control plane and one model caller."""

    def __init__(
        self,
        control: InvestigationControl,
        models: ModelCaller,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Hold the collaborators.

        Args:
            control: The control plane.
            models: Makes model calls.
            clock: A monotonic clock in seconds; a test supplies its own.
        """
        self._control = control
        self._models = models
        self._clock = clock

    def run(self, request: InvestigateRequest) -> Outcome:
        """Run, or resume, one investigation to an end.

        Never raises: every way a run can stop is an :data:`Outcome`.

        Args:
            request: What to investigate, under which playbook and budget.

        Returns:
            How it ended.
        """
        investigation = request.investigation
        try:
            # Before the run is claimed: a playbook this build cannot deliver must not move
            # an investigation to `running` and leave it there.
            template = template_for(request.kind.playbook)
        except UnsupportedPlaybookError:
            _logger.warning(
                "investigation not started: unsupported playbook",
                extra={"investigation": investigation, "kind": request.kind.slug},
            )
            return "refused"
        try:
            started = self._control.start(
                investigation,
                loop_version=LOOP_VERSION,
                alias=request.alias,
                resolution_ref=request.resolution_version,
                task=task_ref(investigation),
            )
        except ControlRefusalError as refused:
            _logger.warning(
                "investigation not started",
                extra={"investigation": investigation, "code": refused.code},
            )
            return "refused"
        except ControlUnavailableError:
            _logger.warning(
                "investigation not started: control plane unavailable",
                extra={"investigation": investigation},
            )
            return "interrupted"

        run = _Run(
            control=self._control,
            models=self._models,
            clock=self._clock,
            request=request,
            template=template,
            attempt=started.attempt,
            seq=started.checkpoint_seq,
            base_duration_ms=started.duration_ms,
            state=_restore(started.checkpoint),
            ledger=Ledger(started.sources),
        )
        outcome = run.to_the_end(cancel_requested=started.cancel_requested)
        _logger.info(
            "investigation ended",
            extra={
                "investigation": investigation,
                "kind": request.kind.slug,
                "attempt": started.attempt,
                "outcome": outcome,
                "sources": len(run.ledger),
                "operations": run.state.operations_used,
                "demoted": run.state.demoted,
            },
        )
        return outcome


def _restore(checkpoint: dict[str, Any] | None) -> LoopState:
    """Read a checkpoint back into state.

    Args:
        checkpoint: What the last attempt saved, or ``None``.

    Returns:
        The state to continue from. A checkpoint another loop version wrote, or one that
        does not parse, is not continued from: the run starts again from the plan, and the
        ledger it already filled is still deduplicated against.
    """
    if checkpoint is None:
        return LoopState()
    try:
        state = LoopState.model_validate(checkpoint)
    except ValueError:
        return LoopState()
    return state if state.version == LOOP_VERSION else LoopState()


class _Run:
    """One attempt at one investigation. Holds everything that changes while it runs."""

    def __init__(
        self,
        *,
        control: InvestigationControl,
        models: ModelCaller,
        clock: Callable[[], float],
        request: InvestigateRequest,
        template: SynthesisTemplate,
        attempt: int,
        seq: int,
        base_duration_ms: int,
        state: LoopState,
        ledger: Ledger,
    ) -> None:
        """Assemble an attempt.

        Args:
            control: The control plane.
            models: Makes model calls.
            clock: A monotonic clock in seconds.
            request: The investigation.
            template: Its kind's wording.
            attempt: This attempt's number.
            seq: The last checkpoint's number.
            base_duration_ms: Working time recorded by earlier attempts.
            state: The state to continue from.
            ledger: The ledger so far.
        """
        self.control = control
        self.models = models
        self.clock = clock
        self.request = request
        self.template = template
        self.attempt = attempt
        self.seq = seq
        self.base_duration_ms = base_duration_ms
        self.state = state
        self.ledger = ledger
        self.preset = DEPTH_PRESETS[request.depth]
        self.tools: dict[str, InvestigationTool] = {
            tool.slug: tool for tool in request.tools
        }
        self._began = clock()
        self._unsent: list[UsageEntry] = []

    # --- the ends -----------------------------------------------------------------------

    def to_the_end(self, *, cancel_requested: bool) -> Outcome:
        """Work until the investigation ends, and report the end to the control plane.

        Args:
            cancel_requested: Whether a cancel was already pending when the attempt started.

        Returns:
            How it ended.
        """
        try:
            if cancel_requested:
                raise _CancelledError
            self._work()
        except _CancelledError:
            return self._finish("cancelled", None, None)
        except _FailedError as failed:
            return self._finish("failed", failed.reason, failed.detail)
        except _SupersededError:
            return "superseded"
        except ControlUnavailableError:
            _logger.warning(
                "investigation interrupted: control plane unavailable",
                extra={"investigation": self.request.investigation},
            )
            return "interrupted"
        except Exception:
            _logger.exception(
                "investigation loop error",
                extra={"investigation": self.request.investigation},
            )
            return self._finish("failed", "engine_error", ENGINE_ERROR_DETAIL)
        return "brief_ready"

    def _finish(
        self,
        outcome: Literal["failed", "cancelled"],
        reason: FailureReason | None,
        detail: str | None,
    ) -> Outcome:
        """End the investigation without a brief, keeping the partial.

        Args:
            outcome: ``failed`` or ``cancelled``.
            reason: Why, when failed.
            detail: A sentence for a person, when failed.

        Returns:
            ``outcome``, or what happened instead when the control plane would not take it.
        """
        self.seq += 1
        try:
            self.control.finish(
                self.request.investigation,
                Finish(
                    attempt=self.attempt,
                    outcome=outcome,
                    reason=reason,
                    detail=detail[:500] if detail else None,
                    duration_ms=self._duration_ms(),
                    usage=self._unsent,
                    seq=self.seq,
                    checkpoint=self.state.model_dump(),
                ),
            )
        except ControlRefusalError as refused:
            if refused.code in (CHECKPOINT_STALE, NOT_RUNNING):
                return "superseded"
            _logger.error(
                "investigation end refused",
                extra={
                    "investigation": self.request.investigation,
                    "code": refused.code,
                },
            )
            return "interrupted"
        except ControlUnavailableError:
            return "interrupted"
        return outcome

    # --- the steps ----------------------------------------------------------------------

    def _work(self) -> None:
        """Run every remaining step, in order."""
        state = self.state
        if state.phase == "plan":
            state.questions = self._plan()
            state.phase = "iterate"
            self._save()
        if state.phase == "iterate":
            self._iterate()
            if len(self.ledger) == 0:
                raise _FailedError(
                    "tool_exhaustion",
                    "No research tool returned a source this investigation could cite.",
                )
            state.pending = []
            state.phase = "synthesize"
            self._save()
        if state.phase == "synthesize":
            self._synthesize()
            state.phase = "deliver"
            self._save()
        self._deliver()

    def _plan(self) -> list[str]:
        """Decompose the question into research questions.

        Returns:
            The research questions — the question itself when the model offers none.
        """
        answer = self._ask(
            "plan",
            PLAN_SYSTEM,
            plan_prompt(self.template, self.request.question, MAX_QUESTIONS),
        )
        offered = answer.get("questions")
        questions: list[str] = []
        for entry in offered if isinstance(offered, list) else []:
            text = " ".join(entry.split()) if isinstance(entry, str) else ""
            if text and text not in questions:
                questions.append(text[:1_000])
        return questions[:MAX_QUESTIONS] or [self.request.question]

    def _iterate(self) -> None:
        """Work the tools until the depth preset or the budget says stop."""
        state = self.state
        while state.iteration < self.preset.iterations and not self._gathered():
            if not state.selected:
                state.pending = self._select()
                state.selected = True
                if not state.pending:
                    # Nothing more is worth reading: iterating is over.
                    state.iteration = self.preset.iterations
                self._save()
                if not state.pending:
                    return

            while state.pending and not self._gathered():
                self._operate(state.pending[0])
                state.pending = state.pending[1:]
                self._save()

            state.pending = []
            state.selected = False
            state.iteration += 1
            if (
                len(self.ledger) == 0
                and state.operations_used > 0
                and state.operations_failed == state.operations_used
            ):
                raise _FailedError(
                    "tool_exhaustion",
                    "Every research tool operation failed; nothing could be cited.",
                )
            self._save()

    def _gathered(self) -> bool:
        """Whether the operation or source budget is spent."""
        budget = self.request.budget
        return (
            self.state.operations_used >= budget.operations
            or len(self.ledger) >= budget.sources
        )

    def _select(self) -> list[Operation]:
        """Choose this iteration's operations.

        Returns:
            The operations — only ones naming an enabled tool and an operation it declares,
            and no more than the iteration's share of the budget.
        """
        budget = self.request.budget
        allowance = min(
            budget.operations - self.state.operations_used,
            math.ceil(budget.operations / self.preset.iterations),
        )
        answer = self._ask(
            "select",
            SELECT_SYSTEM,
            select_prompt(
                question=self.request.question,
                questions=self.state.questions,
                tools=list(self.tools.values()),
                ledger=self.ledger.sources(),
                failures=self.state.failures,
                allowance=allowance,
                sources_left=budget.sources - len(self.ledger),
            ),
        )
        offered = answer.get("operations")
        chosen: list[Operation] = []
        for entry in offered if isinstance(offered, list) else []:
            try:
                operation = Operation.model_validate(entry)
            except ValueError:
                continue
            tool = self.tools.get(operation.tool)
            if tool is None or operation.op not in tool.operations:
                continue
            if not operation.input:
                continue
            chosen.append(operation)
        return chosen[:allowance]

    def _operate(self, operation: Operation) -> None:
        """Run one tool operation and digest what it archived.

        A failed operation is counted and remembered, never fatal on its own: the next one
        may succeed, and ``tool_exhaustion`` is decided over the whole iteration.

        Args:
            operation: The operation.
        """
        state = self.state
        budget = self.request.budget
        name = f"{operation.tool}.{operation.op}"
        tool_input = dict(operation.input)
        if operation.op == "search":
            wanted = tool_input.get("limit")
            limit = wanted if isinstance(wanted, int) else DEFAULT_SEARCH_LIMIT
            ceiling = min(MAX_SEARCH_LIMIT, budget.sources - len(self.ledger))
            tool_input["limit"] = max(1, min(limit, ceiling))

        operations_left = budget.operations - state.operations_used
        state.operations_used += 1
        try:
            answer = self.control.tool(
                self.request.investigation,
                operation.tool,
                operation.op,
                tool_input,
                operations_left=operations_left,
            )
        except ControlRefusalError as refused:
            if refused.code == NOT_RUNNING:
                raise _SupersededError from refused
            if refused.code == BUDGET_EXHAUSTED:
                state.operations_used = budget.operations
                return
            state.operations_failed += 1
            self._remember(f"{name}: {refused.code}")
            _logger.info(
                "research tool operation failed",
                extra={
                    "investigation": self.request.investigation,
                    "operation": name,
                    "code": refused.code,
                },
            )
            return

        if answer.skipped is not None:
            self._remember(
                f"{name}: skipped ({answer.skipped.get('reason', 'declined')})"
            )
        new = [
            source.model_copy(update={"tool": operation.tool})
            for source in answer.sources
            if source.id not in self.ledger
        ]
        for source in new:
            self.ledger.add(source)
        if new:
            self._digest(name, answer.payload, new)

    def _digest(
        self, operation: str, payload: Any, sources: list[LedgerSource]
    ) -> None:
        """Note what an operation's new sources say.

        One call per operation that archived something new. An answer that is not usable
        costs the notes, not the investigation: synthesis reads the archived excerpt of a
        source that has no note.

        Args:
            operation: ``web.search``.
            payload: What the tool answered.
            sources: The sources new to the ledger.
        """
        answer = self._ask(
            "digest",
            DIGEST_SYSTEM,
            digest_prompt(
                question=self.request.question,
                operation=operation,
                payload=payload,
                sources=sources,
            ),
            required=False,
        )
        offered = answer.get("notes") if answer is not None else None
        known = Ledger(sources)
        for entry in offered if isinstance(offered, list) else []:
            if not isinstance(entry, dict) or not isinstance(entry.get("note"), str):
                continue
            source_id = known.resolve(entry.get("cite"))
            note = " ".join(entry["note"].split())
            if source_id is not None and note:
                self.state.notes[source_id] = note[:MAX_NOTE_LENGTH]

    def _synthesize(self) -> None:
        """Run the synthesis passes, gating every candidate claim."""
        state = self.state
        passes = max(1, min(self.preset.synthesis_passes, len(state.questions)))
        while len(state.sections) < passes:
            number = len(state.sections)
            answer = self._ask(
                "synthesize",
                SYNTHESIS_SYSTEM,
                synthesis_prompt(
                    template=self.template,
                    question=self.request.question,
                    questions=state.questions[number::passes],
                    ledger=self.ledger.sources(),
                    notes=state.notes,
                ),
            )
            gated = gate_claims(answer, self.ledger)
            demoted = sum(1 for candidate in gated if candidate.demoted)
            if demoted:
                # The claim's words stay out of the log — they are the workspace's.
                _logger.warning(
                    "uncited claims demoted to open questions",
                    extra={
                        "investigation": self.request.investigation,
                        "synthesis_pass": number + 1,
                        "demoted": demoted,
                    },
                )
            state.demoted += demoted
            state.sections.append(gated)
            self._save()

    def _deliver(self) -> None:
        """Produce the playbook's deliverable inputs and deliver the brief."""
        state = self.state
        body, claims = compose_brief(state.sections)
        if not claims:
            raise _FailedError(
                "synthesis_failure",
                "Synthesis produced no claim and no open question.",
            )

        findings = [claim.text for claim in claims if claim.type == "finding"]
        for deliverable in self.request.kind.playbook.deliverables:
            if deliverable == "brief" or deliverable in state.deliverables:
                continue
            answer = self._ask(
                "synthesize",
                SYNTHESIS_SYSTEM,
                deliverable_prompt(
                    deliverable=deliverable,
                    shape=self.template.deliverables[deliverable],
                    question=self.request.question,
                    findings=findings,
                    ledger=self.ledger.sources(),
                    notes=state.notes,
                ),
            )
            state.deliverables[deliverable] = gate_deliverable(answer, self.ledger)
            self._save()

        try:
            self.control.deliver(
                self.request.investigation,
                Delivery(
                    attempt=self.attempt,
                    duration_ms=self._duration_ms(),
                    usage=self._unsent,
                    body=body,
                    claims=claims,
                    deliverables=state.deliverables,
                ),
            )
        except ControlRefusalError as refused:
            if refused.code in (CHECKPOINT_STALE, NOT_RUNNING):
                raise _SupersededError from refused
            raise _FailedError(
                "engine_error",
                f"The control plane did not accept the brief ({refused.code}).",
            ) from refused
        self._unsent = []

    # --- the plumbing -------------------------------------------------------------------

    def _ask(
        self, stage: Stage, system: str, user: str, *, required: bool = True
    ) -> dict[str, Any] | None:
        """Make one model call and read its JSON answer.

        Args:
            stage: Which step is asking.
            system: The system prompt.
            user: The user message.
            required: Whether an unusable answer fails the investigation. ``False`` lets
                the caller go on without one.

        Returns:
            The JSON object; ``None`` only when ``required`` is false and the model gave
            none.

        Raises:
            _FailedError: ``budget_breach`` when the spend ceiling is reached,
                ``synthesis_failure`` when the model cannot be reached or (``required``)
                does not answer with JSON.
        """
        request = self.request
        planning = stage in ("plan", "select")
        alias = (request.plan_alias or request.alias) if planning else request.alias

        for _ in range(1 + MAX_REASKS):
            ceiling = request.budget.spend_cents
            if ceiling is not None and self.state.spend_cents >= ceiling:
                raise _FailedError(
                    "budget_breach",
                    f"The investigation reached its spend ceiling of {ceiling}¢.",
                )
            try:
                answer = self.models.call(
                    ModelCall(
                        investigation=request.investigation,
                        stage=stage,
                        alias=alias,
                        system=system,
                        user=user,
                        cost_cap_cents=remaining_cap(ceiling, self.state.spend_cents),
                        resolution_version=request.resolution_version,
                    )
                )
            except ModelFailureError as failed:
                self._record(stage, alias, failed.usage)
                if failed.over_budget:
                    raise _FailedError(
                        "budget_breach",
                        "The investigation reached its spend ceiling mid-call.",
                    ) from failed
                raise _FailedError(
                    "synthesis_failure",
                    f"The {stage} step got no model answer: {failed.message}",
                ) from failed

            self._record(stage, alias, answer.usage)
            parsed = json_object(answer.text)
            if parsed is not None:
                return parsed

        if not required:
            return None
        raise _FailedError(
            "synthesis_failure",
            f"The model did not answer the {stage} step in the form it was asked for.",
        )

    def _record(self, stage: Stage, alias: str, usage: list[CallUsage]) -> None:
        """Count what a call consumed, to be sent with the next checkpoint.

        Args:
            stage: The step that called.
            alias: The alias it called on.
            usage: What each hop consumed.
        """
        for hop in usage:
            self.state.usage_seq += 1
            if hop.cost_cents is not None:
                self.state.spend_cents += hop.cost_cents
            self._unsent.append(
                UsageEntry(
                    seq=self.state.usage_seq,
                    stage=stage,
                    alias=alias,
                    hop=hop.hop,
                    connection=hop.connection,
                    model=hop.model,
                    input_tokens=hop.input_tokens,
                    output_tokens=hop.output_tokens,
                    cost_cents=hop.cost_cents,
                )
            )

    def _remember(self, failure: str) -> None:
        """Keep a failed operation in mind for the selection step.

        Args:
            failure: ``web.fetch: research_tool_failed``.
        """
        self.state.failures = [*self.state.failures, failure][-MAX_REMEMBERED_FAILURES:]

    def _duration_ms(self) -> int:
        """Working time across every attempt, in milliseconds."""
        return self.base_duration_ms + max(
            0, round((self.clock() - self._began) * 1000)
        )

    def _save(self) -> None:
        """Write a checkpoint, and stop if a person asked for that.

        Raises:
            _CancelledError: When a cancel was requested.
            _SupersededError: When a newer attempt owns the investigation or it has ended.
            ControlUnavailableError: When the control plane did not answer.
        """
        self.seq += 1
        try:
            acknowledged = self.control.checkpoint(
                self.request.investigation,
                attempt=self.attempt,
                seq=self.seq,
                state=self.state.model_dump(),
                duration_ms=self._duration_ms(),
                usage=self._unsent,
            )
        except ControlRefusalError as refused:
            if refused.code in (CHECKPOINT_STALE, NOT_RUNNING):
                raise _SupersededError from refused
            raise
        self._unsent = []
        if acknowledged.cancel_requested:
            raise _CancelledError
