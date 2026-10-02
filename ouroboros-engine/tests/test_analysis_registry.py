"""Analyzer registration — the SPI's static rules, and the parameter ledger (#511)."""

from typing import Any, ClassVar

import pytest

from analysis_fakes import FakeAnalyzer, RaisesAnalyzer, ledger_for, path_of
from ouroboros_engine.analysis import registry as registry_module
from ouroboros_engine.analysis.changepoint import PARAMETERS, ChangePointAnalyzer
from ouroboros_engine.analysis.contract import Corpus, Finding
from ouroboros_engine.analysis.ledger import PARAMETER_LEDGER
from ouroboros_engine.analysis.registry import (
    BUILTIN_ANALYZERS,
    ENTRY_POINT_GROUP,
    AnalyzerRegistry,
    RegistrationError,
    default_registry,
    load_analyzer,
)
from ouroboros_engine.analysis.spi import parameters_fingerprint

CHANGE_POINT = "ouroboros_engine.analysis.changepoint:ChangePointAnalyzer"


class Retuned(ChangePointAnalyzer):
    """change_point v1 with a different penalty — the silent retune the ledger exists for."""

    parameters: ClassVar[dict[str, Any]] = {**PARAMETERS, "penalty_factor": 2}


class Bumped(Retuned):
    """The same retune, honestly versioned — but not yet pinned."""

    version: ClassVar[int] = 2


class BadId(RaisesAnalyzer):
    """An id the database would refuse."""

    id: ClassVar[str] = "Bad-Id"


class BadVersion(RaisesAnalyzer):
    """A version below one."""

    version: ClassVar[int] = 0


class NoRequirements(RaisesAnalyzer):
    """Requires nothing — so the harness could not tell when to skip it."""

    requires: ClassVar[frozenset[Any]] = frozenset()


class Unserializable(RaisesAnalyzer):
    """Parameters that cannot be fingerprinted."""

    parameters: ClassVar[dict[str, Any]] = {"when": object()}


class Abstract(FakeAnalyzer):
    """Declares everything but analyze()."""

    id: ClassVar[str] = "fake_abstract"


class NotAnAnalyzer:
    """Has the shape and none of the lineage."""

    id = "imposter"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Pretend.

        Args:
            corpus: Ignored.

        Returns:
            Nothing.
        """
        del corpus
        return []


def _register(cls: type, ledger: dict[str, str] | None = None) -> None:
    AnalyzerRegistry(
        ledger if ledger is not None else ledger_for(RaisesAnalyzer)
    ).register(f"{__name__}:{cls.__qualname__}")


def test_the_committed_ledger_pins_change_point_v1() -> None:
    assert PARAMETER_LEDGER["change_point@v1"] == parameters_fingerprint(PARAMETERS)


def test_retuning_without_a_version_bump_is_refused() -> None:
    with pytest.raises(RegistrationError, match="changed without a version bump"):
        AnalyzerRegistry().register(f"{__name__}:Retuned")


def test_a_bumped_version_must_be_pinned_before_it_runs() -> None:
    with pytest.raises(RegistrationError, match="not pinned"):
        AnalyzerRegistry().register(f"{__name__}:Bumped")
    pinned = {
        **PARAMETER_LEDGER,
        "change_point@v2": parameters_fingerprint(Bumped.parameters),
    }
    assert AnalyzerRegistry(pinned).register(f"{__name__}:Bumped").version == 2


@pytest.mark.parametrize(
    ("cls", "message"),
    [
        (BadId, "not a valid analyzer id"),
        (BadVersion, "version must be an integer"),
        (NoRequirements, "requires is a non-empty set"),
        (Unserializable, "not JSON-able"),
        (Abstract, "does not implement analyze"),
        (NotAnAnalyzer, "not an Analyzer subclass"),
    ],
)
def test_static_rules_are_checked_at_registration(cls: type, message: str) -> None:
    with pytest.raises(RegistrationError, match=message):
        _register(
            cls, {**ledger_for(RaisesAnalyzer), "Bad-Id@v1": "", "fake_raises@v0": ""}
        )


@pytest.mark.parametrize("path", ["no-colon", "a b:C", "ouroboros_engine:", ":Cls"])
def test_a_malformed_import_path_is_refused(path: str) -> None:
    with pytest.raises(RegistrationError, match="import path"):
        load_analyzer(path)


def test_an_id_registers_once() -> None:
    registry = AnalyzerRegistry(ledger_for(RaisesAnalyzer))
    registry.register(path_of(RaisesAnalyzer))
    with pytest.raises(RegistrationError, match="already registered"):
        registry.register(path_of(RaisesAnalyzer))


def test_the_default_registry_is_the_built_ins_in_id_order() -> None:
    registry = default_registry()

    assert BUILTIN_ANALYZERS == (CHANGE_POINT,)
    assert [(a.id, a.version, a.path) for a in registry] == [
        ("change_point", 1, CHANGE_POINT)
    ]
    assert registry.analyzer_set("deterministic analyzers v1") == {
        "label": "deterministic analyzers v1",
        "analyzers": [{"id": "change_point", "version": 1, "kind": "deterministic"}],
    }


class _EntryPoint:
    def __init__(self, value: str) -> None:
        self.value = value


def test_installed_analyzers_are_discovered_and_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[str] = []

    def entry_points(group: str) -> list[_EntryPoint]:
        seen.append(group)
        return [_EntryPoint(path_of(RaisesAnalyzer))]

    monkeypatch.setattr(registry_module, "entry_points", entry_points)

    registry = default_registry({**PARAMETER_LEDGER, **ledger_for(RaisesAnalyzer)})

    assert seen == [ENTRY_POINT_GROUP]
    assert [a.id for a in registry] == ["change_point", "fake_raises"]


def test_a_broken_installed_analyzer_fails_loudly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        registry_module,
        "entry_points",
        lambda **_: [_EntryPoint(path_of(RaisesAnalyzer))],
    )
    with pytest.raises(RegistrationError, match="not pinned"):
        default_registry()
