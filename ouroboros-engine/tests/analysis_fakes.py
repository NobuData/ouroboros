"""Misbehaving analyzers for the harness tests (#511).

They live in a module of their own, importable by name, because the harness runs every
analyzer in a fresh sandbox process that imports it by ``module:qualname`` — the same way it
imports a real one. ``tests/`` is on that process's import path because it is on this one's.
"""

import contextlib
import os
import socket
import subprocess
import sys
import time
from typing import Any, ClassVar

import numpy as np

from ouroboros_engine.analysis.contract import (
    ConfidenceBasis,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    EvidenceRef,
    Finding,
    Grain,
)
from ouroboros_engine.analysis.spi import Analyzer, parameters_fingerprint

_BUILDS = frozenset({CorpusRequirement(source=CorpusSource.BUILDS, grain=Grain.BUILD)})


def finding(analyzer: str, subject: str, **data: Any) -> Finding:
    """A minimal valid finding.

    Args:
        analyzer: The analyzer id it claims.
        subject: Its subject key.
        **data: Its data.

    Returns:
        The finding, at version 1.
    """
    return Finding(
        analyzer=analyzer,
        analyzer_version=1,
        finding_type="custom:fake",
        subject_key=subject,
        data=data,
        evidence_refs=[EvidenceRef(kind="merge", id="abc1234")],
        confidence=50,
        confidence_basis=ConfidenceBasis(
            method="fake", sample_size=1, effect_size=0.0, stability=1.0
        ),
    )


class FakeAnalyzer(Analyzer):
    """The shared declarations."""

    version: ClassVar[int] = 1
    requires: ClassVar[frozenset[CorpusRequirement]] = _BUILDS
    parameters: ClassVar[dict[str, Any]] = {}


class RaisesAnalyzer(FakeAnalyzer):
    """Raises on every corpus — the failure-isolation case."""

    id: ClassVar[str] = "fake_raises"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Raise.

        Args:
            corpus: Ignored.

        Raises:
            RuntimeError: Always.
        """
        raise RuntimeError(f"malformed slice of {corpus.repo_ref}")


class SleepsAnalyzer(FakeAnalyzer):
    """Takes far longer than its budget."""

    id: ClassVar[str] = "fake_sleeps"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Sleep for a minute.

        Args:
            corpus: Ignored.

        Returns:
            Nothing — it is killed first.
        """
        del corpus
        time.sleep(60)
        return []


class HogsMemoryAnalyzer(FakeAnalyzer):
    """Allocates two gibibytes."""

    id: ClassVar[str] = "fake_hogs_memory"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Allocate more than any test budget.

        Args:
            corpus: Ignored.

        Returns:
            One finding — never reached under a budget.
        """
        del corpus
        hoard = bytearray(2 * 1024**3)
        return [finding(self.id, "hoard", size=len(hoard))]


class DialsOutAnalyzer(FakeAnalyzer):
    """Tries to open a TCP connection — and lets the failure escape."""

    id: ClassVar[str] = "fake_dials_out"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Connect to a local port.

        Args:
            corpus: Ignored.

        Returns:
            Nothing — the connection is refused by the sandbox first.
        """
        del corpus
        socket.create_connection(("127.0.0.1", 9), timeout=1)
        return []


class SwallowsViolationAnalyzer(FakeAnalyzer):
    """Tries to resolve a name, catches the refusal, and reports a finding anyway."""

    id: ClassVar[str] = "fake_swallows"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Attempt a lookup, ignore the outcome.

        Args:
            corpus: Ignored.

        Returns:
            A finding the harness must discard.
        """
        del corpus
        with contextlib.suppress(OSError):
            socket.getaddrinfo("example.com", 443)
        return [finding(self.id, "pretend")]


class SpawnsAnalyzer(FakeAnalyzer):
    """Tries to start a program — a way round the socket ban."""

    id: ClassVar[str] = "fake_spawns"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Run ``true``.

        Args:
            corpus: Ignored.

        Returns:
            Nothing.
        """
        del corpus
        subprocess.run(["true"], check=False)  # noqa: S607 — the attempt is the test
        return []


class ChattyAnalyzer(FakeAnalyzer):
    """Prints to stdout, reports what it can see of its environment and its seeds."""

    id: ClassVar[str] = "fake_chatty"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Print, then describe the sandbox.

        Args:
            corpus: Read for its build count.

        Returns:
            One finding describing the environment, the seeded draw and the hash seed.
        """
        sys.stdout.write("{not json at all\n")
        return [
            finding(
                self.id,
                "environment",
                builds=len(corpus.builds or []),
                variables=sorted(os.environ),
                # The legacy global generator — what the sandbox seeds.
                draw=float(np.random.random()),
                hash_seed=os.environ.get("PYTHONHASHSEED"),
            )
        ]


class ImpersonatesAnalyzer(FakeAnalyzer):
    """Emits a finding claiming to be another analyzer."""

    id: ClassVar[str] = "fake_impersonates"

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Claim change_point's identity.

        Args:
            corpus: Ignored.

        Returns:
            A finding the sandbox refuses.
        """
        del corpus
        return [finding("change_point", "forged")]


class NeedsEventsAnalyzer(FakeAnalyzer):
    """Requires the events source — skipped when the corpus lacks it."""

    id: ClassVar[str] = "fake_needs_events"
    requires: ClassVar[frozenset[CorpusRequirement]] = frozenset(
        {CorpusRequirement(source=CorpusSource.EVENTS, grain=Grain.EVENT)}
    )

    def analyze(self, corpus: Corpus) -> list[Finding]:
        """Never reached when events are absent.

        Args:
            corpus: Ignored.

        Returns:
            Nothing.
        """
        del corpus
        return []


def path_of(cls: type[Analyzer]) -> str:
    """The import path the registry and the sandbox load a fake by.

    Args:
        cls: The fake.

    Returns:
        ``analysis_fakes:<ClassName>``.
    """
    return f"{__name__}:{cls.__qualname__}"


def ledger_for(*classes: type[Analyzer]) -> dict[str, str]:
    """A ledger pinning each class's current parameters.

    Args:
        *classes: The analyzers.

    Returns:
        ``<id>@v<version>`` → fingerprint.
    """
    return {
        f"{c.id}@v{c.version}": parameters_fingerprint(c.parameters) for c in classes
    }
