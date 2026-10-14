"""The StageExecutor SPI — what runs inside one stage attempt (decision L2's second axis).

DH.1 (`#1302 <https://github.com/NobuData/ouroboros/issues/1302>`_), specified in
``docs/STAGE_EXECUTORS.md``. #155 decides how a *workflow* is orchestrated; this interface
decides nothing about that. It is what the workflow interpreter (#160) calls when it reaches
a model stage, and the fourth application of the repository's adapter pattern after ticket
sources, model providers and research tools.

An executor instance serves **one** stage attempt:

* :meth:`StageExecutor.run` streams the attempt's events
  (:mod:`~ouroboros_engine.execution.events`) and ends when the attempt ends — completed,
  halted by a policy ``deny``, paused, aborted or failed. :attr:`StageExecutor.outcome`
  then says which.
* :meth:`StageExecutor.pause` and :meth:`StageExecutor.abort` are *requests*. They take
  effect at the kind's safe boundary (:data:`SAFE_BOUNDARIES`) and never mid-tool.
* :meth:`StageExecutor.resume` continues a paused attempt from its :class:`Checkpoint`, on
  a fresh instance, possibly after an engine restart.

Every tool request is put to :func:`~ouroboros_engine.execution.policy.evaluate` before the
tool runs. That is not an implementation choice an adapter may make differently; the
conformance kit checks every verdict an executor reports against the policy's own.

**Core engine code imports this package, never an adapter.** Adapters live under
:mod:`ouroboros_engine.execution.executors`, and ruff's ``banned-api`` rule (``TID251``)
refuses an import of that package — or of a vendor SDK — anywhere else in ``src``.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any, ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.execution.events import StageEvent, StageKey
from ouroboros_engine.execution.policy import ToolPolicy, ToolVerdict

#: ``native`` — the engine owns the loop and calls models through the chain executor.
#: ``harness`` — a vendor agent runtime owns the loop; the engine sits at its hooks.
ExecutorKind = Literal["native", "harness"]

#: Every kind, in the order the specification lists them.
EXECUTOR_KINDS: Final[tuple[str, ...]] = ("native", "harness")

#: Where pause and abort take effect, per kind. Never inside a running tool.
SAFE_BOUNDARIES: Final[dict[str, str]] = {
    "native": "between tool calls: after one tool's result, before the next request runs",
    "harness": "at the harness's pre-tool hook: the pending tool call is refused, not run",
}

#: How an attempt ended.
OutcomeStatus = Literal["completed", "halted", "paused", "aborted", "failed"]


class _Model(BaseModel):
    """Frozen, and strict about unknown fields."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ExecutorCapabilities(_Model):
    """What an executor can do, so the interpreter never asks for what it cannot.

    Attributes:
        tools: It runs a tool loop. ``False`` for a single-shot executor (plan, summarise).
        resume: A paused attempt can be continued from its checkpoint.
        steer: It accepts guidance mid-attempt (#315 defines the call).
        provider_neutral: Any provider the chain executor routes to can serve it.
            ``False`` for a harness that serves one vendor's models.
    """

    tools: bool
    resume: bool
    steer: bool
    provider_neutral: bool


class StageContext(_Model):
    """Everything one stage attempt runs with.

    Attributes:
        run_id: The run.
        stage_key: The stage — a DSL node id.
        attempt: The attempt, from 1.
        prompt: The rendered prompt template.
        model: The routing alias or model the stage asks for; the executor resolves it.
        policy: What its tools may do.
    """

    run_id: str = Field(min_length=1, max_length=64)
    stage_key: StageKey
    attempt: int = Field(ge=1, le=11)
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=200)
    policy: ToolPolicy


class Checkpoint(_Model):
    """Where a paused attempt stands, so another instance can continue it.

    Attributes:
        executor_kind: The kind that wrote it. Resuming under another kind is refused.
        context: The attempt's context. The policy is re-read from here, not from memory.
        next_seq: The ``seq`` the resumed stream starts at.
        state: The executor's own position — a harness's session id, a native loop's
            message history. Opaque to the interpreter; JSON-able.
    """

    executor_kind: ExecutorKind
    context: StageContext
    next_seq: int = Field(ge=1)
    state: dict[str, Any] = Field(default_factory=dict)


class StageOutcome(_Model):
    """How an attempt's stream ended.

    Attributes:
        status: ``completed``; ``halted`` by a policy ``deny``; ``paused`` or ``aborted`` on
            request; ``failed`` on an error the executor could not recover from.
        checkpoint: Set when ``paused`` and the executor can resume.
        verdict: The ``deny`` that halted it, when ``halted``.
        error: What went wrong, when ``failed``.
    """

    status: OutcomeStatus
    checkpoint: Checkpoint | None = None
    verdict: ToolVerdict | None = None
    error: str | None = None


class ExecutorCapabilityError(RuntimeError):
    """Raised when a caller asks for something :meth:`StageExecutor.capabilities` denies."""


class StageExecutor(ABC):
    """One stage attempt's executor. Subclass it under ``execution.executors``.

    Attributes:
        kind: ``native`` or ``harness``.
    """

    kind: ClassVar[ExecutorKind]

    @abstractmethod
    def capabilities(self) -> ExecutorCapabilities:
        """What this executor can do.

        Returns:
            Its capabilities. Constant for the instance's lifetime.
        """

    @abstractmethod
    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Run the attempt, streaming its events.

        Args:
            ctx: The attempt's context.

        Returns:
            The events, in ``seq`` order, ending when the attempt ends; :attr:`outcome` is
            set by then.
        """

    @abstractmethod
    def pause(self) -> None:
        """Ask the attempt to pause at its next safe boundary.

        Returns immediately. The stream ends at the boundary with :attr:`outcome`
        ``paused``, carrying a checkpoint when :attr:`ExecutorCapabilities.resume` is set.
        """

    @abstractmethod
    def abort(self) -> None:
        """Ask the attempt to stop at its next safe boundary, for good.

        Returns immediately. The stream ends at the boundary with :attr:`outcome`
        ``aborted``; no tool runs after the request is observed.
        """

    @abstractmethod
    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Continue a paused attempt.

        Args:
            checkpoint: What :attr:`outcome` carried when it paused.

        Returns:
            The rest of the attempt's events, from ``checkpoint.next_seq``.

        Raises:
            ExecutorCapabilityError: When the executor cannot resume, or the checkpoint
                was written by another kind.
        """

    @property
    @abstractmethod
    def outcome(self) -> StageOutcome | None:
        """How the attempt ended — ``None`` until its stream has."""
