"""``POST /v0/learn``'s shapes — BF.3 (#412), committed before their implementation.

The contract has to hold for BH.1's LLM extractor (#423), which does not exist yet, so these
tests are about what *any* extractor may and may not answer: closed shapes, bounded counts, a
confidence between 0 and 1, no status field anywhere, and provenance drawn only from the
sources the request carried (:func:`honours_sources`).
"""

import pytest
from pydantic import ValidationError

from ouroboros_engine.learning.contract import (
    MAX_CANDIDATE_LENGTH,
    MAX_SOURCES,
    LearnCandidate,
    Learned,
    LearnRequest,
    honours_sources,
)

_PR = "a7150000-0000-0000-0000-000000000498"


def _request(**overrides: object) -> dict:
    """A valid source bundle — the review cycle behind the mockup's `rig claim` fact.

    Args:
        **overrides: Top-level keys to replace.

    Returns:
        The request body.
    """
    body = {
        "sources": [
            {
                "kind": "pr_review_cycle",
                "label": "PR #498 review cycle",
                "text": "Always `rig claim` before any HIL test.",
                "refs": [{"kind": "pull_request", "id": _PR}],
            }
        ],
        "context": {"repo": "acme-robotics/helios-firmware", "existing_facts": []},
    }
    body.update(overrides)
    return body


def _candidate(**overrides: object) -> dict:
    """A valid candidate citing the request's one source.

    Args:
        **overrides: Keys to replace.

    Returns:
        The candidate body.
    """
    body = {
        "text": "Tests under `tests/hil/` require rig reservation via `rig claim`",
        "category": "environment",
        "confidence": 0.82,
        "source_index": 0,
        "provenance": {
            "line": "from PR #498 review cycle",
            "refs": [{"kind": "pull_request", "id": _PR}],
        },
    }
    body.update(overrides)
    return body


def test_a_source_bundle_validates() -> None:
    request = LearnRequest.model_validate(_request())

    assert request.sources[0].kind == "pr_review_cycle"


def test_the_context_defaults_to_the_workspace_and_no_existing_facts() -> None:
    request = LearnRequest.model_validate(_request(context={}))

    assert request.context.repo is None
    assert request.context.existing_facts == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"sources": []},
        {"sources": [_request()["sources"][0]] * (MAX_SOURCES + 1)},
        {"note": "a property the operation does not declare"},
    ],
)
def test_a_bundle_outside_the_bounds_is_refused(overrides: dict) -> None:
    with pytest.raises(ValidationError):
        LearnRequest.model_validate(_request(**overrides))


def test_a_source_kind_outside_the_vocabulary_is_refused() -> None:
    source = {**_request()["sources"][0], "kind": "slack_thread"}

    with pytest.raises(ValidationError):
        LearnRequest.model_validate(_request(sources=[source]))


def test_an_import_ref_is_not_an_extractor_s_to_cite() -> None:
    source = {
        **_request()["sources"][0],
        "refs": [{"kind": "import", "id": "CLAUDE.md"}],
    }

    with pytest.raises(ValidationError):
        LearnRequest.model_validate(_request(sources=[source]))


def test_a_candidate_carries_no_status() -> None:
    # K3, as a property of the contract: a candidate lands `proposed` because there is no
    # field an extractor could use to say otherwise, and a closed model refuses one added.
    assert "status" not in LearnCandidate.model_fields

    with pytest.raises(ValidationError):
        LearnCandidate.model_validate(_candidate(status="confirmed"))


@pytest.mark.parametrize("confidence", [-0.01, 1.01])
def test_confidence_is_between_zero_and_one(confidence: float) -> None:
    with pytest.raises(ValidationError):
        LearnCandidate.model_validate(_candidate(confidence=confidence))


def test_a_candidate_is_no_longer_than_the_registry_accepts() -> None:
    with pytest.raises(ValidationError):
        LearnCandidate.model_validate(_candidate(text="x" * (MAX_CANDIDATE_LENGTH + 1)))


def test_an_answer_must_say_what_produced_it() -> None:
    with pytest.raises(ValidationError):
        Learned.model_validate({"candidates": [], "extractor": "", "notes": []})


def test_an_answer_citing_its_own_source_honours_the_request() -> None:
    learned = Learned.model_validate(
        {"candidates": [_candidate()], "extractor": "llm-v1", "notes": []}
    )

    assert honours_sources(learned, LearnRequest.model_validate(_request())) == []


def test_a_candidate_naming_a_source_that_was_not_sent_is_named() -> None:
    learned = Learned.model_validate(
        {"candidates": [_candidate(source_index=3)], "extractor": "llm-v1", "notes": []}
    )

    assert honours_sources(learned, LearnRequest.model_validate(_request())) == [
        "candidate 0 names source 3, which the request did not send"
    ]


def test_a_candidate_citing_a_ref_its_source_did_not_carry_is_named() -> None:
    invented = "a7120000-0000-0000-0000-000000001847"
    candidate = _candidate(
        provenance={
            "line": "from PR #498 review cycle",
            "refs": [{"kind": "run", "id": invented}],
        }
    )
    learned = Learned.model_validate(
        {"candidates": [candidate], "extractor": "llm-v1", "notes": []}
    )

    assert honours_sources(learned, LearnRequest.model_validate(_request())) == [
        f"candidate 0 cites run {invented}, which its source did not carry"
    ]
