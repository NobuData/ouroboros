"""A fake control plane, workflow documents and scripted executors for the bridge (#160).

:class:`FakeControl` stands in for ``ouroboros-rest``'s internal run surface. It records
every call, fences writes on the epoch exactly as the contract says (a body whose ``epoch``
is not the run's current one is ``409 fenced``), enforces AP.1's transcript ordering, keeps
the checkpoint ``start`` hands back, and lets a test script any refusal per operation.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator
from itertools import pairwise
from typing import Any, ClassVar

from ouroboros_engine.control_plane.client import ControlPlaneError
from ouroboros_engine.control_plane.execution import (
    CheckpointRequest,
    CheckpointSaved,
    FinishRunRequest,
    HeartbeatAccepted,
    RunFinished,
    RunStarted,
)
from ouroboros_engine.control_plane.ingest import (
    ChangeSet,
    EventsAppended,
    IngestEventsRequest,
    OpenRunRequest,
    QueueItemClaimed,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageTransition,
    StageTransitionRequest,
)
from ouroboros_engine.execution.events import ModelTurn, StageEvent
from ouroboros_engine.execution.spi import (
    Checkpoint,
    ExecutorCapabilities,
    ExecutorKind,
    StageContext,
    StageExecutor,
    StageOutcome,
)
from stage_executor_fakes import FAKE_MODEL, FAKE_TS, FakeNativeExecutor, Script

RUN = "0b5e0160-0000-4000-8000-000000000001"
ORG = "org-acme"
SLUG = "acme/helios-firmware"
ISSUE = 160
NOW = "2026-10-15T12:00:00.000Z"


def fenced(current: int) -> ControlPlaneError:
    """The refusal a stale epoch gets."""
    return ControlPlaneError(
        "fenced", "another worker holds the run", 409, {"current_epoch": current}
    )


def refusal(code: str, status: int = 409, **details: Any) -> ControlPlaneError:
    """Any control-plane refusal."""
    return ControlPlaneError(code, code, status, details)


class FakeControl:
    """An in-memory control plane that records, fences and answers."""

    def __init__(
        self,
        document: dict[str, Any],
        *,
        remote: str,
        base_commit: str | None = None,
        checkpoint: dict[str, Any] | None = None,
        protected_paths: tuple[str, ...] = ("boot/**",),
        accepted_hint: int = 0,
        default_branch: str | None = "main",
        labels: tuple[str, ...] = (),
        effort: str | None = None,
    ) -> None:
        """Hold the run as the control plane would."""
        self.document = document
        self.remote = remote
        self.base_commit = base_commit
        self.state = checkpoint
        self.protected_paths = list(protected_paths)
        self.epoch = 0
        self.hint = accepted_hint
        self.default_branch = default_branch
        self.labels = list(labels)
        self.effort = effort
        self.needs_human = False
        self.calls: list[tuple[str, Any]] = []
        self.refusals: dict[str, list[ControlPlaneError | None]] = {}
        self.claimed: QueueItemClaimed | None = None
        self.opened: RunOpened | None = None
        self._lock = threading.Lock()
        self._keys = 0

    # --- bookkeeping ------------------------------------------------------------------------

    def _record(self, operation: str, body: Any) -> None:
        """Record a call, then raise the next scripted refusal for it, if any."""
        with self._lock:
            self.calls.append((operation, body))
            script = self.refusals.get(operation)
            planned = script.pop(0) if script else None
        if planned is not None:
            raise planned

    def _fence(self, epoch: int | None) -> None:
        """Refuse a write under any epoch but the current one."""
        if epoch != self.epoch:
            raise fenced(self.epoch)

    def ops(self) -> list[str]:
        """Every operation called, in order."""
        return [operation for operation, _ in self.calls]

    def bodies(self, operation: str) -> list[Any]:
        """Every body one operation was called with."""
        return [body for name, body in self.calls if name == operation]

    def transitions(self) -> list[tuple[str, str, int | None]]:
        """``(stage, status, attempt)`` per transition."""
        return [
            (body.stage_key, body.status, body.attempt)
            for body in self.bodies("transition")
        ]

    def finished(self) -> FinishRunRequest | None:
        """The finish, if one was sent."""
        finishes = self.bodies("finish")
        return finishes[-1] if finishes else None

    def key(self, operation: str) -> str:
        """A fresh idempotency key."""
        with self._lock:
            self._keys += 1
            return f"test-{operation}-{self._keys}"

    # --- the execution routes ---------------------------------------------------------------

    def start(self, run: str, worker: str) -> RunStarted:
        """Increment the epoch and answer the brief."""
        self._record("start", {"run": run, "worker": worker})
        self.epoch += 1
        return RunStarted.model_validate(
            {
                "runId": run,
                "epoch": self.epoch,
                "organizationId": ORG,
                "issueNumber": ISSUE,
                "issueTitle": "Execute the pinned workflow",
                "issueBody": "Walk it node by node.",
                "labels": self.labels,
                "effort": self.effort,
                "model": "claude-sonnet-5-5",
                "branchName": f"ouro/run-{run}-{ISSUE}",
                "workflow": {
                    "tag": "docs-loop",
                    "version": 1,
                    "document": self.document,
                },
                "repository": {
                    "id": "repo-1",
                    "slug": SLUG,
                    "defaultBranch": self.default_branch,
                    "ref": {"workspace": ORG, "slug": SLUG, "remote": self.remote},
                },
                "protectedPaths": self.protected_paths,
                "baseCommit": self.base_commit,
                "checkpoint": self.state,
                "status": "coding",
            }
        )

    def heartbeat(self, run: str, epoch: int) -> HeartbeatAccepted:
        """Accept a heartbeat under the current epoch."""
        self._record("heartbeat", {"run": run, "epoch": epoch})
        self._fence(epoch)
        return HeartbeatAccepted(epoch=epoch, heartbeat_at=NOW)

    def checkpoint(self, run: str, body: CheckpointRequest) -> CheckpointSaved:
        """Store the state, and the base commit once."""
        del run
        self._record("checkpoint", body)
        self._fence(body.epoch)
        if body.base_commit is not None:
            if self.base_commit not in (None, body.base_commit):
                raise refusal("base_commit_mismatch")
            self.base_commit = body.base_commit
        self.state = body.state
        return CheckpointSaved(checkpoint_at=NOW)

    def finish(self, run: str, body: FinishRunRequest) -> RunFinished:
        """End the run."""
        self._record("finish", body)
        self._fence(body.epoch)
        status = {"back_to_queue": "failed"}.get(body.outcome, body.outcome)
        requeued = "queue-2" if body.outcome == "back_to_queue" else None
        return RunFinished(run_id=run, status=status, requeued_queue_item_id=requeued)

    # --- AP.1's reports ---------------------------------------------------------------------

    def transition(self, run: str, body: StageTransitionRequest) -> StageTransition:
        """Move a stage."""
        del run
        self._record("transition", body)
        self._fence(body.epoch)
        return StageTransition.model_validate(
            {
                "runStageId": "stage-1",
                "stageKey": body.stage_key,
                "stageLabel": body.stage_key,
                "position": 1,
                "attempt": body.attempt or 1,
                "status": body.status,
            }
        )

    def events(self, run: str, body: IngestEventsRequest) -> EventsAppended:
        """Append a batch, holding AP.1's ordering rule."""
        del run
        self._record("events", body)
        self._fence(body.epoch)
        hints = [event.hint for event in body.events]
        if hints[0] <= self.hint or hints != sorted(set(hints)):
            raise refusal("events_out_of_order", accepted=self.hint, offered=hints[0])
        self.hint = hints[-1]
        return EventsAppended(
            submitted=len(hints), stored=len(hints), hint=self.hint, elided=False
        )

    def files(self, run: str, body: ReportFilesRequest) -> ChangeSet:
        """Judge a change-set — ``needs_human`` as the test set it."""
        del run
        self._record("files", body)
        self._fence(body.epoch)
        return ChangeSet(
            change_set_seq=len(self.bodies("files")),
            files=len(body.files),
            additions=0,
            deletions=0,
            guardrail_checks=4,
            needs_human=self.needs_human,
        )

    def resources(self, run: str, body: ReportResourcesRequest) -> ResourcesReported:
        """Attribute spend."""
        del run
        self._record("resources", body)
        self._fence(body.epoch)
        return ResourcesReported(tokens_in=0, tokens_out=0, unpriced_events=0)

    def claim(
        self, workspace: str, worker: str, executors: list[str] | None = None
    ) -> QueueItemClaimed | None:
        """Answer the scripted claim."""
        self._record(
            "claim", {"workspace": workspace, "worker": worker, "executors": executors}
        )
        return self.claimed

    def open_run(self, body: OpenRunRequest) -> RunOpened:
        """Answer the scripted open."""
        self._record("open_run", body)
        assert self.opened is not None
        return self.opened


# --- documents ------------------------------------------------------------------------------

_AT = {"x": 0, "y": 0}


def trigger() -> dict[str, Any]:
    """The trigger node."""
    return {
        "id": "trigger",
        "type": "trigger",
        "title": "trigger",
        "position": _AT,
        "config": {},
    }


def llm(
    node_id: str,
    *,
    max_retries: int = 0,
    touch_ci: bool = False,
    pinned: str | None = None,
) -> dict[str, Any]:
    """A model stage."""
    routing = (
        {"pinned_model": {"alias": pinned}} if pinned else {"inherit_task": "code"}
    )
    return {
        "id": node_id,
        "type": "llm",
        "title": node_id,
        "position": _AT,
        "config": {
            "mode": "prompt",
            "prompt_template": f"Do the {node_id} stage.",
            "routing": routing,
            "limits": {"max_retries": max_retries, "token_budget": 100_000},
            "permissions": {"push_fixup": False, "touch_ci": touch_ci},
        },
    }


def infra(node_id: str) -> dict[str, Any]:
    """An infrastructure stage."""
    return {
        "id": node_id,
        "type": "infra",
        "title": node_id,
        "position": _AT,
        "config": {},
    }


def flow(node_id: str, kind: str, predicate: dict[str, Any]) -> dict[str, Any]:
    """A decision or gate."""
    return {
        "id": node_id,
        "type": "flow",
        "title": node_id,
        "position": _AT,
        "config": {"kind": kind, "predicate": predicate},
    }


def term(node_id: str, action: str) -> dict[str, Any]:
    """A terminal."""
    options = (
        {"merge_method": "squash", "delete_branch": True}
        if action == "open_pr_automerge"
        else {}
    )
    return {
        "id": node_id,
        "type": "term",
        "title": node_id,
        "position": _AT,
        "config": {"action": action, "options": options},
    }


def edge(
    source: str, target: str, kind: str = "default", **extra: Any
) -> dict[str, Any]:
    """An edge."""
    return {"from": source, "to": target, "kind": kind, **extra}


def document(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    """A DSL document."""
    return {
        "dsl_version": "1.0",
        "trigger": {"event": "ticket_queued", "conditions": {}},
        "nodes": nodes,
        "edges": edges,
    }


def chain(*nodes: dict[str, Any]) -> dict[str, Any]:
    """A straight line of nodes joined by default edges."""
    ids = [node["id"] for node in nodes]
    return document(list(nodes), [edge(a, b) for a, b in pairwise(ids)])


# --- executors ------------------------------------------------------------------------------


class Executors:
    """A factory that hands out prepared executors in order, then repeats the last."""

    def __init__(self, *executors: StageExecutor) -> None:
        """Hold the executors."""
        self.queue = list(executors)
        self.made: list[StageExecutor] = []

    def __call__(self) -> StageExecutor:
        """The next executor."""
        executor = self.queue.pop(0) if len(self.queue) > 1 else self.queue[0]
        self.made.append(executor)
        return executor


class Recording(FakeNativeExecutor):
    """A native fake that records the contexts and checkpoints it was given."""

    def __init__(self, script: Script) -> None:
        """Hold the script."""
        super().__init__(script)
        self.contexts: list[StageContext] = []
        self.resumed: list[Checkpoint] = []

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Record, then play."""
        self.contexts.append(ctx)
        return super().run(ctx)

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Record, then resume."""
        self.resumed.append(checkpoint)
        return super().resume(checkpoint)


class Pausing(Recording):
    """Pauses at its first tool call on the first run; plays normally afterwards."""

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Ask for the pause before playing."""
        self.pause()
        return super().run(ctx)


class Failing(StageExecutor):
    """Says one thing and fails."""

    kind: ClassVar[ExecutorKind] = "native"

    def __init__(self, error: str = "the model call timed out") -> None:
        """Hold the error."""
        self._error = error
        self._outcome: StageOutcome | None = None

    def capabilities(self) -> ExecutorCapabilities:
        """Single-shot."""
        return ExecutorCapabilities(
            tools=False, resume=False, steer=False, provider_neutral=True
        )

    def pause(self) -> None:
        """Nothing to pause."""

    def abort(self) -> None:
        """Nothing to abort."""

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Cannot resume."""
        raise NotImplementedError

    @property
    def outcome(self) -> StageOutcome | None:
        """How it ended."""
        return self._outcome

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Say, then fail."""
        return self._play(ctx)

    async def _play(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """The stream."""
        yield ModelTurn(
            seq=1,
            stage_key=ctx.stage_key,
            attempt=ctx.attempt,
            ts=FAKE_TS,
            model_id=FAKE_MODEL,
            text="Trying.",
        )
        self._outcome = StageOutcome(status="failed", error=self._error)


class Blocking(Failing):
    """Says one thing, then waits until it is aborted."""

    def __init__(self) -> None:
        """Start un-aborted."""
        super().__init__()
        self.aborted = False
        self.started = asyncio.Event()

    def abort(self) -> None:
        """Record the abort."""
        self.aborted = True

    async def _play(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Say, then wait for the abort (at most five seconds)."""
        yield ModelTurn(
            seq=1,
            stage_key=ctx.stage_key,
            attempt=ctx.attempt,
            ts=FAKE_TS,
            model_id=FAKE_MODEL,
            text="Working.",
        )
        self.started.set()
        for _ in range(500):
            if self.aborted:
                break
            await asyncio.sleep(0.01)
        self._outcome = StageOutcome(status="aborted")


async def never(_seconds: float) -> None:
    """A heartbeat sleep that never ends: no heartbeat is sent."""
    await asyncio.Event().wait()
