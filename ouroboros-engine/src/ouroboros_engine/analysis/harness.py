"""The execution harness — running a registry's analyzers over one corpus (#511).

One analyzer, one sandbox process (:mod:`ouroboros_engine.analysis.sandbox`), one outcome. The
harness is what makes an analyzer's failure *that analyzer's*:

* **Requirements first.** An analyzer whose required sources are absent from the corpus is
  ``skipped`` with the missing sources named — never run on nothing.
* **Failure isolation.** An exception, a crash, a sandbox violation or garbage on stdout is
  recorded as that analyzer's ``failed`` outcome, with a ``traceback_ref`` — the first 16 hex
  of the traceback's sha256 — and the full traceback logged under that ref, so a chronically
  failing analyzer is visible in the report and findable in the logs. The run continues.
* **Budgets.** Each analyzer runs under its own time and memory budget (its declared default,
  or the run's override): overrunning the time is ``timed_out`` (the process is killed),
  exhausting the memory is ``memory_exceeded``. An optional run-wide
  ``compute_ceiling_seconds`` caps the sum — BU.1's ``analysis_runs`` budget — and an analyzer
  the ceiling leaves no time for is ``not_run``; either way the report's ``budget_exceeded`` is
  set, which is the run's ``budget_exceeded`` status.
* **A clean, fixed environment.** The sandbox gets an allow-listed environment — the import
  path, single-threaded BLAS, and ``PYTHONHASHSEED`` — and nothing else from this process.

The report's findings are sorted by ``(analyzer, subject_key)``; :meth:`AnalysisReport.
findings_json` is their canonical bytes, which is what the reproducibility test compares.
Timings and outcomes are deliberately *not* in those bytes: they describe the run, not the
corpus.
"""

import hashlib
import json
import logging
import os
import subprocess
import sys
import time
from collections.abc import Iterator, Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.analysis.contract import (
    Corpus,
    Finding,
    OutcomeStatus,
    canonical_json,
    findings_json,
)
from ouroboros_engine.analysis.registry import AnalyzerRegistry, RegisteredAnalyzer
from ouroboros_engine.analysis.spi import AnalyzerBudget

_logger = logging.getLogger(__name__)

#: How the sandbox is started.
SANDBOX_COMMAND = (sys.executable, "-m", "ouroboros_engine.analysis.sandbox")

#: The default ``PYTHONHASHSEED`` — fixed, so set iteration order cannot vary between runs.
DEFAULT_HASH_SEED = "0"


class AnalyzerError(BaseModel):
    """Why an analyzer did not complete — the report's half; the traceback is in the log."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: str
    message: str
    traceback_ref: Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]


class AnalyzerOutcome(BaseModel):
    """How one analyzer's part of a run ended.

    Attributes:
        analyzer: Its id.
        version: Its version.
        status: ``completed``, ``skipped`` (inputs absent), ``failed``, ``timed_out``,
            ``memory_exceeded`` or ``not_run`` (the run's compute ceiling was reached).
        findings: What it found — empty unless ``completed``.
        reason: A sentence for anything but ``completed``.
        error: The exception, for ``failed`` and ``memory_exceeded``.
        elapsed_seconds: Wall time spent on it, sandbox start-up included.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    analyzer: str
    version: int
    status: OutcomeStatus
    findings: list[Finding] = []
    reason: str | None = None
    error: AnalyzerError | None = None
    elapsed_seconds: float = 0.0


class AnalysisReport(BaseModel):
    """Every analyzer's outcome for one run, in id order."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    outcomes: list[AnalyzerOutcome]
    budget_exceeded: bool = False

    @property
    def findings(self) -> list[Finding]:
        """Every completed analyzer's findings, ordered by ``(analyzer, subject_key)``."""
        found = [f for outcome in self.outcomes for f in outcome.findings]
        return sorted(found, key=lambda f: (f.analyzer, f.subject_key))

    @property
    def failed(self) -> list[str]:
        """The analyzers that failed, timed out or ran out of memory — what the run reports."""
        broken = {"failed", "timed_out", "memory_exceeded"}
        return [o.analyzer for o in self.outcomes if o.status in broken]

    def findings_json(self) -> str:
        """The findings' canonical bytes — identical corpus ⇒ identical text.

        Returns:
            :func:`~ouroboros_engine.analysis.contract.findings_json` of :attr:`findings`.
        """
        return findings_json(self.findings)


def sandbox_environment(hash_seed: str = DEFAULT_HASH_SEED) -> dict[str, str]:
    """The allow-listed environment a sandbox starts with.

    Args:
        hash_seed: ``PYTHONHASHSEED`` for the sandbox.

    Returns:
        The variables — the import path this process has, single-threaded numerics, a fixed
        locale, and nothing that could carry a secret.
    """
    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "PYTHONPATH": os.pathsep.join(entry for entry in sys.path if entry),
        "PYTHONHASHSEED": hash_seed,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUTF8": "1",
        # A fixed locale: nothing locale-dependent may vary between runs, and setting it
        # stops the interpreter coercing a C locale by adding LC_CTYPE of its own.
        "LC_ALL": "C.UTF-8",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
    }


def _traceback_ref(analyzer: str, traceback_text: str) -> str:
    """Log a traceback and return the ref the report carries for it.

    Args:
        analyzer: The analyzer it belongs to.
        traceback_text: The full traceback (or what the sandbox left on stderr).

    Returns:
        The first 16 hex of the text's sha256.
    """
    ref = hashlib.sha256(traceback_text.encode()).hexdigest()[:16]
    _logger.error(
        "analyzer did not complete",
        extra={"analyzer": analyzer, "traceback_ref": ref, "traceback": traceback_text},
    )
    return ref


def _run_one(
    entry: RegisteredAnalyzer,
    corpus_document: dict[str, Any],
    budget: AnalyzerBudget,
    timeout: float,
    hash_seed: str,
) -> tuple[OutcomeStatus, list[Finding], str | None, AnalyzerError | None]:
    """Run one analyzer in a sandbox and interpret what came back.

    Args:
        entry: The analyzer.
        corpus_document: The corpus, as JSON-able data.
        budget: Its budget — the memory half is applied in the sandbox.
        timeout: Seconds before the sandbox is killed.
        hash_seed: ``PYTHONHASHSEED`` for the sandbox.

    Returns:
        ``(status, findings, reason, error)``.
    """
    request = {
        "analyzer": entry.path,
        "corpus": corpus_document,
        "memory_bytes": budget.memory_bytes,
    }
    try:
        completed = subprocess.run(  # noqa: S603 — a fixed argv: this interpreter, a module
            SANDBOX_COMMAND,
            input=json.dumps(request),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=sandbox_environment(hash_seed),
            check=False,
        )
    except subprocess.TimeoutExpired:
        return "timed_out", [], f"exceeded its {timeout:g} s time budget", None

    try:
        result = json.loads(completed.stdout)
        status = result["status"]
    except (json.JSONDecodeError, KeyError, TypeError):
        text = completed.stderr[-4000:] or "(no output)"
        error = AnalyzerError(
            type="SandboxCrash",
            message=f"the sandbox exited {completed.returncode} without a result",
            traceback_ref=_traceback_ref(entry.id, text),
        )
        return "failed", [], error.message, error

    if status == "completed":
        try:
            findings = [Finding.model_validate(f) for f in result["findings"]]
        except (ValueError, KeyError, TypeError) as invalid:
            error = AnalyzerError(
                type=type(invalid).__name__,
                message="the sandbox returned findings that do not validate",
                traceback_ref=_traceback_ref(entry.id, str(invalid)),
            )
            return "failed", [], error.message, error
        return "completed", findings, None, None

    detail = result.get("error", {})
    error = AnalyzerError(
        type=str(detail.get("type", "Unknown")),
        message=str(detail.get("message", "")),
        traceback_ref=_traceback_ref(entry.id, str(detail.get("traceback", ""))),
    )
    if status == "memory_exceeded":
        reason = f"exceeded its {budget.memory_bytes} byte memory budget"
        return "memory_exceeded", [], reason, error
    return "failed", [], f"raised {error.type}: {error.message}", error


class AnalyzerStarted(BaseModel):
    """An analyzer's sandbox is about to start — the run's per-analyzer *running* tick.

    Emitted only for an analyzer that actually runs: a ``skipped`` or ``not_run`` analyzer
    goes straight to its :class:`AnalyzerFinished`.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    event: Literal["started"] = "started"
    analyzer: str
    version: int


class AnalyzerFinished(BaseModel):
    """One analyzer's outcome, as soon as it is known."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    event: Literal["outcome"] = "outcome"
    outcome: AnalyzerOutcome


class AnalysisFinished(BaseModel):
    """The run's summary — always the last event of a run that was not cut short.

    Attributes:
        budget_exceeded: The run's compute ceiling bound (the run's ``budget_exceeded``).
        failed: The analyzers that failed, timed out or ran out of memory.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    event: Literal["report"] = "report"
    budget_exceeded: bool
    failed: list[str]


#: One event of a streamed run, in the order :func:`iter_analysis` yields them.
AnalysisEvent = AnalyzerStarted | AnalyzerFinished | AnalysisFinished


def iter_analysis(
    registry: AnalyzerRegistry,
    corpus: Corpus,
    *,
    budgets: Mapping[str, AnalyzerBudget] | None = None,
    compute_ceiling_seconds: float | None = None,
    hash_seed: str = DEFAULT_HASH_SEED,
) -> Iterator[AnalysisEvent]:
    """Run every registered analyzer over a corpus, yielding progress as it happens.

    The streaming form of :func:`run_analysis`, which is this generator collected — so the two
    cannot disagree. ``POST /v0/analysis/runs`` (#510) forwards each event as it is yielded,
    which is what makes the UI's per-analyzer run states real rather than a spinner.

    Args:
        registry: The analyzers to run.
        corpus: The run's corpus.
        budgets: Per-analyzer overrides, by id; an analyzer not named uses its own default.
        compute_ceiling_seconds: The run-wide cap on the sum of analyzer time, or ``None``.
        hash_seed: ``PYTHONHASHSEED`` for every sandbox.

    Yields:
        For each analyzer in id order, an :class:`AnalyzerStarted` when its sandbox starts
        (only if it runs) and an :class:`AnalyzerFinished` with its outcome; then one
        :class:`AnalysisFinished`.
    """
    budgets = budgets or {}
    corpus_document = json.loads(
        canonical_json(corpus.model_dump(mode="json", by_alias=True))
    )
    available = corpus.available()
    spent = 0.0
    budget_exceeded = False
    outcomes: list[AnalyzerOutcome] = []

    def finished(outcome: AnalyzerOutcome) -> AnalyzerFinished:
        outcomes.append(outcome)
        return AnalyzerFinished(outcome=outcome)

    for entry in registry:
        missing = sorted(
            f"{r.source.value}@{r.grain.value}" for r in entry.cls.requires - available
        )
        if missing:
            yield finished(
                AnalyzerOutcome(
                    analyzer=entry.id,
                    version=entry.version,
                    status="skipped",
                    reason="the corpus lacks " + ", ".join(missing),
                )
            )
            continue

        budget = budgets.get(entry.id, entry.cls.budget)
        timeout = budget.time_seconds
        capped = False
        if compute_ceiling_seconds is not None:
            remaining = compute_ceiling_seconds - spent
            if remaining <= 0:
                budget_exceeded = True
                yield finished(
                    AnalyzerOutcome(
                        analyzer=entry.id,
                        version=entry.version,
                        status="not_run",
                        reason="the run's compute ceiling was reached",
                    )
                )
                continue
            if remaining < timeout:
                timeout, capped = remaining, True

        yield AnalyzerStarted(analyzer=entry.id, version=entry.version)
        started = time.monotonic()
        status, findings, reason, error = _run_one(
            entry, corpus_document, budget, timeout, hash_seed
        )
        elapsed = time.monotonic() - started
        spent += elapsed
        if status == "timed_out" and capped:
            budget_exceeded = True
            reason = "stopped at the run's compute ceiling"
        yield finished(
            AnalyzerOutcome(
                analyzer=entry.id,
                version=entry.version,
                status=status,
                findings=findings,
                reason=reason,
                error=error,
                elapsed_seconds=round(elapsed, 3),
            )
        )

    report = AnalysisReport(outcomes=outcomes, budget_exceeded=budget_exceeded)
    yield AnalysisFinished(budget_exceeded=budget_exceeded, failed=report.failed)


def run_analysis(
    registry: AnalyzerRegistry,
    corpus: Corpus,
    *,
    budgets: Mapping[str, AnalyzerBudget] | None = None,
    compute_ceiling_seconds: float | None = None,
    hash_seed: str = DEFAULT_HASH_SEED,
) -> AnalysisReport:
    """Run every registered analyzer over a corpus, each isolated and budgeted.

    :func:`iter_analysis`, collected.

    Args:
        registry: The analyzers to run.
        corpus: The run's corpus.
        budgets: Per-analyzer overrides, by id; an analyzer not named uses its own default.
        compute_ceiling_seconds: The run-wide cap on the sum of analyzer time, or ``None``.
        hash_seed: ``PYTHONHASHSEED`` for every sandbox. Fixed by default; the
            reproducibility test varies it to prove findings do not depend on it.

    Returns:
        One outcome per registered analyzer, in id order.
    """
    outcomes: list[AnalyzerOutcome] = []
    budget_exceeded = False
    for event in iter_analysis(
        registry,
        corpus,
        budgets=budgets,
        compute_ceiling_seconds=compute_ceiling_seconds,
        hash_seed=hash_seed,
    ):
        if isinstance(event, AnalyzerFinished):
            outcomes.append(event.outcome)
        elif isinstance(event, AnalysisFinished):
            budget_exceeded = event.budget_exceeded
    return AnalysisReport(outcomes=outcomes, budget_exceeded=budget_exceeded)
