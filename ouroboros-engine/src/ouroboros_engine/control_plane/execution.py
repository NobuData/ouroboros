r"""``ouroboros-rest``'s execution routes, mirrored: start, heartbeat, checkpoint and finish.

#160 (the workflow execution bridge) under decision **A** of
``docs/DECISION_EXECUTION_ENGINE.md``. A live run is *executed* by exactly one engine
worker at a time, and these four ``/internal/runs/{id}/…`` routes are how that worker holds
it:

* ``start`` increments the run's **epoch** and answers everything executing it needs: the
  pinned workflow document, the repository and its per-call credential, the protected
  paths, the base commit and the last checkpoint.
* ``heartbeat`` says the worker is still alive. A stale epoch is refused ``409 fenced``.
* ``checkpoint`` stores the interpreter's opaque state, and the base commit once.
* ``finish`` ends the run with one of four outcomes.

DI.2 (#1310) adds ``push`` and ``push/result`` for the run branch, and DI.3 (#1311)
``pull-request``, which opens that branch's draft pull request — or answers the one already
open — at the ``open_pr_automerge`` terminal.

Every engine write — these and AP.1's reports in
:mod:`~ouroboros_engine.control_plane.ingest` — carries the epoch, and a write under a stale
one is refused ``409 fenced``. That is what keeps a zombie worker from writing after a
supervisor handed its run to another.

Unlike AP.1's camel-case reports, these four routes speak **snake_case** on the wire — the
contract the two halves of #160 were built to — so their request bodies are
:class:`_SnakeRequest`\ s. The answers are read with
:class:`~ouroboros_engine.control_plane.contract._Response`, which accepts either spelling.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from ouroboros_engine.control_plane.contract import _Response
from ouroboros_engine.control_plane.ingest import IdempotencyKey

#: ``POST``: take the run — the epoch is incremented and the execution brief answered.
RUN_START_PATH = "/internal/runs/{id}/start"

#: ``POST``: the worker is still alive.
RUN_HEARTBEAT_PATH = "/internal/runs/{id}/heartbeat"

#: ``PUT``: store the interpreter's state, and the base commit once.
RUN_CHECKPOINT_PATH = "/internal/runs/{id}/checkpoint"

#: ``POST``: end the run.
RUN_FINISH_PATH = "/internal/runs/{id}/finish"

#: ``POST``: ask to push the run's branch — the refspec and a one-call credential (DI.2).
RUN_PUSH_PATH = "/internal/runs/{id}/push"

#: ``POST``: what the push did — the audit row and the console's record of it (DI.2).
RUN_PUSH_RESULT_PATH = "/internal/runs/{id}/push/result"

#: ``POST``: open the run branch's draft pull request, or answer the one already open (DI.3).
RUN_PULL_REQUEST_PATH = "/internal/runs/{id}/pull-request"

#: Every execution path, in the order a run meets them.
EXECUTION_PATHS: tuple[str, ...] = (
    RUN_START_PATH,
    RUN_HEARTBEAT_PATH,
    RUN_CHECKPOINT_PATH,
    RUN_PUSH_PATH,
    RUN_PUSH_RESULT_PATH,
    RUN_PULL_REQUEST_PATH,
    RUN_FINISH_PATH,
)

#: A write carried an epoch other than the run's current one: another worker holds it.
FENCED = "fenced"

#: The run is not ``coding``/``building`` any more — finished, in review, or cancelled.
RUN_NOT_EXECUTABLE = "run_not_executable"

#: The run is simulated; only live runs execute.
RUN_SIMULATED = "run_simulated"

#: The run's base commit is already set to another value.
BASE_COMMIT_MISMATCH = "base_commit_mismatch"

#: The claim was refused because this worker registered no executor (#1312).
NO_EXECUTOR = "no_executor"

#: What the execution routes can refuse with, beyond AP.1's codes.
EXECUTION_ERRORS: tuple[str, ...] = (
    "run_not_found",
    RUN_SIMULATED,
    RUN_NOT_EXECUTABLE,
    FENCED,
    BASE_COMMIT_MISMATCH,
)

#: Why ``ouroboros-rest`` refuses a push (DI.2, #1310) — each one before any credential is
#: opened, so a refused push never reaches the host.
PUSH_REFUSALS: tuple[str, ...] = (
    "force_push_refused",
    "branch_mismatch",
    "not_a_run_branch",
    "default_branch",
    "changes_not_evaluated",
    "guardrail_blocking",
    "github_not_configured",
    "protected_branch",
    "branch_check_failed",
)

#: Why ``ouroboros-rest`` refuses to open the run's draft pull request (DI.3, #1311), in
#: the order it checks them after ``fenced`` and ``run_not_executable``: the branch was never
#: pushed, the ticket has no source that can open a pull request, the host would not open it
#: as a draft (or an open non-draft one already holds the branch), or the host failed
#: (``pr_create_failed`` is the one ``502``).
PULL_REQUEST_REFUSALS: tuple[str, ...] = (
    "not_pushed",
    "pr_source_unavailable",
    "draft_refused",
    "pr_create_failed",
)

#: The codes after which a worker must stop writing: it no longer holds the run.
LOST_RUN_CODES: frozenset[str] = frozenset({FENCED, RUN_NOT_EXECUTABLE})

#: How a run can finish. ``review`` stays active; the other three end it.
FinishOutcome = Literal["review", "needs_human", "failed", "back_to_queue"]

#: A 40-hex commit id.
_COMMIT = r"^[0-9a-f]{40}$"


class _SnakeRequest(BaseModel):
    """Base of the execution routes' request bodies: closed, snake_case on the wire."""

    model_config = ConfigDict(extra="forbid")


class StartRunRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/start``.

    Attributes:
        worker: Who is starting it — the same shape as a queue claim's worker.
    """

    worker: str = Field(min_length=1, max_length=128, pattern=r"^\S(.*\S)?$")


class StartedWorkflow(_Response):
    """The run's pinned workflow version, as stored.

    Attributes:
        tag: ``workflows.slug``.
        version: The pinned version.
        document: The version's DSL document, exactly as stored — never the latest.
    """

    tag: str
    version: int
    document: dict[str, Any]


class StartedRepositoryRef(_Response):
    """The repository as the clone store and run workspaces name it.

    Attributes:
        workspace: The workspace's uuid.
        slug: ``owner/name``.
        remote: The fetch URL.
        token: This call's credential, or ``None``. Opened per call; never stored.
    """

    workspace: str
    slug: str
    remote: str
    token: str | None = None


class StartedRepository(_Response):
    """The run's repository.

    Attributes:
        id: ``github_repos.id``.
        slug: ``owner/name``.
        default_branch: The branch a new run's base commit is resolved from, or
            ``None`` when the mirror does not know it (the clone's ``HEAD`` is used).
        ref: The clone reference.
    """

    id: str
    slug: str
    default_branch: str | None = None
    ref: StartedRepositoryRef


class StartedBy(_Response):
    """The person who started the run — the co-author of every commit it pushes (DI.2).

    Attributes:
        name: Their display name.
        email: Their address.
    """

    name: str
    email: str


class AcceptanceCriterion(_Response):
    """One imported acceptance criterion of the run's issue (AX.3 / #359).

    Attributes:
        id: The criterion's id.
        text: What it says — tracker data, never an instruction.
    """

    id: str
    text: str


class RunStarted(_Response):
    """Everything executing a run needs, answered by ``start``.

    Attributes:
        run_id: ``runs.id``.
        epoch: The epoch this worker now holds; every write carries it.
        organization_id: The workspace.
        issue_number: The issue the run works on.
        issue_title: Its title.
        issue_body: Its body, or ``None``.
        labels: The ticket's labels; empty from a control plane that predates them.
        effort: The ticket's size (``xs`` … ``xl``), or ``None`` when unsized.
        model: The model the run records — the fallback alias of a stage that inherits a task
            whose route is not in ``task_models``.
        task_models: Task kind → the alias its route starts on, for each task the pinned
            workflow's stages inherit (DI.6, #1321); empty from a control plane that predates
            it.
        branch_name: ``ouro/run-<run>-<issue>``.
        workflow: The pinned version and its document.
        repository: The repository and its clone reference.
        protected_paths: The workspace's effective protected-path globs.
        base_commit: The commit the run starts from, or ``None`` before the first start.
        checkpoint: The interpreter's last saved state, or ``None``.
        status: ``coding`` or ``building``.
        acceptance_criteria: The issue's imported acceptance criteria, in their stored
            order; empty when there are none, or from a control plane that predates them
            (DH.3, #1308).
        started_by: Who started the run, or ``None`` — a run opened without a person's
            confirmation, or by a control plane that predates the field (DI.2, #1310).
    """

    run_id: str
    epoch: int
    organization_id: str
    issue_number: int
    issue_title: str
    issue_body: str | None = None
    labels: list[str] = Field(default_factory=list)
    effort: Literal["xs", "s", "m", "l", "xl"] | None = None
    model: str
    task_models: dict[str, str] = Field(default_factory=dict)
    branch_name: str | None = None
    workflow: StartedWorkflow
    repository: StartedRepository
    protected_paths: list[str] = Field(default_factory=list)
    base_commit: str | None = None
    checkpoint: dict[str, Any] | None = None
    status: str
    acceptance_criteria: list[AcceptanceCriterion] = Field(default_factory=list)
    started_by: StartedBy | None = None


class HeartbeatRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/heartbeat``.

    Attributes:
        epoch: The epoch this worker holds.
    """

    epoch: int = Field(ge=1)


class HeartbeatAccepted(_Response):
    """The answer to a heartbeat.

    Attributes:
        epoch: The run's epoch — the one sent.
        heartbeat_at: When it was recorded, ISO 8601.
    """

    epoch: int
    heartbeat_at: str


class CheckpointRequest(_SnakeRequest):
    """The body of ``PUT /internal/runs/{id}/checkpoint``.

    Attributes:
        epoch: The epoch this worker holds.
        base_commit: The run's base commit — sent once, before its tree is made.
        state: The interpreter's state (see :mod:`ouroboros_engine.execution.state`).
    """

    epoch: int = Field(ge=1)
    base_commit: str | None = Field(default=None, pattern=_COMMIT)
    state: dict[str, Any]


class CheckpointSaved(_Response):
    """The answer to a checkpoint.

    Attributes:
        checkpoint_at: When it was stored, ISO 8601.
    """

    checkpoint_at: str


class FinishRunRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/finish``.

    Attributes:
        epoch: The epoch this worker holds.
        idempotency_key: This submission's name.
        outcome: How the run ends.
        reason: One sentence a person can read.
        stage_key: The stage it ended at, when there is one.
    """

    epoch: int = Field(ge=1)
    idempotency_key: IdempotencyKey
    outcome: FinishOutcome
    reason: str = Field(min_length=1, max_length=500)
    stage_key: str | None = Field(default=None, max_length=64)


class RunFinished(_Response):
    """The answer to a finish.

    Attributes:
        run_id: ``runs.id``.
        status: The run's status afterwards.
        requeued_queue_item_id: The new, unconfirmed queue item for ``back_to_queue``.
    """

    run_id: str
    status: str
    requeued_queue_item_id: str | None = None


class PushRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/push`` — asking for one push of the run branch.

    The engine names what it wants pushed; ``ouroboros-rest`` decides whether, and builds the
    refspec itself. ``force`` exists only so a request for one is refused by name: this
    engine never sends it.

    Attributes:
        idempotency_key: This submission's name.
        epoch: The epoch this worker holds.
        branch: The run's branch, as ``start`` answered it.
        head_sha: The commit the branch is to point at.
        change_set_seq: The change-set report the pushed tree was judged in — the
            guardrails must have evaluated exactly it.
        force: Never ``True`` from this engine.
    """

    idempotency_key: IdempotencyKey
    epoch: int = Field(ge=1)
    branch: str = Field(min_length=1, max_length=255)
    head_sha: str = Field(pattern=_COMMIT)
    change_set_seq: int = Field(ge=1)
    force: bool | None = None


class PushGrant(_Response):
    """The answer to a push request: what to push, where, and this one call's credential.

    The credential is a :class:`~pydantic.SecretStr`, so neither ``repr`` nor a log line nor
    ``model_dump`` writes it out; :meth:`secret` is the one way to read it.

    Attributes:
        refspec: ``refs/heads/<branch>:refs/heads/<branch>`` — built by the control plane.
        remote: The repository's https URL.
        username: The credential's user name (``x-access-token``).
        password: The credential, for this push only.
    """

    refspec: str
    remote: str
    username: str
    password: SecretStr

    def secret(self) -> str:
        """The credential, for the push and nothing else.

        Returns:
            Its plaintext.
        """
        return self.password.get_secret_value()


#: What a push did.
PushOutcome = Literal["pushed", "failed"]


class PushResultRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/push/result`` — the push's audit row.

    Attributes:
        idempotency_key: This submission's name.
        epoch: The epoch this worker holds.
        branch: The branch pushed.
        outcome: ``pushed`` or ``failed``.
        pushed_sha: The commit the branch now points at, when pushed.
        reason: The host's reason, when it failed.
    """

    idempotency_key: IdempotencyKey
    epoch: int = Field(ge=1)
    branch: str = Field(min_length=1, max_length=255)
    outcome: PushOutcome
    pushed_sha: str | None = Field(default=None, pattern=_COMMIT)
    reason: str | None = Field(default=None, min_length=1, max_length=500)


class PushRecorded(_Response):
    """The answer to a push result.

    Attributes:
        recorded: Always ``True``.
    """

    recorded: bool


class PullRequestRequest(_SnakeRequest):
    """The body of ``POST /internal/runs/{id}/pull-request`` — open the run's draft PR (DI.3).

    The engine names nothing about the pull request: ``ouroboros-rest`` composes the title,
    the body, the base and the head from what it already holds, and always asks the host for
    a **draft**. Sending the same run twice answers the pull request already open, so a
    resumed terminal can ask again safely.

    Attributes:
        idempotency_key: This submission's name.
        epoch: The epoch this worker holds.
    """

    idempotency_key: IdempotencyKey
    epoch: int = Field(ge=1)


class PullRequestOpened(_Response):
    """The answer to a pull-request request: the run's draft pull request.

    Attributes:
        pull_request_id: The control plane's id for the pull request's row.
        number: The pull request's number on the host.
        url: Its page on the host.
        draft: Whether the host holds it as a draft — always ``True`` from a control plane
            that keeps its contract.
        created: ``True`` when this call opened it; ``False`` when it was already open for
            the run (the idempotent path a resumed terminal takes).
    """

    pull_request_id: str
    number: int = Field(ge=1)
    url: str
    draft: bool
    created: bool
