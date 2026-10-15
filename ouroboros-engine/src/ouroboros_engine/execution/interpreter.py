"""The workflow interpreter — a run's pinned document, walked over the control plane.

#160, ``docs/DECISION_EXECUTION_ENGINE.md`` decision **A** (the working prototype is
``docs/prototypes/execution-engine/engine.py``). :meth:`Interpreter.execute` takes one live
run from ``ouroboros-rest`` and walks its pinned workflow version node by node:

==================== =======================================================================
node                 what happens
==================== =======================================================================
trigger              follow its default edge
llm                  an attempt on a registered executor (``active`` → ``succeeded`` |
                     ``failed``), its events reported as they arrive, the change-set read
                     from the working tree at the end; retried while ``max_retries`` allows
infra                ``active`` → ``failed``, and the run finishes ``failed``
                     (``infra_unavailable`` until AR.1 / #991)
flow ``decision``    the first ``branch`` edge whose condition holds (paths, labels, effort,
                     source), else the default edge
flow ``gate``        passes → the default edge; fails → its ``loop`` edge, bounded by the
                     loop target's ``max_retries``; undecidable → the run fails, saying why
term                 ``needs_review`` → ``needs_human``; ``open_pr_automerge`` → ``review``
                     (the tree is kept for DI.2); ``back_to_queue`` → ``back_to_queue``
==================== =======================================================================

**It keeps nothing it cannot lose** (A.1). The position is checkpointed to the control plane
after every stage boundary (:mod:`~ouroboros_engine.execution.state`), the tree is
checkpointed locally on the run branch (DI.1), and every write carries the epoch ``start``
answered (:mod:`~ouroboros_engine.execution.reporter`). A worker whose heartbeat or write is
refused ``fenced`` or ``run_not_executable`` aborts its executor and stops writing; the run
is the next worker's.

**Resume** (A.5): a run restarted mid-stage with a paused attempt's executor checkpoint,
on an executor that can resume, is resumed once. Otherwise — or when the resume is refused —
the interrupted attempt is marked ``failed`` and one fresh attempt (the next number) starts;
a native single-shot stage is thereby simply re-run.

The interpreter performs no I/O of its own: the control plane, the clone store, the run
workspaces, the executor registry and the sleep between heartbeats are all handed to it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

from pydantic import ValidationError

from ouroboros_engine.code.clones import CloneError, CloneStore, RepositoryRef
from ouroboros_engine.code.repo import RefNotFoundError
from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.execution import FinishOutcome, RunStarted
from ouroboros_engine.control_plane.ingest import StageReturn
from ouroboros_engine.control_plane.transport import TransportError
from ouroboros_engine.execution.events import StageEvent
from ouroboros_engine.execution.facts import TicketFacts, judge
from ouroboros_engine.execution.graph import WorkflowGraph
from ouroboros_engine.execution.heartbeat import Heartbeat, Sleep
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.reporter import RunControl, RunLostError, RunReporter
from ouroboros_engine.execution.spi import (
    Checkpoint,
    ExecutorCapabilityError,
    StageContext,
    StageExecutor,
    StageOutcome,
)
from ouroboros_engine.execution.stage import (
    drive,
    render_prompt,
    stage_model,
    stage_policy,
)
from ouroboros_engine.execution.state import ExecutionState, edge_id
from ouroboros_engine.execution.workspace import (
    RunSpec,
    RunWorkspace,
    RunWorkspaces,
    WorkspaceError,
)
from ouroboros_engine.workflows.dsl import (
    FlowConfig,
    InfraConfig,
    LlmConfig,
    TermConfig,
    WorkflowNode,
)
from ouroboros_engine.workflows.validate import validate_workflow_document

_log = logging.getLogger(__name__)

#: The highest attempt number AP.1 accepts.
MAX_ATTEMPT = 11


@dataclass
class _Run:
    """One execution's working set.

    Attributes:
        started: What ``start`` answered.
        state: Where the walk stands.
        reporter: The epoch-fenced writes.
        graph: The pinned document, once validated.
        workspace: The open working tree, until it is closed or finished.
        executor: The attempt running now, so a lost heartbeat can abort it.
        returned_from: The gate return the next attempt reports, after a loop.
    """

    started: RunStarted
    state: ExecutionState
    reporter: RunReporter
    graph: WorkflowGraph | None = None
    workspace: RunWorkspace | None = None
    executor: StageExecutor | None = None
    returned_from: StageReturn | None = field(default=None)

    def lose(self, code: str) -> None:
        """The run is no longer this worker's: stop writing and abort the attempt.

        Args:
            code: ``fenced`` or ``run_not_executable``.
        """
        self.reporter.mark_lost(code)
        if self.executor is not None:
            self.executor.abort()


def repository_ref(started: RunStarted) -> RepositoryRef:
    """The clone reference ``start`` answered, as the clone store takes it.

    Args:
        started: The execution brief.

    Returns:
        The reference, carrying this call's credential.
    """
    ref = started.repository.ref
    return RepositoryRef(
        workspace=ref.workspace, slug=ref.slug, remote=ref.remote, token=ref.token
    )


class Interpreter:
    """Executes live runs, one :meth:`execute` call per run."""

    def __init__(
        self,
        control: RunControl,
        clones: CloneStore,
        workspaces: RunWorkspaces,
        registry: ExecutorRegistry,
        *,
        worker: str,
        heartbeat_seconds: float = 5.0,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        """Hold the collaborators.

        Args:
            control: The control plane.
            clones: The clone cache a new run's base commit is resolved in.
            workspaces: The run working trees.
            registry: The stage executors this process can run.
            worker: This worker's name, sent on ``start``.
            heartbeat_seconds: ``OURO_ENGINE_HEARTBEAT_SECONDS``.
            sleep: Waits between heartbeats.
        """
        self._control = control
        self._clones = clones
        self._workspaces = workspaces
        self._registry = registry
        self._worker = worker
        self._heartbeat_seconds = heartbeat_seconds
        self._sleep = sleep

    async def execute(self, run_id: str) -> None:
        """Take a run and walk it until it finishes, parks, or is lost.

        Never raises for what a run can meet: a refused start is logged; a run this worker
        loses stops silently; an unreachable control plane stops it for the supervisor to
        resubmit; anything else finishes the run ``failed`` with the reason.

        Args:
            run_id: ``runs.id``.
        """
        try:
            started = await asyncio.to_thread(self._control.start, run_id, self._worker)
        except (ControlPlaneError, TransportError) as refused:
            _log.warning("run %s not started: %s", run_id, refused)
            return
        state = ExecutionState.from_json(started.checkpoint)
        run = _Run(
            started=started,
            state=state,
            reporter=RunReporter(self._control, run_id, started.epoch, seq=state.seq),
        )
        heartbeat = Heartbeat(
            self._control,
            run_id,
            started.epoch,
            interval=self._heartbeat_seconds,
            sleep=self._sleep,
            on_lost=run.lose,
        )
        beating = asyncio.create_task(heartbeat.run())
        try:
            await self._execute(run)
        except RunLostError as lost:
            _log.warning("run %s stopped: %s", run_id, lost.code)
        except TransportError as unreachable:
            _log.warning(
                "run %s paused, control plane unreachable: %s", run_id, unreachable
            )
        finally:
            beating.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beating
            if run.executor is not None:
                run.executor.abort()
            if run.workspace is not None:
                workspace, run.workspace = run.workspace, None
                await asyncio.to_thread(workspace.close)

    async def _execute(self, run: _Run) -> None:
        """Validate the pin, prepare the tree, and walk — failing the run on what breaks.

        Args:
            run: The execution.
        """
        verdict = validate_workflow_document(run.started.workflow.document)
        if verdict.document is None:
            codes = ", ".join(str(error.code) for error in verdict.errors[:3])
            await self._end(
                run,
                "failed",
                f"The pinned workflow version does not validate ({codes}).",
            )
            return
        run.graph = WorkflowGraph(verdict.document)
        try:
            base_commit = run.started.base_commit or await self._base_commit(run)
            run.workspace = await asyncio.to_thread(
                self._workspaces.open,
                RunSpec(
                    run=run.started.run_id,
                    issue_number=run.started.issue_number,
                    base_commit=base_commit,
                    repository=repository_ref(run.started),
                ),
            )
            await self._walk(run)
        except (RunLostError, TransportError):
            raise
        except (CloneError, RefNotFoundError, WorkspaceError) as broken:
            await self._end(run, "failed", f"The run's working tree failed: {broken}")
        except ControlPlaneError as refused:
            await self._end(
                run, "failed", f"ouroboros-rest refused a report: {refused.code}."
            )
        except Exception as error:
            _log.exception("run %s failed in the engine", run.started.run_id)
            await self._end(
                run, "failed", f"The engine failed: {type(error).__name__}."
            )

    async def _base_commit(self, run: _Run) -> str:
        """Resolve a new run's base commit and store it before any tree is made.

        Args:
            run: The execution.

        Returns:
            The default branch's commit, 40-hex.
        """
        ref = repository_ref(run.started)
        branch = run.started.repository.default_branch or "HEAD"

        def resolve() -> str:
            """Open the clone and read the branch's commit.

            Returns:
                The commit id.
            """
            opened = self._clones.open(ref)
            try:
                return opened.repo.resolve(branch)
            finally:
                opened.repo.close()

        commit = await asyncio.to_thread(resolve)
        await run.reporter.checkpoint(run.state.to_json(), base_commit=commit)
        return commit

    async def _save(self, run: _Run) -> None:
        """Checkpoint the walk's state to the control plane.

        Args:
            run: The execution.
        """
        run.state.seq = run.reporter.seq
        await run.reporter.checkpoint(run.state.to_json())

    async def _walk(self, run: _Run) -> None:
        """Walk from the checkpointed position, or the trigger, until a node stops it.

        Args:
            run: The execution, with its graph and workspace ready.
        """
        assert run.graph is not None  # noqa: S101 - set by _execute before the walk
        position: str | None = run.state.position or run.graph.trigger().id
        while position is not None:
            node = run.graph.node(position)
            if node is None:
                await self._end(
                    run,
                    "failed",
                    f"The checkpoint names `{position}`, which the pinned workflow lacks.",
                )
                return
            following = await self._step(run, node)
            if following is None:
                return
            run.state.move_to(following)
            await self._save(run)
            position = following

    async def _step(self, run: _Run, node: WorkflowNode) -> str | None:
        """Execute one node.

        Args:
            run: The execution.
            node: The node.

        Returns:
            The node to go to next, or ``None`` when the walk stops here.
        """
        config = node.config
        if isinstance(config, LlmConfig):
            return await self._llm(run, node, config)
        if isinstance(config, InfraConfig):
            return await self._infra(run, node)
        if isinstance(config, FlowConfig):
            if config.kind == "gate":
                return await self._gate(run, node, config)
            return await self._decision(run, node)
        if isinstance(config, TermConfig):
            await self._term(run, node, config)
            return None
        return await self._forward(run, node)

    async def _forward(self, run: _Run, node: WorkflowNode) -> str | None:
        """Follow a node's default edge, failing the run when it has none.

        Args:
            run: The execution.
            node: The node.

        Returns:
            The target, or ``None`` after failing the run.
        """
        assert run.graph is not None  # noqa: S101
        following = run.graph.default_next(node.id)
        if following is None:
            await self._end(
                run, "failed", f"`{node.id}` has no default edge to follow.", node.id
            )
        return following

    async def _changed_paths(self, run: _Run) -> list[str]:
        """The paths the run has changed so far.

        Args:
            run: The execution.

        Returns:
            Tree-relative paths.
        """
        assert run.workspace is not None  # noqa: S101
        files = await asyncio.to_thread(run.workspace.changes)
        return [file.path for file in files]

    # --- model stages ----------------------------------------------------------------------

    async def _llm(
        self, run: _Run, node: WorkflowNode, config: LlmConfig
    ) -> str | None:
        """Run a model stage to completion, retrying within its bound.

        Args:
            run: The execution.
            node: The stage.
            config: Its config.

        Returns:
            The next node after success, or ``None`` when the walk stops.
        """
        kind = self._registry.default_kind()
        if kind is None:
            await self._end(
                run, "failed", "No stage executor is registered (no_executor).", node.id
            )
            return None
        limit = config.limits.max_retries + 1
        if run.state.mid_stage(node.id):
            attempt = run.state.attempt or 1
            outcome = await self._resume(run, kind)
            if outcome is None:
                await run.reporter.transition(
                    node.id, "failed", attempt, tolerate_invalid=True
                )
                attempt += 1
                if attempt > MAX_ATTEMPT:
                    await self._exhausted(run, node, attempt - 1, "was interrupted")
                    return None
                outcome = await self._attempt(run, node, config, kind, attempt)
        else:
            attempt = run.state.attempts.get(node.id, 0) + 1
            if attempt > limit:
                await self._exhausted(run, node, limit, "was entered again")
                return None
            outcome = await self._attempt(run, node, config, kind, attempt)

        while True:
            if outcome.status == "aborted":
                return None
            if outcome.status == "paused":
                checkpoint = outcome.checkpoint
                run.state.executor_checkpoint = (
                    None if checkpoint is None else checkpoint.model_dump(mode="json")
                )
                await self._save(run)
                return None
            assert run.workspace is not None  # noqa: S101
            files = await asyncio.to_thread(run.workspace.changes)
            change_set = await run.reporter.files(files)
            if change_set.needs_human:
                await self._end(
                    run, "needs_human", "The guardrails need a person.", node.id
                )
                return None
            if outcome.status == "completed":
                await asyncio.to_thread(run.workspace.checkpoint, node.id)
                await run.reporter.transition(node.id, "succeeded", attempt)
                return await self._forward(run, node)
            await run.reporter.transition(node.id, "failed", attempt)
            if attempt >= min(limit, MAX_ATTEMPT):
                await self._exhausted(run, node, attempt, _why(outcome))
                return None
            attempt += 1
            outcome = await self._attempt(run, node, config, kind, attempt)

    async def _attempt(
        self,
        run: _Run,
        node: WorkflowNode,
        config: LlmConfig,
        kind: str,
        attempt: int,
    ) -> StageOutcome:
        """Start one fresh attempt and drive it to its outcome.

        Args:
            run: The execution.
            node: The stage.
            config: Its config.
            kind: The executor kind.
            attempt: The attempt number.

        Returns:
            How the attempt ended.
        """
        assert run.workspace is not None  # noqa: S101
        run.state.attempts[node.id] = attempt
        run.state.stage_key = node.id
        run.state.attempt = attempt
        run.state.executor_checkpoint = None
        await self._save(run)
        returned_from, run.returned_from = run.returned_from, None
        await run.reporter.transition(
            node.id, "active", attempt, returned_from=returned_from
        )
        started = run.started
        context = StageContext(
            run_id=started.run_id,
            stage_key=node.id,
            attempt=attempt,
            prompt=render_prompt(
                config, started.issue_number, started.issue_title, started.issue_body
            ),
            model=stage_model(config, started.model),
            policy=stage_policy(
                config, str(run.workspace.path), started.protected_paths
            ),
        )
        executor = self._registry.create(kind)
        return await self._drive(run, executor, lambda: executor.run(context))

    async def _resume(self, run: _Run, kind: str) -> StageOutcome | None:
        """Resume an interrupted attempt from its executor checkpoint, once.

        Args:
            run: The execution, whose state records the attempt.
            kind: The executor kind.

        Returns:
            The resumed attempt's outcome, or ``None`` when there is nothing to resume, the
            executor cannot, or it refused the checkpoint — a fresh attempt follows.
        """
        stored = run.state.executor_checkpoint
        if stored is None:
            return None
        executor = self._registry.create(kind)
        if not executor.capabilities().resume:
            return None
        try:
            checkpoint = Checkpoint.model_validate(stored)
        except ValidationError:
            _log.warning("run %s: unreadable executor checkpoint", run.started.run_id)
            return None
        try:
            return await self._drive(run, executor, lambda: executor.resume(checkpoint))
        except ExecutorCapabilityError as refused:
            _log.warning("run %s: resume refused (%s)", run.started.run_id, refused)
            return None

    async def _drive(
        self,
        run: _Run,
        executor: StageExecutor,
        begin: Callable[[], AsyncIterator[StageEvent]],
    ) -> StageOutcome:
        """Run an executor's stream with the executor visible to the heartbeat.

        Args:
            run: The execution.
            executor: The attempt's executor.
            begin: Returns the stream — called here so a refusal to start is raised here.

        Returns:
            The outcome.

        Raises:
            RunLostError: The run was lost before or while the attempt ran.
            ExecutorCapabilityError: The executor refused to start (a resume).
        """
        if run.reporter.lost is not None:
            raise RunLostError(run.reporter.lost)
        stream = begin()
        run.executor = executor
        try:
            return await drive(executor, stream, run.reporter)
        finally:
            run.executor = None

    async def _exhausted(
        self, run: _Run, node: WorkflowNode, attempts: int, why: str
    ) -> None:
        """Fail the run: a stage has no attempt left.

        Args:
            run: The execution.
            node: The stage.
            attempts: How many attempts it used.
            why: What the last one did, as a clause.
        """
        await self._end(
            run,
            "failed",
            f"Stage `{node.id}` {why}, and its {attempts} attempt(s) are exhausted.",
            node.id,
        )

    # --- infrastructure, forks and terminals -----------------------------------------------

    async def _infra(self, run: _Run, node: WorkflowNode) -> None:
        """Fail an infrastructure stage honestly: there is no build farm to run it on yet.

        Args:
            run: The execution.
            node: The stage.
        """
        attempt = run.state.attempts.get(node.id, 0) + 1
        run.state.attempts[node.id] = attempt
        await run.reporter.transition(node.id, "active", attempt)
        await run.reporter.transition(node.id, "failed", attempt)
        await self._end(
            run,
            "failed",
            f"infra_unavailable: stage `{node.id}` needs the build farm, which runs no "
            "stage until AR.1 (#991).",
            node.id,
        )

    async def _decision(self, run: _Run, node: WorkflowNode) -> str | None:
        """Take the first branch whose condition holds, else the default edge.

        A condition the run cannot judge is not taken (see
        :mod:`~ouroboros_engine.execution.facts`).

        Args:
            run: The execution.
            node: The decision.

        Returns:
            The target, or ``None`` after failing the run.
        """
        assert run.graph is not None  # noqa: S101
        changed = await self._changed_paths(run)
        for edge in run.graph.outgoing(node.id, "branch"):
            if (
                edge.condition is not None
                and judge(edge.condition, changed, _facts(run)).holds
            ):
                return edge.to
        return await self._forward(run, node)

    async def _gate(
        self, run: _Run, node: WorkflowNode, config: FlowConfig
    ) -> str | None:
        """Pass a gate, loop back from it, or fail the run at it.

        Args:
            run: The execution.
            node: The gate.
            config: Its config.

        Returns:
            The next node, or ``None`` after failing the run.
        """
        assert run.graph is not None  # noqa: S101
        judgement = judge(config.predicate, await self._changed_paths(run), _facts(run))
        if judgement.holds is None:
            await self._end(
                run,
                "failed",
                f"Gate `{node.id}` cannot be decided: {judgement.clause}.",
                node.id,
            )
            return None
        if judgement.holds:
            return await self._forward(run, node)
        loop = run.graph.loop_edge(node.id)
        if loop is None:
            await self._end(
                run,
                "failed",
                f"Gate `{node.id}` did not pass: {judgement.clause}.",
                node.id,
            )
            return None
        target = run.graph.node(loop.to)
        if target is not None and isinstance(target.config, LlmConfig):
            limit = target.config.limits.max_retries + 1
            if run.state.attempts.get(target.id, 0) >= limit:
                await self._end(
                    run,
                    "failed",
                    f"Gate `{node.id}` did not pass ({judgement.clause}), and "
                    f"`{target.id}` has used all {limit} attempt(s).",
                    node.id,
                )
                return None
        key = edge_id(loop.from_, loop.to)
        run.state.loop_rounds[key] = run.state.loop_rounds.get(key, 0) + 1
        run.returned_from = StageReturn(
            stage_key=node.id, kind="gate", reason="gate_rejected"
        )
        return loop.to

    async def _term(self, run: _Run, node: WorkflowNode, config: TermConfig) -> None:
        """End the run the way its terminal says.

        Args:
            run: The execution.
            node: The terminal.
            config: Its config.
        """
        if config.action == "open_pr_automerge":
            assert run.workspace is not None  # noqa: S101
            await asyncio.to_thread(run.workspace.checkpoint, node.id)
            await run.reporter.finish(
                "review",
                f"The workflow reached `{node.id}`; the branch is ready for its pull "
                "request.",
                node.id,
            )
            return
        if config.action == "needs_review":
            await self._end(
                run,
                "needs_human",
                f"The workflow ended at `{node.id}`: a person reviews the run.",
                node.id,
            )
            return
        await self._end(
            run,
            "back_to_queue",
            f"The workflow ended at `{node.id}`: the ticket goes back to the queue.",
            node.id,
        )

    async def _end(
        self,
        run: _Run,
        outcome: FinishOutcome,
        reason: str,
        stage_key: str | None = None,
    ) -> None:
        """Finish the run, then abandon its tree (every outcome but ``review``).

        Args:
            run: The execution.
            outcome: How it ends.
            reason: One sentence.
            stage_key: The stage it ended at.
        """
        await run.reporter.finish(outcome, reason, stage_key)
        if run.workspace is not None:
            workspace, run.workspace = run.workspace, None
            await asyncio.to_thread(workspace.finish, "abandoned")


def _facts(run: _Run) -> TicketFacts:
    """The ticket facts the brief carried.

    Args:
        run: The execution.

    Returns:
        Its labels and effort.
    """
    return TicketFacts(labels=tuple(run.started.labels), effort=run.started.effort)


def _why(outcome: StageOutcome) -> str:
    """What a failed or halted attempt did, as a clause.

    Args:
        outcome: The attempt's outcome.

    Returns:
        The clause, naming the policy verdict or the error.
    """
    if outcome.status == "halted" and outcome.verdict is not None:
        verdict = outcome.verdict
        return f"was halted by the tool policy ({verdict.rule}: {verdict.reason})"
    return f"failed ({outcome.error or 'no error was given'})"
