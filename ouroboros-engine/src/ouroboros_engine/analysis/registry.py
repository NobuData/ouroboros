"""Analyzer discovery and registration (#511).

An analyzer is registered by **import path** — ``"package.module:ClassName"`` — rather than by
class object, because the harness runs it in a fresh sandbox process that has to import it
again by name. Registration is where the SPI's static rules are checked, once, before any run:

* the class subclasses :class:`~ouroboros_engine.analysis.spi.Analyzer` and is concrete;
* ``id`` has the database's shape, ``version`` is ≥ 1, ``kind`` is a known kind;
* ``requires`` is a non-empty set of corpus requirements;
* ``parameters`` is JSON-able, and its fingerprint is the one
  :mod:`~ouroboros_engine.analysis.ledger` pins for ``id@vversion``;
* its module reads no clock and no entropy source
  (:mod:`~ouroboros_engine.analysis.determinism`);
* no two registered analyzers share an id.

**Discovery** is the built-ins (:data:`BUILTIN_ANALYZERS`) plus any installed package that
declares an entry point in :data:`ENTRY_POINT_GROUP`, registered in sorted order so a run's
analyzer set does not depend on install order. BX.5's custom-analyzer SDK publishes that group
as a contract; until then it exists so the registry is the one door, not a second one later.
"""

import importlib
import inspect
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from importlib.metadata import entry_points
from typing import Any

from ouroboros_engine.analysis.contract import ANALYZER_ID_PATTERN, CorpusRequirement
from ouroboros_engine.analysis.determinism import check_class
from ouroboros_engine.analysis.ledger import PARAMETER_LEDGER
from ouroboros_engine.analysis.spi import (
    Analyzer,
    AnalyzerBudget,
    parameters_fingerprint,
)

#: The analyzers this engine ships.
BUILTIN_ANALYZERS: tuple[str, ...] = (
    "ouroboros_engine.analysis.changepoint:ChangePointAnalyzer",
)

#: The entry-point group an installed package registers analyzers under.
ENTRY_POINT_GROUP = "ouroboros_engine.analyzers"

_PATH = re.compile(r"^[A-Za-z_][\w.]*:[A-Za-z_][\w.]*$")


class RegistrationError(ValueError):
    """An analyzer broke one of the SPI's static rules and was not registered."""


def load_analyzer(path: str) -> type[Analyzer]:
    """Import an analyzer class by ``module:qualname``.

    Args:
        path: The import path.

    Returns:
        The class.

    Raises:
        RegistrationError: The path is malformed, or does not name an Analyzer subclass.
    """
    if not _PATH.fullmatch(path):
        raise RegistrationError(f"{path!r} is not a module:qualname import path")
    module_name, qualname = path.split(":", 1)
    target: Any = importlib.import_module(module_name)
    for part in qualname.split("."):
        target = getattr(target, part)
    if not (inspect.isclass(target) and issubclass(target, Analyzer)):
        raise RegistrationError(f"{path} is not an Analyzer subclass")
    return target


@dataclass(frozen=True)
class RegisteredAnalyzer:
    """An analyzer that passed registration.

    Attributes:
        path: The import path the sandbox loads it by.
        cls: The class.
    """

    path: str
    cls: type[Analyzer]

    @property
    def id(self) -> str:
        """The analyzer id."""
        return self.cls.id

    @property
    def version(self) -> int:
        """The analyzer version."""
        return self.cls.version


class AnalyzerRegistry:
    """The analyzers a run may execute, keyed by id."""

    def __init__(self, ledger: Mapping[str, str] = PARAMETER_LEDGER) -> None:
        """Create an empty registry checked against a parameter ledger.

        Args:
            ledger: ``<id>@v<version>`` → parameter fingerprint. The committed ledger by
                default; a test may pass its own.
        """
        self._ledger = dict(ledger)
        self._analyzers: dict[str, RegisteredAnalyzer] = {}

    def register(self, path: str) -> RegisteredAnalyzer:
        """Check an analyzer against the SPI's static rules and register it.

        Args:
            path: Its ``module:qualname`` import path.

        Returns:
            The registration.

        Raises:
            RegistrationError: Any rule in the module docstring is broken.
        """
        cls = load_analyzer(path)
        if inspect.isabstract(cls):
            raise RegistrationError(f"{path} does not implement analyze()")
        for attribute in ("id", "version", "requires", "parameters"):
            if not hasattr(cls, attribute):
                raise RegistrationError(f"{path} does not declare {attribute}")
        if not isinstance(cls.id, str) or not re.fullmatch(ANALYZER_ID_PATTERN, cls.id):
            raise RegistrationError(f"{path}: id {cls.id!r} is not a valid analyzer id")
        if (
            not isinstance(cls.version, int)
            or isinstance(cls.version, bool)
            or cls.version < 1
        ):
            raise RegistrationError(f"{path}: version must be an integer ≥ 1")
        if cls.kind not in ("deterministic", "llm"):
            raise RegistrationError(f"{path}: kind {cls.kind!r} is not known")
        if (
            not isinstance(cls.requires, frozenset)
            or not cls.requires
            or not all(isinstance(r, CorpusRequirement) for r in cls.requires)
        ):
            raise RegistrationError(
                f"{path}: requires is a non-empty set of requirements"
            )
        if not isinstance(cls.budget, AnalyzerBudget):
            raise RegistrationError(f"{path}: budget is an AnalyzerBudget")
        try:
            fingerprint = parameters_fingerprint(cls.parameters)
        except (TypeError, ValueError) as error:
            raise RegistrationError(f"{path}: parameters are not JSON-able") from error

        key = f"{cls.id}@v{cls.version}"
        pinned = self._ledger.get(key)
        if pinned is None:
            raise RegistrationError(f"{key} is not pinned in the parameter ledger")
        if pinned != fingerprint:
            raise RegistrationError(
                f"{key}'s parameters changed without a version bump "
                f"(ledger {pinned[:12]}…, code {fingerprint[:12]}…)"
            )
        nondeterministic = check_class(cls)
        if nondeterministic:
            raise RegistrationError(
                f"{path} breaks the determinism discipline: "
                + "; ".join(nondeterministic)
            )
        if cls.id in self._analyzers:
            raise RegistrationError(f"analyzer id {cls.id!r} is already registered")

        registered = RegisteredAnalyzer(path=path, cls=cls)
        self._analyzers[cls.id] = registered
        return registered

    def __iter__(self) -> Iterator[RegisteredAnalyzer]:
        """Iterate the registered analyzers in id order.

        Returns:
            An iterator over the registrations.
        """
        return iter([self._analyzers[key] for key in sorted(self._analyzers)])

    def __len__(self) -> int:
        """Count the registered analyzers.

        Returns:
            How many.
        """
        return len(self._analyzers)

    def analyzer_set(self, label: str) -> dict[str, Any]:
        """The run's provenance record, in ``analysis_runs.analyzer_set``'s shape (``V080``).

        Args:
            label: What *Analyzed by* renders — ``deterministic analyzers v1``.

        Returns:
            ``{label, analyzers: [{id, version, kind}, …]}`` in id order.
        """
        return {
            "label": label,
            "analyzers": [
                {"id": a.id, "version": a.version, "kind": a.cls.kind} for a in self
            ],
        }


def default_registry(ledger: Mapping[str, str] = PARAMETER_LEDGER) -> AnalyzerRegistry:
    """The built-in analyzers plus any installed under :data:`ENTRY_POINT_GROUP`.

    Args:
        ledger: The parameter ledger to check them against — the committed one by default.

    Returns:
        A registry with every discovered analyzer registered, in sorted order.

    Raises:
        RegistrationError: A discovered analyzer breaks a rule — loudly, at start-up,
            rather than by being quietly absent from every run.
    """
    registry = AnalyzerRegistry(ledger)
    discovered = sorted(e.value for e in entry_points(group=ENTRY_POINT_GROUP))
    for path in (*BUILTIN_ANALYZERS, *discovered):
        registry.register(path)
    return registry
