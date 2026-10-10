"""The ``/v0/investigate`` contract — what an investigation is asked to do, and its limits.

CM.1 (`#620 <https://github.com/NobuData/ouroboros/issues/620>`_). ``ouroboros-rest`` sends
one of these when an investigation should run (or resume); the engine answers ``202`` at once
and works in the background, writing everything durable back through the control plane's
internal surface (:mod:`.control`).

**The kind arrives as a playbook, never as a code path** (decision V10). A request names the
investigation's kind only to carry its playbook — default tools, synthesis template,
deliverables — and the loop reads nothing else about it. A fifth kind is a row in
``investigation_kinds`` and, if it needs new wording, a template in :mod:`.playbooks`.

**Depth is a preset, the budget is explicit.** ``quick | standard | deep_dive`` fixes how many
iterations and synthesis passes run (:data:`DEPTH_PRESETS`, the same numbers the scope
estimate plans with); how many operations, sources and cents those may use depends on the tool
selection and the routed model's price, which the control plane knows, so it sends them.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: The researcher this module is — ``investigations.provenance.researcher``.
LOOP_VERSION = "loop-v1"

#: An investigation id: ``investigations.id``.
UUID_PATTERN = r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"

#: A ``research_tools`` slug, as V106 shapes it.
TOOL_SLUG_PATTERN = r"^[a-z][a-z0-9_-]{0,47}$"

#: An investigation kind slug, as V106 shapes it.
KIND_SLUG_PATTERN = r"^[a-z][a-z0-9_]{0,47}$"

#: The composer's Depth menu.
Depth = Literal["quick", "standard", "deep_dive"]

#: What a tool can be asked to do — the ``:op`` of the internal tool surface.
ToolOperation = Literal["search", "fetch", "query"]

#: What a playbook can produce.
Deliverable = Literal["brief", "matrix", "roadmap_doc", "fix_draft"]

#: Why the loop failed an investigation — V120's ``investigation_loops.failure_reason``.
FailureReason = Literal[
    "tool_exhaustion", "budget_breach", "synthesis_failure", "engine_error"
]

#: The four steps a model is called from — V120's ``investigation_usage.stage``.
Stage = Literal["plan", "select", "digest", "synthesize"]

#: ``422`` — the playbook names a synthesis template, or a deliverable, this build lacks.
PLAYBOOK_UNSUPPORTED = "investigation_playbook_unsupported"

#: ``503`` — every worker is busy; the control plane submits it again later.
AT_CAPACITY = "investigation_capacity"

_CLOSED = ConfigDict(extra="forbid", frozen=True)


class DepthPreset(BaseModel):
    """What a depth runs.

    Attributes:
        iterations: Rounds of tool work.
        synthesis_passes: Long synthesis calls over what was gathered.
    """

    model_config = _CLOSED

    iterations: int
    synthesis_passes: int


#: The presets. Calibration version 1 of the scope estimate (``estimate.calibration.ts``)
#: plans with exactly these, so an estimate and the run it estimated agree about shape.
DEPTH_PRESETS: dict[str, DepthPreset] = {
    "quick": DepthPreset(iterations=1, synthesis_passes=1),
    "standard": DepthPreset(iterations=2, synthesis_passes=2),
    "deep_dive": DepthPreset(iterations=4, synthesis_passes=4),
}


class InvestigationPlaybook(BaseModel):
    """A kind's configuration — ``investigation_kinds.playbook`` (V106).

    Attributes:
        version: The playbook's version; rises with every change.
        default_tools: The tools the kind turns on by default. Informational here: the
            request's own :attr:`InvestigateRequest.tools` is what runs.
        synthesis_template: ``<name>@<version>`` — a key of
            :data:`ouroboros_engine.investigation.playbooks.TEMPLATES`.
        deliverables: What the kind produces; always includes ``brief``.
    """

    model_config = _CLOSED

    version: int = Field(ge=1)
    default_tools: list[Annotated[str, Field(pattern=TOOL_SLUG_PATTERN)]]
    synthesis_template: str = Field(min_length=1, max_length=120)
    deliverables: list[Deliverable] = Field(min_length=1)


class InvestigationKind(BaseModel):
    """The investigation's kind.

    Attributes:
        slug: ``gap_analysis``. Recorded in logs; never branched on.
        playbook: What makes this kind differ from the others.
    """

    model_config = _CLOSED

    slug: str = Field(pattern=KIND_SLUG_PATTERN)
    playbook: InvestigationPlaybook


class InvestigationTool(BaseModel):
    """One enabled research tool.

    Attributes:
        slug: The ``research_tools`` slug.
        operations: The operations its adapter declares.
        description: The tools card's line for it, shown to the model that chooses
            operations.
    """

    model_config = _CLOSED

    slug: str = Field(pattern=TOOL_SLUG_PATTERN)
    operations: list[ToolOperation] = Field(min_length=1)
    description: str = Field(default="", max_length=400)


class InvestigationBudget(BaseModel):
    """What the investigation may use.

    Attributes:
        operations: Tool operations, in total.
        sources: Ledger records; iteration stops once the ledger holds this many.
        spend_cents: The model-spend ceiling, or ``None`` when nothing prices the
            routed model. Reaching it is a ``budget_breach``.
    """

    model_config = _CLOSED

    operations: int = Field(ge=1, le=2_000)
    sources: int = Field(ge=1, le=1_000)
    spend_cents: int | None = Field(default=None, ge=0, le=10_000_000)


class InvestigateRequest(BaseModel):
    """The body of ``POST /v0/investigate``.

    Attributes:
        investigation: ``investigations.id``.
        kind: The kind and its playbook.
        question: What the person asked.
        tools: The enabled tools and what each can do.
        depth: The depth preset.
        budget: The limits.
        alias: The routing alias ``research`` resolved to — digests and synthesis.
        plan_alias: The alias ``research-plan`` resolved to — planning and choosing
            operations. ``None`` uses :attr:`alias`.
        resolution_version: The resolution both aliases came from, recorded as the
            investigation's ``resolution_ref``.
    """

    model_config = _CLOSED

    investigation: str = Field(pattern=UUID_PATTERN)
    kind: InvestigationKind
    question: str = Field(min_length=1, max_length=8_000)
    tools: list[InvestigationTool] = Field(min_length=1, max_length=32)
    depth: Depth
    budget: InvestigationBudget
    alias: str = Field(min_length=1, max_length=200)
    plan_alias: str | None = Field(default=None, min_length=1, max_length=200)
    resolution_version: str | None = Field(default=None, min_length=1, max_length=200)


class InvestigationAccepted(BaseModel):
    """The answer to ``POST /v0/investigate`` — ``202``.

    Attributes:
        investigation: The investigation.
        task: The engine task running it — ``investigations.engine_task_ref``.
        state: ``accepted`` when this call started it, ``already_running`` when this
            process was already working on it (a repeated submit starts nothing).
        loop_version: The researcher.
    """

    model_config = _CLOSED

    investigation: str
    task: str
    state: Literal["accepted", "already_running"]
    loop_version: str


def task_ref(investigation: str) -> str:
    """The engine task reference of an investigation.

    Args:
        investigation: ``investigations.id``.

    Returns:
        ``investigate:<id>`` — stable, so a repeated submit names the same task.
    """
    return f"investigate:{investigation.lower()}"
