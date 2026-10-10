"""``POST /v0/dry-runs`` on the wire — what the dry-run orchestrator sends and reads (CD.2, #560).

One request is one deep dry run of one draft against one ticket. The answer is a stream of
NDJSON events — a stage starting, a stage finishing, a guard holding — that always ends with
exactly one ``done`` carrying the whole :class:`DryRunResult`. **The engine writes nothing**:
the result's stage rows and artifacts are already in the shape V111's ``dry_run_stages`` and
``dry_run_artifacts`` store, and persisting them is the orchestrator's (CD.4, #562).

**Everything the harness may not decide is sent to it.** Which alias a stage routes to is
routing's answer (Z.1, #194), so each stage arrives with its alias already resolved — or with
none, which is how an unresolved stage kind is told apart (decision W7). The knowledge a stage
is given is context assembly's (BF.5, #414), so each stage arrives with its manifest text. The
spend caps are the orchestrator's arithmetic. The harness executes; it does not configure.

The repository's ``token`` is a read credential for this one request. It is used to read the
pinned commit and is never logged, echoed, stored or shown to a model.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.workflows.contract import DryRunTicket, WorkflowFinding
from ouroboros_engine.workflows.dsl import ALIAS_NAME_PATTERN, NODE_ID_PATTERN

#: The loop version a result names, so a stored row says which harness produced it.
HARNESS_VERSION = "dry-run-v1"

#: The most characters of a ticket's body a stage is shown.
MAX_TICKET_BODY = 20_000

#: The most characters of assembled knowledge one stage may be given.
MAX_MANIFEST = 200_000

#: The largest artifact content, in bytes — V111's ``dry_run_artifacts`` bound.
MAX_ARTIFACT_BYTES = 64 * 1024

#: The refusal for a body naming a GitHub API origin this build will not call.
REPOSITORY_HOST_REFUSED = "dry_run_repository_refused"

StageVerdict = Literal["ok", "skipped", "failed", "not_reached"]
StageHow = Literal["llm", "replayed", "deterministic", "skipped"]
RunStatus = Literal["complete", "failed", "budget_stopped"]
ArtifactKind = Literal["overlay_diff", "plan_excerpt", "review_excerpt"]

_CLOSED = ConfigDict(extra="forbid", frozen=True)

NodeKey = Annotated[str, Field(pattern=NODE_ID_PATTERN)]
Sha = Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
Cap = Annotated[int, Field(ge=0, le=1_000_000_000)]


class DryRunSubject(DryRunTicket):
    """The ticket a dry run is about: what a predicate tests, and what a stage reads.

    Attributes:
        title: The ticket's title, as the tracker holds it.
        body: Its description, or ``""``. Cut to :data:`MAX_TICKET_BODY` by the sender.
    """

    title: str = Field(min_length=1, max_length=500)
    body: str = Field(default="", max_length=MAX_TICKET_BODY)


class DryRunRepository(BaseModel):
    """Where the virtual workspace reads from.

    Attributes:
        slug: ``owner/name``.
        pinned_sha: The commit every read resolves at — ``dry_runs.pinned_sha``.
        api_url: The provider API's origin. GitHub's, or a GitHub Enterprise ``/api/v3``.
        token: A read credential for this request, or ``None`` for a public repository.
    """

    model_config = _CLOSED

    slug: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
    pinned_sha: Sha
    api_url: str = Field(
        default="https://api.github.com",
        pattern=r"^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$",
        max_length=500,
    )
    token: str | None = Field(default=None, min_length=1, max_length=1024, repr=False)


class StagePlan(BaseModel):
    """What routing and context assembly resolved for one model stage.

    Attributes:
        alias: The alias the stage's routing resolves to, or ``None`` when nothing resolves —
            a task kind the catalog does not have, an alias the registry lacks. A stage
            without one is skipped with its warning, never run.
        resolution_version: The resolution the alias came from.
        manifest: The knowledge assembled for the stage (BF.5), as text. ``""`` for none.
        skill_resolved: Whether the skill the stage names exists. ``False`` runs the stage
            without it and says so in the row's note.
        warnings: Decision W7's unresolved-reference warnings for this stage, as sentences.
    """

    model_config = _CLOSED

    alias: Annotated[str, Field(pattern=ALIAS_NAME_PATTERN)] | None = None
    resolution_version: str | None = Field(default=None, max_length=200)
    manifest: str = Field(default="", max_length=MAX_MANIFEST)
    skill_resolved: bool = True
    warnings: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        default_factory=list, max_length=8
    )


class DryRunBudget(BaseModel):
    """The caps a dry run stops at. ``None`` is *no cap of this kind*.

    Attributes:
        run_cost_cents: The most the whole run may spend.
        stage_cost_cents: The most one stage may spend.
        run_tokens: The most tokens the whole run may use.
        stage_tokens: The most tokens one stage may use. A stage's own
            ``limits.token_budget`` applies as well; the lower wins.
    """

    model_config = _CLOSED

    run_cost_cents: Cap | None = None
    stage_cost_cents: Cap | None = None
    run_tokens: Cap | None = None
    stage_tokens: Cap | None = None


class DryRunRequest(BaseModel):
    """The body of ``POST /v0/dry-runs``.

    Attributes:
        dry_run: ``dry_runs.id`` — what every model call and replay estimate is attributed to.
        definition: The draft's document, exactly as stored. Validated first.
        ticket: The ticket.
        repository: Where reads resolve.
        stages: What was resolved for each model stage, by node id. A model stage with no
            entry is treated as unresolved.
        budget: The caps.
    """

    model_config = _CLOSED

    dry_run: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    definition: Any
    ticket: DryRunSubject
    repository: DryRunRepository
    stages: dict[NodeKey, StagePlan] = Field(default_factory=dict, max_length=200)
    budget: DryRunBudget = Field(default_factory=DryRunBudget)


class StageResult(BaseModel):
    """One row of the dry-run card — a ``dry_run_stages`` row, less its ids.

    Attributes:
        seq: The row's position, from 1.
        stage_key: The stage's slug. Parallel stages sharing a title share a row and a key.
        display_name: What the card prints — the title, with a multiplication sign and a
            count when the row stands for several parallel stages.
        nodes: The DSL node ids the row stands for.
        verdict: What happened.
        how: How the result was produced. ``replayed`` is an estimate from history;
            ``skipped`` goes with ``verdict: skipped`` and only with it.
        note: The row's note line, composed by the harness from the stage's outputs.
        metrics: ``tokens``, ``cost_cents`` (absent when unpriced), ``files_touched``,
            ``simulated_writes``, ``lines_added``, ``lines_removed``; a replayed row's
            estimate fields are the estimator's own.
        skip_reason: Why it was skipped; set exactly when ``verdict`` is ``skipped``.
        started_at: When work on it began, or ``None`` when none did.
        finished_at: When it ended.
    """

    model_config = _CLOSED

    seq: int = Field(ge=1)
    stage_key: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)
    display_name: str = Field(min_length=1)
    nodes: list[str]
    verdict: StageVerdict
    how: StageHow
    note: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    skip_reason: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class PathChange(BaseModel):
    """One file of the simulated diff.

    Attributes:
        path: The file.
        added: Lines added.
        removed: Lines removed.
    """

    model_config = _CLOSED

    path: str
    added: int = Field(ge=0)
    removed: int = Field(ge=0)


class DryRunArtifact(BaseModel):
    """An artifact of the run — a ``dry_run_artifacts`` row, less its ids.

    Attributes:
        kind: The overlay diff, or an excerpt of the plan or the reviews.
        content: At most :data:`MAX_ARTIFACT_BYTES` of UTF-8.
        truncated: Whether ``content`` is less than the whole.
        original_bytes: The size before any cut.
        path_summary: Per-file counts, for the diff; empty for an excerpt.
    """

    model_config = _CLOSED

    kind: ArtifactKind
    content: str
    truncated: bool
    original_bytes: int = Field(ge=0)
    path_summary: list[PathChange] = Field(default_factory=list)


class GuardEntry(BaseModel):
    """One line of the guard audit: a call the tool boundary refused, and how often.

    Attributes:
        guard: Which guard held — ``allow_list``, ``workspace_boundary``.
        call: What was attempted — the tool's name.
        count: How many times.
        stage_key: The stage that attempted it.
    """

    model_config = _CLOSED

    guard: str = Field(min_length=1)
    call: str = Field(min_length=1)
    count: int = Field(ge=1)
    stage_key: str | None = None


class DryRunResult(BaseModel):
    """The whole dry run, as it ended.

    Attributes:
        dry_run: The dry run.
        harness: Which harness produced it.
        status: ``complete``; ``failed`` (a stage failed, the definition does not validate,
            or a guard had to hold); or ``budget_stopped`` (a cap was reached — the rows so
            far are kept).
        failure_reason: A sentence, set unless ``status`` is ``complete``.
        findings: The validator's findings when the definition does not validate.
        stages: The rows, in order.
        artifacts: The overlay diff and the excerpts.
        guard_audit: Every blocked call. Empty on a clean run.
        guards_clean: Whether the audit is empty.
        tokens: Tokens used by every model call.
        cost_cents: What they cost, or ``None`` when no call was priced — never a zero that
            was not measured.
        duration_ms: Wall time of the harness.
        workspace_notes: What the virtual workspace could not do in full — a tree the
            provider truncated, a search that stopped at its file bound.
        fetches: How many reads went to the provider (cache hits are not counted).
    """

    model_config = _CLOSED

    dry_run: str
    harness: str = HARNESS_VERSION
    status: RunStatus
    failure_reason: str | None = None
    findings: list[WorkflowFinding] = Field(default_factory=list)
    stages: list[StageResult] = Field(default_factory=list)
    artifacts: list[DryRunArtifact] = Field(default_factory=list)
    guard_audit: list[GuardEntry] = Field(default_factory=list)
    guards_clean: bool = True
    tokens: int = Field(default=0, ge=0)
    cost_cents: int | None = Field(default=None, ge=0)
    duration_ms: int = Field(default=0, ge=0)
    workspace_notes: list[str] = Field(default_factory=list)
    fetches: int = Field(default=0, ge=0)


class StageStarted(BaseModel):
    """A stage has begun — the card's live row.

    Attributes:
        kind: ``stage_started``.
        seq: The row's position.
        stage_key: Its slug.
        display_name: What the card prints.
    """

    model_config = _CLOSED

    kind: Literal["stage_started"] = "stage_started"
    seq: int
    stage_key: str
    display_name: str


class StageFinished(BaseModel):
    """A stage has its result.

    Attributes:
        kind: ``stage_finished``.
        stage: The row.
    """

    model_config = _CLOSED

    kind: Literal["stage_finished"] = "stage_finished"
    stage: StageResult


class GuardBlocked(BaseModel):
    """The tool boundary refused a call, as it happened.

    Attributes:
        kind: ``guard_blocked``.
        guard: Which guard held.
        call: What was attempted.
        stage_key: The stage that attempted it.
    """

    model_config = _CLOSED

    kind: Literal["guard_blocked"] = "guard_blocked"
    guard: str
    call: str
    stage_key: str


class DryRunDone(BaseModel):
    """The run has ended. Always the last event, and there is always exactly one.

    Attributes:
        kind: ``done``.
        result: The whole result.
    """

    model_config = _CLOSED

    kind: Literal["done"] = "done"
    result: DryRunResult


DryRunEvent = StageStarted | StageFinished | GuardBlocked | DryRunDone
