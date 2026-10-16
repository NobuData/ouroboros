"""A run's check results and the ``require`` gate that judges them (AJ.3, #265)."""

from __future__ import annotations

import pytest

from ouroboros_engine.execution.checks import (
    CheckResult,
    checks_from_json,
    judge_checks,
)
from ouroboros_engine.execution.facts import judge
from ouroboros_engine.execution.state import ExecutionState
from ouroboros_engine.workflows.dsl import ChecksPredicate

BUILT = CheckResult(passed=True, exit_code=0, job_number=483, ccache_hit_rate_pct=78.4)
BROKEN = CheckResult(
    passed=False,
    failure="failed_build",
    exit_code=2,
    job_number=483,
    ccache_hit_rate_pct=78.4,
)
REVIEWED = CheckResult(passed=True)


def test_all_passed_holds_when_every_named_check_passed() -> None:
    verdict = judge_checks(
        "all_passed", ["build", "review"], {"build": BUILT, "review": REVIEWED}
    )

    assert verdict.holds is True
    assert verdict.clause == (
        "`build` passed (build #483, exit 0, ccache 78.4%); `review` passed"
    )
    assert verdict.failure is None


def test_a_failed_check_decides_even_while_another_has_no_result() -> None:
    verdict = judge_checks("all_passed", ["build", "test", "review"], {"build": BROKEN})

    assert verdict.holds is False
    assert verdict.clause == "`build` failed (build #483, exit 2, ccache 78.4%)"
    assert verdict.failure == "failed_build"


def test_a_named_check_without_a_result_is_unknown_never_a_pass() -> None:
    verdict = judge_checks("all_passed", ["build", "test"], {"build": BUILT})

    assert verdict.holds is None
    assert verdict.clause == "no result for `test` in this round"


def test_any_failed_is_the_mirror_of_all_passed() -> None:
    assert judge_checks("any_failed", ["build"], {"build": BROKEN}).holds is True
    assert judge_checks("any_failed", ["build"], {"build": BUILT}).holds is False
    assert judge_checks("any_failed", ["build"], {}).holds is None


def test_no_names_means_every_check_the_round_produced() -> None:
    assert judge_checks("all_passed", None, {"build": BUILT}).holds is True
    assert judge_checks("all_passed", None, {"build": BROKEN}).holds is False
    unknown = judge_checks("all_passed", None, {})
    assert (unknown.holds, unknown.clause) == (None, "no check has run in this round")


def test_ccache_not_measured_is_left_out_of_the_evidence_never_zero() -> None:
    result = CheckResult(passed=True, exit_code=0, job_number=7)

    assert result.describe("build") == "`build` passed (build #7, exit 0)"


def test_the_live_judge_reads_checks_and_carries_the_failure() -> None:
    predicate = ChecksPredicate(kind="checks", op="all_passed", names=["build"])

    judgement = judge(predicate, [], None, {"build": BROKEN})

    assert (judgement.holds, judgement.failure) == (False, "failed_build")
    assert judge(predicate, [], None, None).holds is None


def test_check_results_survive_a_checkpoint_round_trip() -> None:
    state = ExecutionState(position="checks-green", checks={"build": BROKEN})

    restored = ExecutionState.from_json(state.to_json())

    assert restored.checks == {"build": BROKEN}


@pytest.mark.parametrize(
    "stored",
    [
        None,
        "build",
        {"build": "passed"},
        {"build": {"passed": "yes"}},
    ],
)
def test_a_malformed_stored_check_is_dropped(stored: object) -> None:
    assert checks_from_json(stored) == {}


def test_a_stored_check_with_odd_fields_keeps_what_is_well_formed() -> None:
    restored = checks_from_json(
        {
            "build": {
                "passed": False,
                "failure": "exploded",
                "exit_code": True,
                "job_number": 9,
                "ccache_hit_rate_pct": 50,
            }
        }
    )

    assert restored == {
        "build": CheckResult(
            passed=False,
            failure=None,
            exit_code=None,
            job_number=9,
            ccache_hit_rate_pct=50.0,
        )
    }
