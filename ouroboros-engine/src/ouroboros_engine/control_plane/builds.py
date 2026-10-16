"""``ouroboros-rest``'s run-build routes, mirrored: a build stage's job on the farm.

AJ.3 (`#265 <https://github.com/NobuData/ouroboros/issues/265>`_). A workflow's build stage
(an ``infra`` node, ``build({farm: "pool-a"})`` in the code view) runs on a customer runner,
and these three ``/internal/runs/{id}/builds…`` routes are how the engine drives it:

* ``POST …/builds`` submits the job — the stage and attempt, the pool, the commit the branch
  publisher just pushed, and optionally argv. The control plane builds the run's own
  repository at the run's own branch; a body cannot name either. A resend of the same stage
  attempt answers the job it already created. **409** ``build_no_eligible_runner`` when no
  runner of the pool can take it — the job is cancelled at once and the message is the
  stage's failure reason.
* ``GET …/builds/{jobId}`` reads the job's real lifecycle — ``waiting`` → ``offered`` →
  ``accepted`` → ``running`` → ``succeeded`` | ``failed`` | ``canceled`` — with its runner,
  exit code and ccache result, followed down the farm's retry chain.
* ``POST …/builds/{jobId}/cancel`` gives up on it: the engine's grace window ran out with no
  runner eligible to take the job.

Camel-case on the wire, like AP.1's reports beside them
(:mod:`~ouroboros_engine.control_plane.ingest`), and fenced by the epoch like every engine
write.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ouroboros_engine.control_plane.contract import _Request, _Response
from ouroboros_engine.control_plane.ingest import IdempotencyKey

#: ``POST``: submit a build stage's job to the farm.
RUN_BUILDS_PATH = "/internal/runs/{id}/builds"

#: ``GET``: where one of the run's builds is now.
RUN_BUILD_PATH = "/internal/runs/{id}/builds/{job}"

#: ``POST``: give up on one of the run's builds.
RUN_BUILD_CANCEL_PATH = "/internal/runs/{id}/builds/{job}/cancel"

#: Every build path, in the order a stage meets them.
BUILD_PATHS: tuple[str, ...] = (RUN_BUILDS_PATH, RUN_BUILD_PATH, RUN_BUILD_CANCEL_PATH)

#: No runner of the pool can take the build; the control plane cancelled it.
BUILD_NO_ELIGIBLE_RUNNER = "build_no_eligible_runner"

#: Where a farm job is in its life (``farm/dispatch/job.states.ts``).
JobPhase = Literal[
    "waiting",
    "offered",
    "accepted",
    "running",
    "succeeded",
    "failed",
    "retried",
    "canceled",
]

#: The phases nothing leaves.
TERMINAL_PHASES: frozenset[str] = frozenset(
    {"succeeded", "failed", "retried", "canceled"}
)

#: Whether a waiting job could be placed now.
QueueState = Literal["queued_runner_available", "queued_no_eligible_runner"]

_STAGE_KEY = r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
_POOL = r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$"
_COMMIT = r"^[0-9a-f]{40}$"


class RunBuildRequest(_Request):
    """The body of ``POST /internal/runs/{id}/builds`` — one build stage attempt's job.

    Attributes:
        idempotency_key: This submission's name.
        epoch: The epoch this worker holds.
        stage_key: The build stage's node id.
        attempt: The stage's attempt — with the run and the stage, the submission's identity.
        pool: The runner pool, by name — the stage's ``runner_pool``.
        commit: The commit the branch publisher pushed to the run's branch.
        command: argv, or ``None`` for the pool's default command.
    """

    idempotency_key: IdempotencyKey
    epoch: int | None = Field(default=None, ge=1)
    stage_key: str = Field(max_length=64, pattern=_STAGE_KEY)
    attempt: int = Field(ge=1, le=11)
    pool: str = Field(pattern=_POOL)
    commit: str = Field(pattern=_COMMIT)
    command: list[str] | None = Field(default=None, min_length=1, max_length=256)


class RunBuildCancelRequest(_Request):
    """The body of ``POST /internal/runs/{id}/builds/{jobId}/cancel``.

    Attributes:
        idempotency_key: This submission's name.
        epoch: The epoch this worker holds.
        reason: Why, for the control plane's log.
    """

    idempotency_key: IdempotencyKey
    epoch: int | None = Field(default=None, ge=1)
    reason: str | None = Field(default=None, max_length=500)


class CcacheSummary(_Response):
    """A build's ccache result — and ``None`` in its place is *not measured*, never zero.

    Attributes:
        hits: Cache hits.
        misses: Cache misses.
        hit_rate_pct: ``hits / (hits + misses)`` as a percentage, to one decimal.
    """

    hits: int
    misses: int
    hit_rate_pct: float


class RunBuild(_Response):
    """One build of a run, followed to the latest attempt of its retry chain.

    Attributes:
        job_id: The latest attempt's id.
        number: Its public number — mockup 08's ``#479``.
        phase: Where it is.
        queue_state: For a ``waiting`` job, whether any runner could take it now.
        pool: The pool, by name.
        runner_name: The runner holding or last holding it.
        stage_key: The stage it builds for.
        stage_attempt: The stage attempt it builds for.
        exit_code: The command's exit code, once finished.
        ccache: The ccache result, or ``None``.
        retries: Automatic retries before this attempt.
    """

    job_id: str
    number: int
    phase: JobPhase
    queue_state: QueueState | None = None
    pool: str
    runner_name: str | None = None
    stage_key: str | None = None
    stage_attempt: int | None = None
    exit_code: int | None = None
    ccache: CcacheSummary | None = None
    retries: int = 0

    @property
    def finished(self) -> bool:
        """Whether nothing will change about it any more.

        Returns:
            ``True`` in a terminal phase.
        """
        return self.phase in TERMINAL_PHASES


class RunBuildAnswer(_Response):
    """What every build route answers.

    Attributes:
        job: The build.
    """

    job: RunBuild
