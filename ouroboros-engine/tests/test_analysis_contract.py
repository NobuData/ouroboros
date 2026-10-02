"""The analysis contract — findings as BU.2 stores them, the corpus as BV.1 must deliver it."""

import json

import pytest
from pydantic import ValidationError

from analysis_fakes import finding
from ouroboros_engine.analysis.contract import (
    SOURCE_GRAINS,
    BuildSample,
    CandidateEvent,
    Corpus,
    CorpusRequirement,
    CorpusSource,
    DayWindow,
    EvidenceRef,
    Finding,
    Grain,
    canonical_json,
    findings_json,
)
from ouroboros_engine.analysis.harness import AnalysisReport, AnalyzerOutcome

UUID = "000000b0-0000-0000-0000-000000000001"


def _finding(**overrides: object) -> dict[str, object]:
    base = finding("change_point", "build.duration_median@2026-06-22").model_dump(
        mode="json"
    )
    base.update(overrides)
    return base


def test_a_valid_finding_round_trips_with_its_identity() -> None:
    parsed = Finding.model_validate(_finding())

    assert parsed.identity_key == "change_point@v1/build.duration_median@2026-06-22"
    assert Finding.model_validate(parsed.model_dump(mode="json")) == parsed


@pytest.mark.parametrize(
    "overrides",
    [
        {"analyzer": "Change Point"},
        {"analyzer_version": 0},
        {"finding_type": "text"},
        {"finding_type": "custom:"},
        {"subject_key": " "},
        {"subject_key": "two\nlines"},
        {"subject_key": "x" * 513},
        {"evidence_refs": []},
        {"evidence_refs": [{"kind": "merge", "id": "abc1234"}] * 2},
        {"evidence_refs": [{"kind": "build", "id": "31 builds"}]},
        {"evidence_refs": [{"kind": "merge", "id": "enable ccache"}]},
        {"evidence_refs": [{"kind": "ticket", "id": UUID}]},
        {"evidence_refs": [{"kind": "build", "id": UUID.upper()}]},
        {"evidence_refs": [{"kind": "build", "id": UUID, "note": "x"}]},
        {"confidence": 101},
        {"confidence": -1},
        {
            "confidence_basis": {
                "method": "",
                "sample_size": 1,
                "effect_size": 0,
                "stability": 0,
            }
        },
        {
            "confidence_basis": {
                "method": "m",
                "sample_size": 0,
                "effect_size": 0,
                "stability": 0,
            }
        },
        {
            "confidence_basis": {
                "method": "m",
                "sample_size": 1,
                "effect_size": 0,
                "stability": 2,
            }
        },
        {"cause": "ccache enabled"},
    ],
)
def test_a_finding_the_database_would_refuse_is_refused_here(
    overrides: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        Finding.model_validate(_finding(**overrides))


def test_custom_and_known_types_are_accepted() -> None:
    for kind in ("change_point", "workflow_outcome", "custom:stage_timing"):
        assert Finding.model_validate(_finding(finding_type=kind)).finding_type == kind


def _field_names(schema: object) -> set[str]:
    names: set[str] = set()
    if isinstance(schema, dict):
        for key, value in schema.items():
            if key == "properties" and isinstance(value, dict):
                names |= set(value)
            names |= _field_names(value)
    elif isinstance(schema, list):
        for item in schema:
            names |= _field_names(item)
    return names


def test_there_is_no_cause_field_anywhere_in_the_contract() -> None:
    # Attribution is a ranked candidate list, never a verdict (decision A1). A `cause` field
    # anywhere a finding or a report is shaped would be the place a verdict could creep in.
    for model in (Finding, Corpus, CandidateEvent, AnalysisReport, AnalyzerOutcome):
        assert "cause" not in _field_names(model.model_json_schema())


def test_a_window_runs_forward_and_speaks_from_on_the_wire() -> None:
    window = DayWindow.model_validate({"from": "2026-05-08", "to": "2026-08-05"})

    assert window.model_dump(mode="json", by_alias=True) == {
        "from": "2026-05-08",
        "to": "2026-08-05",
    }
    with pytest.raises(ValidationError):
        DayWindow.model_validate({"from": "2026-08-05", "to": "2026-05-08"})


def _corpus(**fields: object) -> Corpus:
    return Corpus.model_validate(
        {
            "repo_ref": "acme/helios-firmware",
            "window": {"from": "2026-05-08", "to": "2026-08-05"},
        }
        | fields
    )


def test_absent_is_not_empty() -> None:
    assert _corpus().available() == frozenset()
    assert _corpus(builds=[], events=[]).available() == {
        CorpusRequirement(source=CorpusSource.BUILDS, grain=Grain.BUILD),
        CorpusRequirement(source=CorpusSource.EVENTS, grain=Grain.EVENT),
    }


def test_records_outside_the_window_are_refused() -> None:
    build = {"build_id": UUID, "day": "2026-08-06", "duration_seconds": 252}
    event = {
        "kind": "merge",
        "day": "2026-05-07",
        "label": "x",
        "ref": {"kind": "merge", "id": "abc1234"},
    }
    with pytest.raises(ValidationError):
        _corpus(builds=[build])
    with pytest.raises(ValidationError):
        _corpus(events=[event])


@pytest.mark.parametrize(
    "build",
    [
        {"build_id": "not-a-uuid", "day": "2026-06-01", "duration_seconds": 252},
        {"build_id": UUID, "day": "2026-06-01", "duration_seconds": 0},
        {"build_id": UUID, "day": "2026-06-01", "duration_seconds": 252, "pool": "a"},
    ],
)
def test_a_malformed_build_is_refused(build: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BuildSample.model_validate(build)


def test_an_event_cites_evidence_the_database_can_resolve() -> None:
    with pytest.raises(ValidationError):
        CandidateEvent.model_validate(
            {
                "kind": "merge",
                "day": "2026-06-22",
                "label": "x",
                "ref": {"kind": "pr", "id": "1"},
            }
        )
    with pytest.raises(ValidationError):
        CandidateEvent.model_validate(
            {
                "kind": "rumour",
                "day": "2026-06-22",
                "label": "x",
                "ref": {"kind": "merge", "id": "abc1234"},
            }
        )


def test_canonical_json_is_sorted_compact_and_utf8() -> None:
    assert canonical_json({"b": [1, 2], "a": "naïve"}) == '{"a":"naïve","b":[1,2]}'


def test_findings_json_orders_by_analyzer_then_subject() -> None:
    later = finding("zeta", "a")
    earlier = finding("alpha", "z")
    middle = finding("alpha", "b")

    text = findings_json([later, earlier, middle])

    assert [(f["analyzer"], f["subject_key"]) for f in json.loads(text)] == [
        ("alpha", "b"),
        ("alpha", "z"),
        ("zeta", "a"),
    ]
    assert text == findings_json([middle, later, earlier])


def test_merge_refs_take_a_sha_and_everything_else_a_uuid() -> None:
    assert EvidenceRef(kind="merge", id="ccace01").id == "ccace01"
    assert EvidenceRef(kind="runner_pool", id=UUID).kind == "runner_pool"


# ---------------------------------------------------------------------------
# BV.1's sources (#510) — one per bounded reader in ouroboros-rest
# ---------------------------------------------------------------------------

#: One valid record per new source, inside the fixture window.
_SOURCES: dict[str, object] = {
    "log_tails": [
        {
            "build_id": UUID,
            "day": "2026-06-01",
            "label": "zephyr build",
            "status": "failed",
            "line_count": 3184,
            "lines": ["FAIL: test_fixture_timeout", "west: exit 1"],
        }
    ],
    "tests": [
        {
            "test_run_id": UUID,
            "build_id": None,
            "day": "2026-06-01",
            "suite": "ota",
            "platform": "native_sim",
            "case_key": "ota.rollback",
            "status": "failed",
            "failure": "timeout after 30 s",
        }
    ],
    "flakes": [{"case_key": "ota.rollback", "score": 0.31, "state": "watching"}],
    "loops": [
        {
            "run_id": UUID,
            "day": "2026-06-01",
            "status": "merged",
            "stages": [{"key": "build", "attempts": 2, "seconds": 412.5}],
            "events": 120,
            "event_bytes": 48211,
        }
    ],
    "cache": [{"build_id": UUID, "day": "2026-06-01", "hits": 380, "misses": 140}],
    "waivers": [
        {
            "waiver_id": UUID,
            "run_id": UUID,
            "day": "2026-06-01",
            "case_keys": ["hil.thermal_soak"],
            "reason": "rig thermal chamber offline",
        }
    ],
    "series": {
        "build_duration": [
            {
                "day": "2026-06-01",
                "dimension": "zephyr build",
                "value": 252000,
                "samples": [251000, 252000, 253000],
            }
        ]
    },
    "rig_telemetry": [
        {"runner_id": UUID, "day": "2026-06-01", "metric": "chamber_c", "value": 41.5}
    ],
}


def test_every_source_has_a_grain_and_a_field() -> None:
    assert set(SOURCE_GRAINS) == set(CorpusSource)
    for source in CorpusSource:
        assert source.value in Corpus.model_fields


def test_each_new_source_is_absent_by_default_and_available_when_carried() -> None:
    for name, records in _SOURCES.items():
        source = CorpusSource(name)
        requirement = CorpusRequirement(source=source, grain=SOURCE_GRAINS[source])

        assert getattr(_corpus(), name) is None
        assert requirement not in _corpus().available()
        assert requirement in _corpus(**{name: records}).available()
        # Present and empty is still present — an empty plane, not a missing one.
        empty = {} if isinstance(records, dict) else []
        assert requirement in _corpus(**{name: empty}).available()


@pytest.mark.parametrize("name", sorted(set(_SOURCES) - {"flakes"}))
def test_a_dated_record_outside_the_window_is_refused(name: str) -> None:
    records = json.loads(json.dumps(_SOURCES[name]))
    first = records["build_duration"][0] if name == "series" else records[0]
    first["day"] = "2026-08-06"

    with pytest.raises(ValidationError, match="outside the window"):
        _corpus(**{name: records})


@pytest.mark.parametrize("name", sorted(_SOURCES))
def test_an_unknown_key_in_a_new_source_is_refused(name: str) -> None:
    records = json.loads(json.dumps(_SOURCES[name]))
    first = records["build_duration"][0] if name == "series" else records[0]
    first["body"] = "a transcript body the corpus never carries"

    with pytest.raises(ValidationError):
        _corpus(**{name: records})


def test_a_series_is_keyed_by_a_metric_id() -> None:
    with pytest.raises(ValidationError):
        _corpus(series={"Build Duration": []})


def test_the_full_corpus_round_trips_on_the_wire() -> None:
    corpus = _corpus(**_SOURCES)

    wire = corpus.model_dump(mode="json", by_alias=True)
    assert Corpus.model_validate(wire) == corpus
