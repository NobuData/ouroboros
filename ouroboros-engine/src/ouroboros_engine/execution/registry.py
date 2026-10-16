"""Which stage executors this process can run — empty until an adapter registers one.

#160. The interpreter asks the registry for a fresh :class:`~ouroboros_engine.execution.spi.StageExecutor`
per stage attempt, and the queue worker asks it which kinds to declare on a claim, so a
process with nothing registered claims nothing and executes nothing (``no_executor``). The
concrete executors are DH.3 (#1308) and DH.5 (#1309); until they land the registry is empty,
and the tests register DH.1's fakes.

This module never imports :mod:`ouroboros_engine.execution.executors` (ruff ``TID251``): an
adapter registers itself here with a factory, the core never reaches for it.
"""

from __future__ import annotations

from collections.abc import Callable

from ouroboros_engine.execution.spi import EXECUTOR_KINDS, StageExecutor

#: Makes one executor instance — one instance serves one stage attempt.
ExecutorFactory = Callable[[], StageExecutor]


class UnknownExecutorError(LookupError):
    """No executor of the asked-for kind is registered."""


class ExecutorRegistry:
    """Executor factories by kind."""

    def __init__(self) -> None:
        """Make an empty registry."""
        self._factories: dict[str, ExecutorFactory] = {}

    def register(self, kind: str, factory: ExecutorFactory) -> None:
        """Register the factory for one kind, replacing any before it.

        Args:
            kind: ``native`` or ``harness``.
            factory: Makes a fresh executor of that kind.

        Raises:
            ValueError: If the kind is not one the SPI defines.
        """
        if kind not in EXECUTOR_KINDS:
            raise ValueError(f"{kind!r} is not an executor kind")
        self._factories[kind] = factory

    def kinds(self) -> list[str]:
        """The registered kinds.

        Returns:
            Sorted; empty when nothing is registered.
        """
        return sorted(self._factories)

    def create(self, kind: str) -> StageExecutor:
        """A fresh executor of one kind.

        Args:
            kind: The kind.

        Returns:
            A new instance, for one stage attempt.

        Raises:
            UnknownExecutorError: If nothing of that kind is registered.
        """
        factory = self._factories.get(kind)
        if factory is None:
            raise UnknownExecutorError(f"no {kind} executor is registered")
        return factory()

    def default_kind(self) -> str | None:
        """The kind a model stage runs under when its document names none.

        Returns:
            The first registered kind in the SPI's order (``native`` before ``harness``),
            or ``None`` when nothing is registered.
        """
        return next((kind for kind in EXECUTOR_KINDS if kind in self._factories), None)
