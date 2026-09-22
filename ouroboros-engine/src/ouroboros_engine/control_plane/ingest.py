"""``ouroboros-rest``'s run-ingestion contract, mirrored: six operations and their shapes.

AP.1 (`#303 <https://github.com/NobuData/ouroboros/issues/303>`_), decision **R2**: one
internal contract carries everything an executor reports about a run: the stage it moved,
what was said, the files it changed, the commits it made and what it spent. The
``runs`` tag of
`openapi.internal.yaml <https://github.com/NobuData/ouroboros/blob/main/ouroboros-rest/openapi.internal.yaml>`_
is the authority, and this module is that tag written as Python, next to
:mod:`~ouroboros_engine.control_plane.contract`, which mirrors the rest of the document.

Two callers are written against it. The simulated-run driver (AP.5,
`#307 <https://github.com/NobuData/ouroboros/issues/307>`_) calls it today and real execution
(AR.1, `#315 <https://github.com/NobuData/ouroboros/issues/315>`_) will call it later, and
both use these same models. The shapes live in the production package because that second
caller belongs there. The driver is development tooling and does not ship.

Three rules from the document shape what is *absent* below:

* **No workspace and no** ``simulated`` **field.** The workspace is resolved from the
  ticket and the watermark follows the secret the caller presented, so neither can be
  claimed or cleared by a body.
* **No** ``note`` **on a stage transition.** The database composes it from the transition
  (*"attempt 1 failed tests — loop returned from gate ↺"*). Sending one is a ``422``.
* **No** ``seq`` **on an event.** The store allocates it densely. The caller's ``hint`` is
  checked for order and is not adopted.
"""

from typing import Annotated, Literal

from pydantic import Field

from ouroboros_engine.control_plane.contract import _Request, _Response

#: ``POST``: open a run for a canonical ticket, pinned to one published workflow version.
RUNS_PATH = "/internal/runs"

#: ``POST``: move one attempt of one stage. ``{id}`` is the run.
RUN_STAGE_TRANSITIONS_PATH = "/internal/runs/{id}/stage-transitions"

#: ``POST``: append a batch of transcript entries.
RUN_EVENTS_PATH = "/internal/runs/{id}/events"

#: ``PUT``: report the whole change-set, which triggers guardrail evaluation (AP.3).
RUN_FILES_PATH = "/internal/runs/{id}/files"

#: ``POST``: append commits, oldest first.
RUN_COMMITS_PATH = "/internal/runs/{id}/commits"

#: ``POST``: attribute spend, and take or release a build-farm reservation.
RUN_RESOURCES_PATH = "/internal/runs/{id}/resources"

#: Every ingestion path, in the order a run meets them.
INGEST_PATHS: tuple[str, ...] = (
    RUNS_PATH,
    RUN_STAGE_TRANSITIONS_PATH,
    RUN_EVENTS_PATH,
    RUN_FILES_PATH,
    RUN_COMMITS_PATH,
    RUN_RESOURCES_PATH,
)

#: ``run_stages.status`` (V045). ``pending`` → ``active`` → ``succeeded`` | ``failed``, and
#: ``skipped`` for a stage the path went around.
STAGE_STATUSES: tuple[str, ...] = (
    "pending",
    "active",
    "succeeded",
    "failed",
    "skipped",
)

#: What kind of node a loop edge left from, with ``flow`` resolved into ``gate`` and
#: ``decision``.
RETURN_KINDS: tuple[str, ...] = ("trigger", "llm", "infra", "gate", "decision", "term")

#: How the previous attempt ended. Closed, because the generated note maps each to a phrase.
RETURN_REASONS: tuple[str, ...] = (
    "failed_tests",
    "failed_build",
    "failed_checks",
    "failed_review",
    "gate_rejected",
    "budget_exhausted",
    "timed_out",
    "errored",
)

#: Who is speaking in a transcript entry: the chip mockup 10 draws.
EVENT_ACTORS: tuple[str, ...] = ("plan", "tool", "model", "gate", "user", "system")

#: What happened to a file of a change-set, in git's own four words.
FILE_STATUSES: tuple[str, ...] = ("added", "modified", "deleted", "renamed")

#: The three kinds of diff line.
HUNK_LINE_KINDS: tuple[str, ...] = ("ctx", "del", "add")

#: How the pinned terminal merges.
MERGE_STRATEGIES: tuple[str, ...] = ("squash", "merge", "rebase")

#: The four checks AP.3 judges a change-set by, in the Guardrails card's order.
GUARDRAIL_CHECKS: tuple[str, ...] = (
    "allowed_paths",
    "ci_config",
    "secrets",
    "review_required",
)

#: What the ingestion operations can refuse with, beyond the boundary's ``unauthenticated``.
#: ``events_out_of_order`` and ``stage_transition_invalid`` carry what the store already
#: holds in ``details``, which is how a caller tells a lost response from a bug.
INGEST_ERRORS: tuple[str, ...] = (
    "unauthenticated",
    "validation_failed",
    "run_not_found",
    "ticket_not_found",
    "ticket_ambiguous",
    "ticket_not_numbered",
    "repository_not_found",
    "workflow_pin_not_found",
    "workflow_pin_unreadable",
    "stage_transition_invalid",
    "attempt_limit_exceeded",
    "stage_not_in_pin",
    "stage_return_not_a_retry",
    "events_out_of_order",
    "build_job_not_found",
    "idempotency_key_reused",
)

#: The idempotency key every write carries: the caller's name for one submission. Replaying
#: it returns the first answer, and presenting it with a different body is refused.
IdempotencyKey = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^\S(.*\S)?$")
]

#: A DSL node id, which is what a stage key is.
_STAGE_KEY = r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"

StageStatus = Literal["pending", "active", "succeeded", "failed", "skipped"]
ReturnKind = Literal["trigger", "llm", "infra", "gate", "decision", "term"]
ReturnReason = Literal[
    "failed_tests",
    "failed_build",
    "failed_checks",
    "failed_review",
    "gate_rejected",
    "budget_exhausted",
    "timed_out",
    "errored",
]
EventActor = Literal["plan", "tool", "model", "gate", "user", "system"]
FileStatus = Literal["added", "modified", "deleted", "renamed"]
MergeStrategy = Literal["squash", "merge", "rebase"]


# --- opening a run --------------------------------------------------------------------------


class TicketReference(_Request):
    """Which canonical ticket a run is opened for, and so which workspace it belongs to.

    Attributes:
        source: ``ticket_sources.id``.
        external_key: ``tickets.external_key``, the display form: ``#482``, ``PROJ-142``.
    """

    source: str
    external_key: str = Field(min_length=1, max_length=128)


class WorkflowPin(_Request):
    """Which published workflow version the run pins: ``standard-fix v14``.

    Attributes:
        tag: ``workflows.slug``.
        version: ``workflow_versions.version``.
    """

    tag: str = Field(min_length=1, max_length=64)
    version: int = Field(ge=1, le=1_000_000)


class OpenRunRequest(_Request):
    """The body of ``POST /internal/runs``.

    Attributes:
        idempotency_key: This submission's name.
        ticket: The ticket the run is for.
        repository: ``github_repos.id``, validated against the ticket's workspace.
        workflow: The pinned workflow version.
        model: ``runs.model``, what the dashboard's row renders.
        branch_name: The branch the loop works on, when it has one.
        merge_strategy: How the pinned terminal merges.
    """

    idempotency_key: IdempotencyKey
    ticket: TicketReference
    repository: str
    workflow: WorkflowPin
    model: str = Field(min_length=1, max_length=200)
    branch_name: str | None = Field(default=None, max_length=255)
    merge_strategy: MergeStrategy | None = None


class RunOpened(_Response):
    """The run that was opened.

    Attributes:
        id: ``runs.id``, which every later report is addressed to.
        loop_seq: The *Loop #1847* counter, allocated by the database.
        organization_id: The workspace, resolved from the ticket.
        issue_number: The ticket's number.
        issue_title: The ticket's title, frozen when the run opened.
        workflow_tag: The pinned workflow.
        workflow_version_pin: Its version.
        branch_name: The branch, or ``None``.
        merge_strategy: The merge method, or ``None``.
        model: The model.
        simulated: Decision **R4**'s watermark, which follows the secret the caller
            presented. A simulator reads it to confirm its run is marked as one.
        status: ``runs.status`` at creation.
        started_at: When, ISO 8601.
    """

    id: str
    loop_seq: int
    organization_id: str
    issue_number: int
    issue_title: str
    workflow_tag: str
    workflow_version_pin: int
    branch_name: str | None = None
    merge_strategy: str | None = None
    model: str
    simulated: bool
    status: str
    started_at: str


# --- stages ---------------------------------------------------------------------------------


class StageReturn(_Request):
    """Where a loop edge brought a run back from: the three facts a note is composed of.

    Attributes:
        stage_key: The DSL node the loop edge left from: ``checks-green``.
        kind: What kind of node that is: ``gate``.
        reason: How the previous attempt ended: ``failed_tests``.
    """

    stage_key: str = Field(max_length=64, pattern=_STAGE_KEY)
    kind: ReturnKind
    reason: ReturnReason


class StageTransitionRequest(_Request):
    """The body of ``POST /internal/runs/{id}/stage-transitions``: one move of one attempt.

    Attributes:
        idempotency_key: This submission's name.
        stage_key: The DSL node id.
        status: Where the attempt moves to.
        attempt: Which attempt. ``None`` means the attempt that exists, so only a retry
            has to name one.
        at: When it happened by the executor's clock, ISO 8601. ``None`` is the server's.
        returned_from: For a retry, where the loop came back from.
    """

    idempotency_key: IdempotencyKey
    stage_key: str = Field(max_length=64, pattern=_STAGE_KEY)
    status: StageStatus
    attempt: int | None = Field(default=None, ge=1, le=11)
    at: str | None = None
    returned_from: StageReturn | None = None


class StageReturned(_Response):
    """A :class:`StageReturn`, as the answer carries it back.

    Attributes:
        stage_key: The node the loop edge left from.
        kind: Its kind.
        reason: How the previous attempt ended.
    """

    stage_key: str
    kind: str
    reason: str


class StageTransition(_Response):
    """Where the stage stands after a transition, with the note the database composed.

    Attributes:
        run_stage_id: ``run_stages.id``.
        stage_key: The node id.
        stage_label: The node's title as the pin had it.
        position: Where it sits in the document, from 1.
        attempt: Which attempt.
        max_attempts: The ``3`` of *attempt 2/3*, or ``None``.
        token_budget: The stage's token budget, or ``None``.
        status: Where it stands now.
        note: The composed warn note, or ``None``.
        started_at: When it started, or ``None``.
        finished_at: When it ended, or ``None``.
        returned_from: Where a retry came back from, or ``None``.
    """

    run_stage_id: str
    stage_key: str
    stage_label: str
    position: int
    attempt: int
    max_attempts: int | None = None
    token_budget: int | None = None
    status: str
    note: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    returned_from: StageReturned | None = None


# --- transcript -----------------------------------------------------------------------------


class IngestEvent(_Request):
    """One transcript entry, as an executor reports it.

    Attributes:
        hint: The executor's own monotonic ordering number, checked and not adopted.
        actor: Who is speaking.
        ts: When, ISO 8601.
        stage_key: The stage it belongs to.
        attempt: The attempt it belongs to.
        tool_tag: The tool, for a ``tool`` entry only.
        model_id: Which model said it. Required on a ``model`` entry, with a stage and an
            attempt, so no model output is ever recorded without its provenance.
        body: The text.
        payload: The structure: diff ``hunks``, a ``progress`` fraction, a tool result.
    """

    hint: int = Field(ge=1, le=2_147_483_647)
    actor: EventActor
    ts: str | None = None
    stage_key: str | None = Field(default=None, max_length=64, pattern=_STAGE_KEY)
    attempt: int | None = Field(default=None, ge=1, le=11)
    tool_tag: str | None = Field(
        default=None, max_length=64, pattern=r"^[a-z0-9]([a-z0-9_]*[a-z0-9])?$"
    )
    model_id: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=20_000)
    payload: dict[str, object] | None = None


class IngestEventsRequest(_Request):
    """The body of ``POST /internal/runs/{id}/events``: one batch, in the executor's order.

    Attributes:
        idempotency_key: This submission's name.
        events: One to 500 entries, with strictly increasing hints.
    """

    idempotency_key: IdempotencyKey
    events: list[IngestEvent] = Field(min_length=1, max_length=500)


class EventsAppended(_Response):
    """What the transcript did with a batch.

    Attributes:
        submitted: How many entries the batch carried.
        stored: How many were stored. Lower when a cap refused some.
        first_seq: The first dense ``seq`` allocated, or ``None``.
        last_seq: The last one, or ``None``.
        hint: The ordering hint the run now stands at.
        elided: Whether a cap has elided this transcript. Once true, further posting is
            pointless.
    """

    submitted: int
    stored: int
    first_seq: int | None = None
    last_seq: int | None = None
    hint: int
    elided: bool


# --- change-set -----------------------------------------------------------------------------


class IngestHunkLine(_Request):
    """One diff line.

    Attributes:
        kind: ``ctx``, ``del`` or ``add``. Only ``add`` lines are scanned for secrets.
        text: The line without its diff marker.
    """

    kind: Literal["ctx", "del", "add"]
    text: str = Field(max_length=20_000)


class IngestHunk(_Request):
    """One hunk of a file's diff.

    Attributes:
        new_start: The new-file line the hunk's first line sits at.
        lines: Its lines.
    """

    new_start: int = Field(ge=0, le=100_000_000)
    lines: list[IngestHunkLine] = Field(max_length=2000)


class IngestFile(_Request):
    """One file of a change-set, as it stands against the run's base.

    Attributes:
        path: Relative to the repository root, with no ``..`` segment.
        status: What happened to it.
        additions: Lines added against the base.
        deletions: Lines removed against the base.
        hunks: The diff, for the secrets check. Read in memory and stored nowhere.
    """

    path: str = Field(min_length=1, max_length=1024)
    status: FileStatus
    additions: int | None = Field(default=None, ge=0, le=10_000_000)
    deletions: int | None = Field(default=None, ge=0, le=10_000_000)
    hunks: list[IngestHunk] | None = Field(default=None, max_length=200)


class ReportFilesRequest(_Request):
    """The body of ``PUT /internal/runs/{id}/files``: the **whole** change-set, not a delta.

    Attributes:
        idempotency_key: This submission's name.
        files: Every file the run has changed. Empty triggers no evaluation.
    """

    idempotency_key: IdempotencyKey
    files: list[IngestFile] = Field(max_length=2000)


class ChangeSet(_Response):
    """The change-set as it now stands, and what judging it produced.

    The verdicts are AP.3's (`#305 <https://github.com/NobuData/ouroboros/issues/305>`_),
    computed by the control plane inside the report's own transaction. A caller reads them
    here and never posts one.

    Attributes:
        change_set_seq: Which report this was, from 1.
        files: How many files the change-set holds.
        additions: Their additions.
        deletions: Their deletions.
        guardrail_checks: How many checks this report evaluated. ``0`` with no files.
        guardrail_failures: The checks that failed, in the card's order.
        needs_human: Whether a failure flags the run for a person.
    """

    change_set_seq: int
    files: int
    additions: int
    deletions: int
    guardrail_checks: int
    guardrail_failures: list[str] = Field(default_factory=list)
    needs_human: bool


# --- commits --------------------------------------------------------------------------------


class IngestCommit(_Request):
    """One commit.

    Attributes:
        sha: The object name, 7 to 40 lower-case hex characters.
        message: The commit message.
        committed_at: Git's clock, ISO 8601. Required, because the gap to the report's
            arrival is ingestion lag.
    """

    sha: str = Field(pattern=r"^[0-9a-f]{7,40}$")
    message: str = Field(min_length=1, max_length=8192)
    committed_at: str


class ReportCommitsRequest(_Request):
    """The body of ``POST /internal/runs/{id}/commits``.

    Attributes:
        idempotency_key: This submission's name.
        commits: One to 200 commits, oldest first.
    """

    idempotency_key: IdempotencyKey
    commits: list[IngestCommit] = Field(min_length=1, max_length=200)


class CommitsAppended(_Response):
    """What the commit list did with a report.

    Attributes:
        submitted: How many the report carried.
        appended: How many were new.
        duplicates: How many were already recorded, whatever request they arrived in.
        last_seq: Where the sequence stands, or ``None``.
    """

    submitted: int
    appended: int
    duplicates: int
    last_seq: int | None = None


# --- resources ------------------------------------------------------------------------------


class TokenSpend(_Request):
    """One attributed spend, as ``token_usage`` stores it.

    Attributes:
        provider: The provider kind that answered.
        model: The model id that answered. Never an alias.
        tokens_in: Tokens sent.
        tokens_out: Tokens received.
        cost_cents: Cents as a decimal **string**. ``None`` is *unpriced*, not free.
        task_kind: The task kind, for the routing aggregates.
        latency_ms: How long the call took.
        occurred_at: When, ISO 8601.
    """

    provider: str = Field(max_length=64, pattern=r"^[a-z0-9]+([._-][a-z0-9]+)*$")
    model: str = Field(min_length=1, max_length=200)
    tokens_in: int = Field(ge=0, le=1_000_000_000)
    tokens_out: int = Field(ge=0, le=1_000_000_000)
    cost_cents: str | None = Field(default=None, pattern=r"^\d{1,10}(\.\d{1,4})?$")
    task_kind: str | None = Field(
        default=None, max_length=64, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$"
    )
    latency_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    occurred_at: str | None = None


class ReportResourcesRequest(_Request):
    """The body of ``POST /internal/runs/{id}/resources``.

    ``reserved_build_job`` has three states on the wire, so the client sends it only when
    it was set: a uuid takes a job, ``None`` releases the one held, and leaving it unset says
    nothing.

    Attributes:
        idempotency_key: This submission's name.
        spend: A spend to attribute, or ``None``.
        reserved_build_job: ``build_jobs.id`` to hold, or ``None`` to release.
    """

    idempotency_key: IdempotencyKey
    spend: TokenSpend | None = None
    reserved_build_job: str | None = None


class ResourcesReported(_Response):
    """What the run has spent in total, and what it holds.

    Attributes:
        tokens_in: Every attributed row's input tokens.
        tokens_out: Their output tokens.
        cost_cents: The sum as a decimal string, or ``None`` when every row is unpriced.
        unpriced_events: How many rows carry no price.
        reserved_build_job_id: The job held, or ``None``.
    """

    tokens_in: int
    tokens_out: int
    cost_cents: str | None = None
    unpriced_events: int
    reserved_build_job_id: str | None = None
