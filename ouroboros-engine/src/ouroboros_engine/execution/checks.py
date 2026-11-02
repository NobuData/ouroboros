"""A run's check results — what a ``gate({require: [...]})`` decides on (AJ.3, #265).

A check is a stage that has run in the current loop round, named by its node id — the names a
``checks`` predicate lists (``require: ["build", "test", "review"]``). Two kinds of stage
produce one:

* **a build stage** (an ``infra`` node) — the farm job's **real exit code**: ``0`` passed, any
  other failed, with the job's number and its ccache hit rate carried as evidence;
* **a model stage** that succeeded — it passed; a model stage that fails ends the run before
  any gate is reached, so it never produces a failed check.

Results live in the walk's checkpoint (:class:`~ouroboros_engine.execution.state.ExecutionState`),
so a restarted worker judges the same gate the same way, and are **cleared when a gate loops
back**: the next round's builds are what its gate decides on, never the last round's.

Judging is three-valued, like every predicate an executing run judges
(:mod:`~ouroboros_engine.execution.facts`). A named check that **failed** decides at once —
``all_passed`` does not hold, ``any_failed`` does — whatever else is missing; a named check
with **no result** is unknown, and an unknown gate fails the run saying so. A result is never
assumed.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

#: Why a failed check sends the run back — the stage transition's ``returnedFrom.reason``.
CheckFailure = Literal["failed_build", "failed_tests", "failed_checks"]


@dataclass(frozen=True, slots=True)
class CheckResult:
    """One check's result.

    Attributes:
        passed: Whether it passed.
        failure: Why it failed, as the loop's return reason; ``None`` when it passed.
        exit_code: A build's exit code, or ``None`` for a model stage.
        job_number: The farm job's number — ``#483`` — or ``None``.
        ccache_hit_rate_pct: The build's ccache hit rate, or ``None`` when not measured.
    """

    passed: bool
    failure: CheckFailure | None = None
    exit_code: int | None = None
    job_number: int | None = None
    ccache_hit_rate_pct: float | None = None

    def to_json(self) -> dict[str, Any]:
        """The result as the checkpoint stores it.

        Returns:
            A JSON object.
        """
        return {
            "passed": self.passed,
            "failure": self.failure,
            "exit_code": self.exit_code,
            "job_number": self.job_number,
            "ccache_hit_rate_pct": self.ccache_hit_rate_pct,
        }

    @classmethod
    def from_json(cls, stored: object) -> CheckResult | None:
        """Read a stored result, dropping one that is not well formed.

        Args:
            stored: What the checkpoint held.

        Returns:
            The result, or ``None``.
        """
        if not isinstance(stored, dict) or not isinstance(stored.get("passed"), bool):
            return None
        failure = stored.get("failure")
        exit_code = stored.get("exit_code")
        job = stored.get("job_number")
        rate = stored.get("ccache_hit_rate_pct")
        return cls(
            passed=stored["passed"],
            failure=failure
            if failure in ("failed_build", "failed_tests", "failed_checks")
            else None,
            exit_code=exit_code if _is_int(exit_code) else None,
            job_number=job if _is_int(job) else None,
            ccache_hit_rate_pct=float(rate)
            if isinstance(rate, int | float) and not isinstance(rate, bool)
            else None,
        )

    def describe(self, name: str) -> str:
        """The result as a clause — *"`build` failed (build #483, exit 2, ccache 78.4%)"*.

        Args:
            name: The check's name.

        Returns:
            A lower-case clause with no full stop.
        """
        evidence = [
            part
            for part in (
                None if self.job_number is None else f"build #{self.job_number}",
                None if self.exit_code is None else f"exit {self.exit_code}",
                None
                if self.ccache_hit_rate_pct is None
                else f"ccache {self.ccache_hit_rate_pct:g}%",
            )
            if part is not None
        ]
        verdict = "passed" if self.passed else "failed"
        return f"`{name}` {verdict}" + (f" ({', '.join(evidence)})" if evidence else "")


def _is_int(value: object) -> bool:
    """Whether a stored value is an integer and not a boolean.

    Args:
        value: The value.

    Returns:
        ``True`` for an ``int`` that is not a ``bool``.
    """
    return isinstance(value, int) and not isinstance(value, bool)


def checks_from_json(stored: object) -> dict[str, CheckResult]:
    """Read the checkpoint's ``checks`` map, dropping what is not well formed.

    Args:
        stored: What the checkpoint held.

    Returns:
        The results by check name.
    """
    if not isinstance(stored, dict):
        return {}
    found: dict[str, CheckResult] = {}
    for name, value in stored.items():
        result = CheckResult.from_json(value)
        if result is not None:
            found[str(name)] = result
    return found


@dataclass(frozen=True, slots=True)
class ChecksVerdict:
    """A ``checks`` predicate, judged.

    Attributes:
        holds: Whether it holds, or ``None`` when a named check has no result.
        clause: Why, as a lower-case clause with no full stop.
        failure: The first failed check's return reason, when one failed.
    """

    holds: bool | None
    clause: str
    failure: CheckFailure | None = None


def judge_checks(
    op: Literal["all_passed", "any_failed"],
    names: list[str] | None,
    checks: Mapping[str, CheckResult],
) -> ChecksVerdict:
    """Judge a ``checks`` predicate against this round's results.

    Args:
        op: ``all_passed`` or ``any_failed``.
        names: The checks it names; ``None`` means every check the round produced.
        checks: This round's results.

    Returns:
        The verdict. A failed named check decides; a missing one is unknown.
    """
    wanted = list(checks) if names is None else names
    if not wanted:
        return ChecksVerdict(holds=None, clause="no check has run in this round")
    failed = [name for name in wanted if name in checks and not checks[name].passed]
    if failed:
        first = checks[failed[0]]
        clause = "; ".join(checks[name].describe(name) for name in failed)
        return ChecksVerdict(
            holds=op == "any_failed", clause=clause, failure=first.failure
        )
    missing = [name for name in wanted if name not in checks]
    if missing:
        listed = ", ".join(f"`{name}`" for name in missing)
        return ChecksVerdict(holds=None, clause=f"no result for {listed} in this round")
    clause = "; ".join(checks[name].describe(name) for name in wanted)
    return ChecksVerdict(holds=op == "all_passed", clause=clause)
