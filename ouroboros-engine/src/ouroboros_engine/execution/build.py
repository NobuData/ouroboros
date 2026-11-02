"""A build stage on the farm — submitted, watched through its real lifecycle, and decided.

AJ.3 (`#265 <https://github.com/NobuData/ouroboros/issues/265>`_). The interpreter's ``infra``
node used to fail honestly with ``infra_unavailable``; it now runs on a customer runner:

1. The branch publisher has just pushed the run branch (DI.2), so the commit to build is the
   one the host holds — :meth:`~ouroboros_engine.execution.workspace.RunWorkspace.published`.
2. :class:`BuildWatcher` submits the job (``POST /internal/runs/{id}/builds``) on the stage's
   pool with its command split into argv, then reads it every ``poll_seconds`` until it ends.
3. Each change of phase — waiting → offered → accepted → running → finished — is written to
   the run's transcript as it happens (:meth:`~ouroboros_engine.execution.reporter.RunReporter.note`),
   so the console shows the job's real progress, not a spinner. The console's stepper reads the
   same job by its ``run_id`` linkage.
4. The answer is a :class:`BuildOutcome`: the finished job, whose exit code is the stage's
   check result, or an explained refusal.

**A farm that cannot take the build is a designed failure, never a stall.** The control plane
refuses a submission no runner of the pool can take now (``409 build_no_eligible_runner``) and
cancels the job; a job that later waits with no eligible runner for
:attr:`BuildSettings.no_runner_grace_seconds` of polling is cancelled here, and the stage fails
with a sentence that says which pool, which build and why.

**A person's abort wins.** Controls are polled between reads; an abort cancels the job — a
runner holding it is told — before the interpreter stops the run.
"""

from __future__ import annotations

import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from ouroboros_engine.control_plane.builds import RunBuild
from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.execution.heartbeat import Sleep
from ouroboros_engine.execution.reporter import RunReporter

#: The refusals a submission can meet that end the stage — each answered with a sentence.
SUBMIT_REFUSALS: frozenset[str] = frozenset(
    {
        "build_no_eligible_runner",
        "run_branch_missing",
        "repository_not_found",
        "farm_pool_not_found",
        "farm_pool_disabled",
        "farm_command_required",
    }
)


@dataclass(frozen=True, slots=True)
class BuildSettings:
    """How a build is watched.

    Attributes:
        poll_seconds: Seconds between reads of the job.
        no_runner_grace_seconds: How long a job may wait with **no eligible runner** before it
            is cancelled and the stage fails — a runner coming back from a reboot gets this
            long; a pool with nobody in it does not stall the run.
    """

    poll_seconds: float = 5.0
    no_runner_grace_seconds: float = 600.0


@dataclass(frozen=True, slots=True)
class BuildOutcome:
    """How a build stage's job ended.

    Attributes:
        kind: ``finished`` — the job reached a terminal phase on the farm; ``refused`` — it
            was never placed (or not in time) and the stage fails with ``reason``;
            ``stopped`` — a person aborted the run and the job was cancelled.
        job: The job, when there was one.
        reason: The sentence a refused stage ends with; empty otherwise.
    """

    kind: Literal["finished", "refused", "stopped"]
    job: RunBuild | None = None
    reason: str = ""


def command_argv(command: str | None) -> list[str] | None:
    """Split a stage's command into the argv a runner executes.

    The farm takes argv and never a shell string; the DSL writes the command as one string,
    so it is split the way a POSIX shell would, with no expansion.

    Args:
        command: The stage's ``command``, or ``None`` for the pool's default.

    Returns:
        argv, or ``None``.

    Raises:
        ValueError: The command does not split — an unclosed quote.
    """
    if command is None:
        return None
    argv = shlex.split(command)
    if not argv:
        raise ValueError("the command is empty once split")
    return argv


def describe(job: RunBuild) -> str:
    """The sentence a job's current phase is written to the transcript as.

    Args:
        job: The job.

    Returns:
        One sentence.
    """
    name = f"Build #{job.number}"
    runner = job.runner_name or "a runner"
    match job.phase:
        case "waiting":
            if job.queue_state == "queued_no_eligible_runner":
                return (
                    f"{name} is waiting in pool `{job.pool}`: no runner can take it right "
                    "now."
                )
            return f"{name} is waiting for a runner in pool `{job.pool}`."
        case "offered":
            return f"{name} was offered to {runner}."
        case "accepted":
            return f"{runner} accepted {name.lower()}."
        case "running":
            return f"{name} is running on {runner}."
        case "succeeded" | "failed":
            verdict = "passed" if job.phase == "succeeded" else "failed"
            return f"{name} {verdict} on {runner} ({_evidence(job)})."
        case "canceled":
            return f"{name} was cancelled."
        case _:
            return f"{name} was retried after an infrastructure failure."


def _evidence(job: RunBuild) -> str:
    """A finished job's exit code and ccache result, as a parenthetical.

    Args:
        job: The finished job.

    Returns:
        *"exit 0 · ccache 78.4%"*, or *"exit 0 · ccache not measured"*.
    """
    exit_code = "no exit code" if job.exit_code is None else f"exit {job.exit_code}"
    ccache = (
        "ccache not measured"
        if job.ccache is None
        else f"ccache {job.ccache.hit_rate_pct:g}%"
    )
    return f"{exit_code} · {ccache}"


def _payload(job: RunBuild) -> dict[str, object]:
    """The structure a progress entry carries — what the console can link from.

    Args:
        job: The job.

    Returns:
        The job's id, number, phase, runner, exit code and ccache hit rate.
    """
    return {
        "kind": "build",
        "job_id": job.job_id,
        "job_number": job.number,
        "phase": job.phase,
        "pool": job.pool,
        "runner": job.runner_name,
        "exit_code": job.exit_code,
        "ccache_hit_rate_pct": None if job.ccache is None else job.ccache.hit_rate_pct,
    }


class BuildWatcher:
    """Submits one build stage attempt's job and watches it to the end."""

    def __init__(
        self,
        reporter: RunReporter,
        sleep: Sleep,
        settings: BuildSettings,
        stop_requested: Callable[[], Awaitable[bool]],
    ) -> None:
        """Hold the collaborators.

        Args:
            reporter: The run's epoch-fenced writes.
            sleep: Waits between reads.
            settings: The poll cadence and the no-runner grace window.
            stop_requested: Polls the run's controls; ``True`` when a person aborted it.
        """
        self._reporter = reporter
        self._sleep = sleep
        self._settings = settings
        self._stop_requested = stop_requested

    async def run(
        self,
        stage_key: str,
        attempt: int,
        pool: str,
        commit: str,
        command: list[str] | None,
    ) -> BuildOutcome:
        """Submit the job and watch it until it ends.

        Args:
            stage_key: The build stage.
            attempt: Its attempt — a resubmission of the same one finds the same job.
            pool: The runner pool, by name.
            commit: The commit pushed to the run's branch.
            command: argv, or ``None`` for the pool's default.

        Returns:
            The outcome.

        Raises:
            RunLostError: The run is no longer this worker's.
            ControlPlaneError: A refusal the stage cannot explain — not one of
                :data:`SUBMIT_REFUSALS`.
        """
        try:
            job = await self._reporter.build(stage_key, attempt, pool, commit, command)
        except ControlPlaneError as refused:
            if refused.code not in SUBMIT_REFUSALS:
                raise
            return BuildOutcome(kind="refused", reason=str(refused))

        await self._announce(stage_key, attempt, job)
        seen = (job.job_id, job.phase)
        waited = 0.0
        while not job.finished:
            await self._sleep(self._settings.poll_seconds)
            if await self._stop_requested():
                await self._reporter.cancel_build(job.job_id, "the run was aborted")
                return BuildOutcome(kind="stopped", job=job)
            job = await self._reporter.read_build(job.job_id)
            if (job.job_id, job.phase) != seen:
                seen = (job.job_id, job.phase)
                await self._announce(stage_key, attempt, job)
            if (
                job.phase == "waiting"
                and job.queue_state == "queued_no_eligible_runner"
            ):
                waited += self._settings.poll_seconds
                if waited >= self._settings.no_runner_grace_seconds:
                    return await self._give_up(job)
            else:
                waited = 0.0
        return BuildOutcome(kind="finished", job=job)

    async def _announce(self, stage_key: str, attempt: int, job: RunBuild) -> None:
        """Write the job's current phase to the transcript.

        Args:
            stage_key: The stage.
            attempt: Its attempt.
            job: The job.
        """
        await self._reporter.note(
            stage_key, attempt, describe(job), payload=_payload(job)
        )

    async def _give_up(self, job: RunBuild) -> BuildOutcome:
        """Cancel a job that waited out the grace window with no eligible runner.

        Args:
            job: The waiting job.

        Returns:
            A refusal naming the pool, the build and the window — unless the job finished
            in the meantime, which is then the outcome.
        """
        minutes = round(self._settings.no_runner_grace_seconds / 60)
        cancelled = await self._reporter.cancel_build(
            job.job_id, f"no eligible runner for {minutes} minute(s)"
        )
        if cancelled.phase in ("succeeded", "failed"):
            return BuildOutcome(kind="finished", job=cancelled)
        return BuildOutcome(
            kind="refused",
            job=cancelled,
            reason=(
                f"No runner in pool `{job.pool}` could take build #{job.number} within "
                f"{minutes} minute(s): every runner is offline, drained, full, or lacks the "
                "pool's executor. The build was cancelled."
            ),
        )
