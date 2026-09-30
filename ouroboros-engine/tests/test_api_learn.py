"""``POST /v0/learn`` — the route, its installed extractor, and its provenance guard.

BF.3 (#412). The shapes are :mod:`tests.test_learning_contract`'s. What is left for the route:
that the installed extractor is ``unavailable-v0`` and answers no candidates with its note (no
extraction pretended without a model), that the answer is *the installed extractor's*, that a
bundle which does not validate is a ``422``, and that an extractor citing provenance its
sources did not carry is a ``500`` rather than a candidate that crosses the gateway.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient

from ouroboros_engine.api.learn import LEARN_ROUTE
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.core.errors import INTERNAL_ERROR_MESSAGE, VALIDATION_FAILED
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER
from ouroboros_engine.learning.contract import Learned, LearnRequest
from ouroboros_engine.learning.extractor import (
    UNAVAILABLE_EXTRACTOR,
    UNAVAILABLE_NOTE,
    Extractor,
    UnavailableExtractor,
)
from ouroboros_engine.settings import Settings

LEARN_PATH = f"{V0_PREFIX}{LEARN_ROUTE}"

_PR = "a7150000-0000-0000-0000-000000000498"

_BODY = {
    "sources": [
        {
            "kind": "correction_note",
            "label": "correction note (run #1847)",
            "text": "Team prefers `k_msgq` over `k_fifo` in ISR paths.",
            "refs": [{"kind": "pull_request", "id": _PR}],
        }
    ],
    "context": {"repo": "acme-robotics/helios-firmware"},
}


class FixedExtractor:
    """An extractor answering whatever it was built with."""

    def __init__(self, answer: Learned) -> None:
        """Hold the answer.

        Args:
            answer: What every call returns.
        """
        self.answer = answer

    def extract(self, request: LearnRequest) -> Learned:
        """Answer the fixed candidates.

        Args:
            request: Ignored.

        Returns:
            The fixed answer.
        """
        del request
        return self.answer


@contextmanager
def _serving(
    settings: Settings, internal_key: str, extractor: object
) -> Iterator[TestClient]:
    """An authenticated client for an application with a given extractor installed.

    Args:
        settings: Configuration to build the application from.
        internal_key: The shared secret to send.
        extractor: What to install on ``app.state.extractor``.

    Yields:
        A client whose server errors are answered rather than re-raised.
    """
    from ouroboros_engine.main import create_app

    app = create_app(settings)
    app.state.extractor = extractor

    with TestClient(
        app, headers={INTERNAL_KEY_HEADER: internal_key}, raise_server_exceptions=False
    ) as test_client:
        yield test_client


def _candidate(refs: list[dict]) -> dict:
    """A candidate from source 0 citing the given refs.

    Args:
        refs: The provenance refs.

    Returns:
        The candidate.
    """
    return {
        "text": "Team prefers `k_msgq` over `k_fifo` in ISR paths",
        "category": "convention",
        "confidence": 0.9,
        "source_index": 0,
        "provenance": {"line": "from PR #514 review cycle", "refs": refs},
    }


def test_the_unavailable_extractor_is_installed_and_says_why(
    client: TestClient,
) -> None:
    response = client.post(LEARN_PATH, json=_BODY)

    assert response.status_code == 200
    assert response.json() == {
        "candidates": [],
        "extractor": UNAVAILABLE_EXTRACTOR,
        "notes": [UNAVAILABLE_NOTE],
    }


def test_the_installed_extractor_honours_the_seam() -> None:
    assert isinstance(UnavailableExtractor(), Extractor)


def test_the_answer_is_the_installed_extractor_s(
    settings: Settings, internal_key: str
) -> None:
    answer = Learned.model_validate(
        {
            "candidates": [_candidate([{"kind": "pull_request", "id": _PR}])],
            "extractor": "llm-v1",
            "notes": [],
        }
    )

    with _serving(settings, internal_key, FixedExtractor(answer)) as client:
        body = client.post(LEARN_PATH, json=_BODY).json()

    assert body == answer.model_dump(mode="json")


def test_invented_provenance_is_a_server_error_not_a_candidate(
    settings: Settings, internal_key: str
) -> None:
    answer = Learned.model_validate(
        {
            "candidates": [
                _candidate(
                    [{"kind": "run", "id": "a7120000-0000-0000-0000-000000001847"}]
                )
            ],
            "extractor": "llm-v1",
            "notes": [],
        }
    )

    with _serving(settings, internal_key, FixedExtractor(answer)) as client:
        response = client.post(LEARN_PATH, json=_BODY)

    assert response.status_code == 500
    assert response.json()["message"] == INTERNAL_ERROR_MESSAGE


def test_a_bundle_that_does_not_validate_is_refused_in_the_envelope(
    client: TestClient,
) -> None:
    response = client.post(LEARN_PATH, json={**_BODY, "sources": []})

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED
