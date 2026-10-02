"""The analysis contract — findings as BU.2 stores them, the corpus as BV.1 must deliver it."""

import json

import pytest
from pydantic import ValidationError

from analysis_fakes import finding
from ouroboros_engine.analysis.contract import (
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
