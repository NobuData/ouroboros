"""The config-usage analyzer — BA-4's numbers and sampling-aware absence claims (#512)."""

import pytest

from analysis_pattern_fixtures import FULL, corpus, job
from analysis_patterns_golden import DEAD_OPTIONS, mockup_corpus, uid
from ouroboros_engine.analysis.contract import Corpus, Finding
from ouroboros_engine.analysis.patterns.config_usage import (
    PARAMETERS,
    ConfigUsageAnalyzer,
    config_usage_findings,
)

SAMPLED = {"sampled": True, "rate": 0.4, "cap": "max_builds"}


def _small(sampling: dict | None, *, tails: bool = True) -> Corpus:
    jobs = [
        job(
            n,
            config={"CONFIG_USED": "y", "CONFIG_CONST": "1"}
            if n % 2
            else {"CONFIG_CONST": "1"},
        )
        for n in range(1, 11)
    ]
    sources: dict = {
        "jobs": jobs,
        "config_options": [
            {"name": name}
            for name in ("CONFIG_CONST", "CONFIG_DEAD", "CONFIG_DRIFTS", "CONFIG_USED")
        ],
        "sampling": sampling,
    }
    if tails:
        sources["log_tails"] = [
            {
                "build_id": uid("job", 3),
                "day": jobs[2]["day"],
                "label": "zephyr build",
                "status": "succeeded",
                "line_count": 1,
                "lines": [
                    "warning: CONFIG_DRIFTS (defined at boards/x/Kconfig:3) was assigned "
                    "the value 'y' but got the value 'n'"
                ],
            }
        ]
    return corpus(**sources)


def _by_option(findings: list[Finding]) -> dict[str, dict]:
    return {f.subject_key: f.data for f in findings}


@pytest.fixture(scope="module")
def mockup() -> list[Finding]:
    return ConfigUsageAnalyzer().analyze(mockup_corpus())


def test_twelve_options_are_set_by_0_of_1284_builds(mockup: list[Finding]) -> None:
    assert sorted(f.subject_key for f in mockup) == sorted(DEAD_OPTIONS)
    assert {(f.data["occurrences"], f.data["builds_considered"]) for f in mockup} == {
        (0, 1284)
    }
    assert {f.data["claim"] for f in mockup} == {"never_set"}
    assert sum(f.data["drift_warnings"] for f in mockup) == 4


def test_a_full_read_makes_an_unqualified_absence_claim(mockup: list[Finding]) -> None:
    assert {f.data["qualified"] for f in mockup} == {False}
    assert {f.confidence for f in mockup} == {PARAMETERS["exhaustive_confidence"]}


def test_never_set_never_varied_and_drift_are_each_claimed() -> None:
    data = _by_option(config_usage_findings(_small({"jobs": FULL}), "qualify"))

    assert data["CONFIG_DEAD"]["claim"] == "never_set"
    assert data["CONFIG_CONST"]["claim"] == "never_varied"
    assert data["CONFIG_DRIFTS"]["claim"] == "never_set"
    assert data["CONFIG_DRIFTS"]["drift_warnings"] == 1
    assert "CONFIG_USED" not in data, "set by half the builds, two values: no claim"


def test_a_sampled_corpus_qualifies_the_absence_claim() -> None:
    findings = config_usage_findings(_small({"jobs": SAMPLED}), "qualify")
    dead = next(f for f in findings if f.subject_key == "CONFIG_DEAD")

    assert dead.data["qualified"] is True
    assert dead.data["qualification"] == "absence observed in a sampled corpus"
    assert dead.data["sampling"] == {"sampled": True, "rate": 0.4}
    assert dead.confidence <= PARAMETERS["sampled_confidence_cap"]


def test_a_sampled_corpus_can_suppress_the_absence_claim() -> None:
    findings = config_usage_findings(_small({"jobs": SAMPLED}), "suppress")

    # Absence (never set, never varied) is gone; nothing is claimed absent on a sample.
    assert [f.data["claim"] for f in findings] == []


def test_unknown_sampling_is_treated_as_possibly_sampled() -> None:
    findings = config_usage_findings(_small(None), "qualify")
    dead = next(f for f in findings if f.subject_key == "CONFIG_DEAD")

    assert dead.data["qualified"] is True
    assert dead.data["sampling"] == {"sampled": None, "rate": None}
    assert "unknown" in dead.data["qualification"]
    assert config_usage_findings(_small(None), "suppress") == []


def test_a_drift_claim_is_a_presence_claim_and_is_never_suppressed() -> None:
    small = _small({"jobs": SAMPLED})
    jobs = [
        {**row, "config": {**row["config"], "CONFIG_DRIFTS": "y"}}
        for row in small.model_dump(mode="json", by_alias=True)["jobs"]
    ]
    jobs[0]["config"]["CONFIG_DRIFTS"] = "n"
    drifting = small.model_copy(update={"jobs": corpus(jobs=jobs).jobs})

    (finding,) = [
        f
        for f in config_usage_findings(drifting, "suppress")
        if f.subject_key == "CONFIG_DRIFTS"
    ]
    assert finding.data["claim"] == "drift" and finding.data["qualified"] is False


def test_without_log_tails_drift_is_unknown_not_zero() -> None:
    findings = config_usage_findings(_small({"jobs": FULL}, tails=False), "qualify")

    assert all("drift_warnings" not in f.data for f in findings)


def test_jobs_with_unknown_configuration_are_not_considered() -> None:
    jobs = [job(1, config={"CONFIG_A": "y"}), {**job(2), "config": None}]
    (finding,) = ConfigUsageAnalyzer().analyze(
        corpus(
            jobs=jobs, config_options=[{"name": "CONFIG_B"}], sampling={"jobs": FULL}
        )
    )
    assert finding.data["builds_considered"] == 1


def test_no_considered_builds_claims_nothing() -> None:
    assert (
        ConfigUsageAnalyzer().analyze(
            corpus(jobs=[], config_options=[{"name": "CONFIG_A"}])
        )
        == []
    )


def test_an_unknown_policy_is_refused() -> None:
    with pytest.raises(ValueError, match="not known"):
        config_usage_findings(_small(None), "delete")  # type: ignore[arg-type]
