"""The task registry: which ``task_kind`` runs which handler, over which payload (#54).

A kind is registered once, with a closed pydantic model for its payload and an async
handler that takes the validated payload and returns a JSON object. The queue looks the
kind up at submission, so an unknown kind or a payload the handler could not run is refused
before anything is queued.

Two kinds ship: ``sleep`` — the lifecycle exemplar the acceptance criteria name — and
``echo``, which hands its payload back as its result. Real loop work registers here as it
lands.
"""

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: Longest a ``sleep`` task may sleep. A skeleton kind, so the bound is short: long enough
#: to watch a task run and cancel it, short enough that a forgotten one frees its worker.
MAX_SLEEP_SECONDS = 300.0

#: An async handler: the validated payload in, the task's result out.
Handler = Callable[[Any], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class TaskKind:
    """One registered kind.

    Attributes:
        name: The ``task_kind`` a caller names it by.
        payload_model: Validates the payload before the task is queued.
        handler: Runs the task with the validated payload.
    """

    name: str
    payload_model: type[BaseModel]
    handler: Handler


class UnknownTaskKindError(LookupError):
    """No handler is registered under the kind asked for."""


class TaskRegistry:
    """A lookup of every :class:`TaskKind` this process can run."""

    def __init__(self, kinds: Iterable[TaskKind] = ()) -> None:
        """Register ``kinds``.

        Args:
            kinds: The kinds to start with.

        Raises:
            ValueError: If two kinds share a name.
        """
        self._kinds: dict[str, TaskKind] = {}
        for kind in kinds:
            self.register(kind)

    def register(self, kind: TaskKind) -> None:
        """Add a kind.

        Args:
            kind: The kind to add.

        Raises:
            ValueError: If a kind of the same name is already registered — replacing one
                silently would change what an already-queued task runs.
        """
        if kind.name in self._kinds:
            raise ValueError(f"task kind {kind.name!r} is already registered")
        self._kinds[kind.name] = kind

    def get(self, name: str) -> TaskKind:
        """Look a kind up.

        Args:
            name: The ``task_kind``.

        Returns:
            The registered kind.

        Raises:
            UnknownTaskKindError: If nothing is registered under ``name``.
        """
        try:
            return self._kinds[name]
        except KeyError:
            raise UnknownTaskKindError(name) from None

    def names(self) -> list[str]:
        """Every registered kind's name, sorted.

        Returns:
            The names.
        """
        return sorted(self._kinds)


class SleepPayload(BaseModel):
    """The payload of a ``sleep`` task.

    Attributes:
        seconds: How long to sleep, from 0 to :data:`MAX_SLEEP_SECONDS`.
    """

    model_config = ConfigDict(extra="forbid")

    seconds: float = Field(ge=0, le=MAX_SLEEP_SECONDS)


async def sleep_handler(payload: SleepPayload) -> dict[str, Any]:
    """Sleep, then say for how long.

    Args:
        payload: The validated payload.

    Returns:
        ``{"slept_seconds": <seconds>}``.
    """
    await asyncio.sleep(payload.seconds)
    return {"slept_seconds": payload.seconds}


class EchoPayload(BaseModel):
    """The payload of an ``echo`` task: any object, handed back unchanged."""

    model_config = ConfigDict(extra="allow")


async def echo_handler(payload: EchoPayload) -> dict[str, Any]:
    """Hand the payload back.

    Args:
        payload: The validated payload.

    Returns:
        The payload as an object.
    """
    return payload.model_dump()


def default_registry() -> TaskRegistry:
    """The registry the application is built with.

    Returns:
        A registry holding ``sleep`` and ``echo``.
    """
    return TaskRegistry(
        [
            TaskKind("sleep", SleepPayload, sleep_handler),
            TaskKind("echo", EchoPayload, echo_handler),
        ]
    )
