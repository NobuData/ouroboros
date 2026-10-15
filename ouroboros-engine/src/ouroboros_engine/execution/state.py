"""The interpreter's checkpoint — the whole of what a restarted worker resumes from.

#160, ADR decision A.1: durable state lives in ``ouroboros-rest``. The interpreter keeps
nothing it cannot lose, so after every stage boundary it puts this object to
``/internal/runs/{id}/checkpoint``, and ``start`` hands it back to whichever worker holds
the run next. The control plane stores it opaquely (``runs.exec_checkpoint``).

Its shape::

    {
        "position": "implement",  # the node to execute next, or null: the trigger
        "attempts": {"implement": 2},  # the last attempt number used per stage
        "loop_rounds": {"review->implement": 1},
        "seq": 41,  # the last transcript ordering hint sent
        "executor_checkpoint": {...} | null,  # the SPI Checkpoint of a paused attempt
        "stage_key": "implement" | null,  # set while that stage is mid-attempt
        "attempt": 2 | null,
    }

``stage_key``/``attempt`` are written when an attempt starts and cleared when the walk moves
on, so a worker that finds them set knows the previous one died mid-stage (decision A.5).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def edge_id(source: str, target: str) -> str:
    """Name an edge the way :attr:`ExecutionState.loop_rounds` keys it.

    Args:
        source: The node the edge leaves.
        target: The node it enters.

    Returns:
        ``source->target`` — an edge has no id of its own, its ordered pair is unique.
    """
    return f"{source}->{target}"


def _counts(value: object) -> dict[str, int]:
    """Read a ``{name: n}`` map, dropping anything that is not one.

    Args:
        value: Whatever the stored state held.

    Returns:
        The well-formed entries.
    """
    if not isinstance(value, dict):
        return {}
    return {
        str(key): count
        for key, count in value.items()
        if isinstance(count, int) and not isinstance(count, bool)
    }


@dataclass
class ExecutionState:
    """Where a run's walk stands. See the module for the stored shape.

    Attributes:
        position: The node to execute next; ``None`` means the trigger.
        attempts: The last attempt number used, per stage.
        loop_rounds: How often each loop edge has been followed.
        seq: The last transcript ordering hint sent.
        executor_checkpoint: The paused attempt's SPI checkpoint, as JSON.
        stage_key: The stage mid-attempt, or ``None`` between stages.
        attempt: That attempt's number.
    """

    position: str | None = None
    attempts: dict[str, int] = field(default_factory=dict)
    loop_rounds: dict[str, int] = field(default_factory=dict)
    seq: int = 0
    executor_checkpoint: dict[str, Any] | None = None
    stage_key: str | None = None
    attempt: int | None = None

    @classmethod
    def from_json(cls, stored: dict[str, Any] | None) -> ExecutionState:
        """Read a stored checkpoint, tolerating a missing or partial one.

        Args:
            stored: ``start``'s ``checkpoint``, or ``None`` for a run never checkpointed.

        Returns:
            The state; a fresh one at the trigger when nothing was stored.
        """
        if not stored:
            return cls()
        position = stored.get("position")
        seq = stored.get("seq")
        executor = stored.get("executor_checkpoint")
        stage_key = stored.get("stage_key")
        attempt = stored.get("attempt")
        return cls(
            position=position if isinstance(position, str) else None,
            attempts=_counts(stored.get("attempts")),
            loop_rounds=_counts(stored.get("loop_rounds")),
            seq=seq if isinstance(seq, int) and seq >= 0 else 0,
            executor_checkpoint=executor if isinstance(executor, dict) else None,
            stage_key=stage_key if isinstance(stage_key, str) else None,
            attempt=attempt if isinstance(attempt, int) and attempt >= 1 else None,
        )

    def to_json(self) -> dict[str, Any]:
        """The state as it is stored.

        Returns:
            A JSON object with every key of the module's shape.
        """
        return {
            "position": self.position,
            "attempts": dict(self.attempts),
            "loop_rounds": dict(self.loop_rounds),
            "seq": self.seq,
            "executor_checkpoint": self.executor_checkpoint,
            "stage_key": self.stage_key,
            "attempt": self.attempt,
        }

    def move_to(self, position: str) -> None:
        """Step to the next node, between stages.

        Args:
            position: The node to execute next.
        """
        self.position = position
        self.stage_key = None
        self.attempt = None
        self.executor_checkpoint = None

    def mid_stage(self, stage_key: str) -> bool:
        """Whether a previous worker died, or paused, inside this stage.

        Args:
            stage_key: The stage about to run.

        Returns:
            ``True`` when the state records an unfinished attempt of it.
        """
        return self.stage_key == stage_key and self.attempt is not None
