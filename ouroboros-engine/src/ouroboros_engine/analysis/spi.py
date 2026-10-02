"""The Analyzer SPI — what one Build Analyzer analyzer is (decision A1).

BV.2 (`#511 <https://github.com/NobuData/ouroboros/issues/511>`_). An analyzer is a class with
an ``id``, a ``version``, the corpus it needs, its tuning ``parameters`` and one method,
:meth:`Analyzer.analyze`. Everything else — discovery, budgets, failure isolation, the network
ban — is the harness's, so an analyzer is only statistics.

**Determinism discipline.** Identical corpus → identical findings, byte for byte, is an
acceptance criterion, so an analyzer:

1. **seeds everything it samples.** The sandbox seeds :mod:`random` and numpy's legacy global
   generator to :data:`ANALYSIS_SEED`; an analyzer that wants a generator builds
   ``numpy.random.default_rng(ANALYSIS_SEED)`` rather than an unseeded one.
2. **never reads the wall clock or an entropy source.** "Today" is the corpus window's
   ``to``. Registration reads the analyzer's module and refuses ``time.time``,
   ``datetime.now``, ``date.today``, ``uuid4``, ``os.urandom``, ``secrets`` and an unseeded
   ``default_rng()`` (:mod:`~ouroboros_engine.analysis.determinism`). The clock is not
   patched out at run time: logging timestamps read it, and an analyzer that logs is not a
   defect.
3. **never depends on iteration order it did not choose.** Sort before emitting; never
   iterate a ``set`` into output. The reproducibility test runs every registered analyzer
   under two different ``PYTHONHASHSEED`` values and compares the bytes, which is what
   catches it.
4. **versions its parameters.** ``parameters`` is a plain JSON-able mapping, and its
   fingerprint is pinned per version in :mod:`ouroboros_engine.analysis.ledger`. A parameter
   change without a version bump is refused at registration — a silent retune would silently
   rewrite history.
5. **rounds before it emits.** Floats in ``data`` and the confidence basis are rounded to a
   documented number of places, so the canonical text is stable across platforms.
"""

import hashlib
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.analysis.contract import (
    Corpus,
    CorpusRequirement,
    Finding,
    canonical_json,
)

#: The one seed every analysis run uses. Fixed, so a sampled result is reproducible.
ANALYSIS_SEED = 20260809

#: The default per-analyzer budget — generous for daily statistics over 90 days.
DEFAULT_TIME_SECONDS = 120.0
DEFAULT_MEMORY_BYTES = 1024 * 1024 * 1024


class AnalyzerBudget(BaseModel):
    """How long, and how much address space, one analyzer may use in one run.

    Memory is the sandbox process's whole address space (``RLIMIT_AS``), interpreter and
    imports included — about 270 MiB before an analyzer allocates anything.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    time_seconds: Annotated[float, Field(gt=0)] = DEFAULT_TIME_SECONDS
    memory_bytes: Annotated[int, Field(ge=64 * 1024 * 1024)] = DEFAULT_MEMORY_BYTES


def parameters_fingerprint(parameters: Mapping[str, Any]) -> str:
    """The sha256 of a parameter mapping's canonical JSON — what the ledger pins.

    Args:
        parameters: An analyzer's ``parameters``.

    Returns:
        64 lowercase hex characters.
    """
    return hashlib.sha256(canonical_json(dict(parameters)).encode()).hexdigest()


class Analyzer(ABC):
    """One analyzer. Subclass it, set the class attributes, implement :meth:`analyze`.

    Attributes:
        id: The analyzer id — ``analysis_findings.analyzer`` and the run's ``analyzer_set``.
        version: Bumped with every change to ``parameters`` or to what the code computes.
        kind: ``deterministic`` until an LLM pass exists (BX.1); provenance for the meta strip.
        requires: The corpus sources it reads, at their grains. Absent ⇒ skipped.
        parameters: The documented tuning, JSON-able, pinned per version by the ledger.
        budget: The default time and memory budget; a run may override it.
    """

    id: ClassVar[str]
    version: ClassVar[int]
    kind: ClassVar[Literal["deterministic", "llm"]] = "deterministic"
    requires: ClassVar[frozenset[CorpusRequirement]]
    parameters: ClassVar[Mapping[str, Any]]
    budget: ClassVar[AnalyzerBudget] = AnalyzerBudget()

    @abstractmethod
    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Read the corpus and return findings.

        Runs inside the sandbox: no network, no subprocess, no wall clock, within budget.

        Args:
            corpus: The run's corpus. Every source in ``requires`` is present.

        Returns:
            The findings, in any order — the harness sorts them. An empty list is an answer
            ("nothing found"), never a failure.
        """
