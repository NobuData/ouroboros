"""The log-signature analyzer — templating, clustering and BA-1's numbers (#512)."""

import pytest

from analysis_pattern_fixtures import FROM, cited, corpus
from analysis_patterns_golden import mockup_corpus, uid
from ouroboros_engine.analysis.contract import Corpus, Finding
from ouroboros_engine.analysis.patterns.log_signature import (
    PARAMETERS,
    LogSignatureAnalyzer,
    family_of,
    is_marker,
    signature_hash,
    template_of,
)

FIXTURE = "FAIL - ota.fixture.shared_setup: fixture 'ota_image_server' setup timed out after <*>s"


def _tails(*builds: list[str]) -> Corpus:
    return corpus(
        log_tails=[
            {
                "build_id": uid("job", n + 1),
                "day": FROM.isoformat(),
                "label": "native_sim",
                "status": "failed",
                "line_count": len(lines),
                "lines": lines,
            }
            for n, lines in enumerate(builds)
        ]
    )


@pytest.fixture(scope="module")
def mockup() -> list[Finding]:
    return LogSignatureAnalyzer().analyze(mockup_corpus())


def test_the_fixture_timeout_is_31_builds_and_7_2_percent_of_ota_failures(
    mockup: list[Finding],
) -> None:
    (fixture,) = [f for f in mockup if f.data["template"] == FIXTURE]
    assert fixture.data["count"] == 31
    assert fixture.data["share"] == 0.072
    assert (fixture.data["family"], fixture.data["family_lines"]) == ("FAIL - ota", 430)
    assert len(fixture.data["sample_refs"]) == 3
    assert cited(fixture, fixture.data["sample_refs"])
    assert len(fixture.evidence_refs) == 31


def test_the_ccache_miss_is_118_builds(mockup: list[Finding]) -> None:
    (ccache,) = [f for f in mockup if "ccache#1412" in f.data["template"]]
    assert ccache.data["count"] == 118
    assert ccache.data["template"] == (
        "ccache: warning: manifest hash miss for <*> (ccache#1412)"
    )


def test_findings_record_that_the_logs_were_sampled(mockup: list[Finding]) -> None:
    assert {str(f.data["sampling"]) for f in mockup} == {
        str({"sampled": True, "rate": 0.3})
    }


@pytest.mark.parametrize(
    ("line", "template"),
    [
        (
            "FAIL - ota.fixture.shared_setup: fixture 'ota_image_server' setup timed out "
            "after 31.4s",
            FIXTURE,
        ),
        (
            "2026-07-01T12:00:01.123Z ERROR pid 4412 segfault at 0xdeadbeef in 3f2a9c1d0b",
            "<*> ERROR pid <*> segfault at <*> in <*>",
        ),
        (
            "error: /work/helios/drivers/can/can_mcan.c:212: implicit declaration",
            "error: <*> implicit declaration",
        ),
        (
            "FAIL - net.dhcp: no lease from 10.0.0.12:67 for 5eed0512-0000-4000-8000-000000000001",
            "FAIL - net.dhcp: no lease from <*> for <*>",
        ),
        (
            "ccache: warning: manifest hash miss for src/a.c (ccache#1412)",
            "ccache: warning: manifest hash miss for <*> (ccache#1412)",
        ),
        ("ERROR  in ota_v2   at 12:01:03", "ERROR in ota_v2 at <*>"),
    ],
)
def test_variable_tokens_are_masked_and_identity_is_kept(
    line: str, template: str
) -> None:
    assert template_of(line) == template


def test_a_family_is_the_first_tokens_cut_at_their_first_dot() -> None:
    assert family_of(FIXTURE) == "FAIL - ota"
    assert (
        family_of("ccache: warning: manifest hash miss") == "ccache: warning: manifest"
    )


def test_only_marker_lines_are_read() -> None:
    assert (
        is_marker("FAIL - x")
        and is_marker("cc1: error: bad")
        and is_marker("x timed out")
    )
    assert not is_marker("[12/400] Linking C executable zephyr.elf")
    assert not is_marker("FAILOVER configured")


def test_lines_that_differ_only_in_variable_parts_are_one_cluster() -> None:
    builds = [
        [f"FAIL - ota.fixture.shared_setup: fixture 'x' setup timed out after {n}.5s"]
        for n in range(5)
    ]

    (finding,) = LogSignatureAnalyzer().analyze(_tails(*builds))

    assert (finding.data["count"], finding.data["lines"]) == (5, 5)


def test_unrelated_failures_are_not_merged() -> None:
    # The negative fixture: same suite, same prefix, same shape — different failures.
    timeout = "FAIL - ota.fixture.shared_setup: fixture 'x' setup timed out after 3.0s"
    mismatch = "FAIL - ota.update.verify: signature mismatch in slot 1"
    rollback = "FAIL - ota.fixture.shared_setup: fixture 'x' teardown leaked 3 handles"
    builds = [[timeout], [timeout], [timeout], [mismatch]] * 1 + [
        [mismatch],
        [mismatch],
        [rollback],
        [rollback],
        [rollback],
    ]

    findings = LogSignatureAnalyzer().analyze(_tails(*builds))

    assert sorted((f.data["count"], f.data["template"]) for f in findings) == [
        (3, "FAIL - ota.fixture.shared_setup: fixture 'x' setup timed out after <*>s"),
        (3, "FAIL - ota.fixture.shared_setup: fixture 'x' teardown leaked <*> handles"),
        (3, "FAIL - ota.update.verify: signature mismatch in slot <*>"),
    ]
    assert {f.data["share"] for f in findings} == {0.333}


def test_cluster_ids_are_the_template_hash_and_stable_across_runs() -> None:
    builds = [["FAIL - a.b: broke at 0x10"]] * 3
    first = LogSignatureAnalyzer().analyze(_tails(*builds))
    second = LogSignatureAnalyzer().analyze(_tails(*builds))

    assert [f.subject_key for f in first] == [f.subject_key for f in second]
    assert first[0].subject_key == signature_hash("FAIL - a.b: broke at <*>")
    assert len(first[0].subject_key) == PARAMETERS["hash_chars"]


def test_a_template_seen_in_too_few_builds_is_not_a_finding() -> None:
    builds = [["FAIL - a.b: broke"]] * (PARAMETERS["min_builds"] - 1)
    assert LogSignatureAnalyzer().analyze(_tails(*builds)) == []


def test_empty_tails_find_nothing() -> None:
    assert LogSignatureAnalyzer().analyze(corpus(log_tails=[])) == []
