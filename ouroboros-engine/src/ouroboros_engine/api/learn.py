"""``POST /v0/learn`` — candidate facts from a source bundle.

BF.3 (`#412 <https://github.com/NobuData/ouroboros/issues/412>`_), decision **K5**. The
contract is :mod:`ouroboros_engine.learning.contract` and is committed now; *which* extractor
answers is :mod:`ouroboros_engine.learning.extractor`, installed on the application by
:func:`ouroboros_engine.main.create_app` — today the one that extracts nothing and says so,
and BH.1's LLM extractor (`#423 <https://github.com/NobuData/ouroboros/issues/423>`_) later.

**Every answer is checked against the request it answered.** A candidate naming a source that
was not sent, or citing a ref its source did not carry, is a ``500`` and a log line rather than
provenance that reaches a row: invented provenance is the one thing the fact card cannot
survive (:func:`~ouroboros_engine.learning.contract.honours_sources`).

The log line carries counts, never the sources' text — review threads and correction notes are
the customer's own words.
"""

import logging

from fastapi import APIRouter, Request

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.learning.contract import Learned, LearnRequest, honours_sources
from ouroboros_engine.learning.extractor import Extractor

#: Where the operation lives under the versioned prefix.
LEARN_ROUTE = "/learn"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


class ExtractorContractError(RuntimeError):
    """An extractor answered outside the bundle it was asked about — a bug, never a 4xx."""


@router.post(
    LEARN_ROUTE,
    summary="Learn candidate facts from a source bundle",
    response_model=Learned,
)
async def learn(request: Request, payload: LearnRequest) -> Learned:
    """Extract candidates with whichever extractor is installed.

    Args:
        request: The incoming request, read for the application's own state.
        payload: The validated source bundle.

    Returns:
        The :class:`~ouroboros_engine.learning.contract.Learned` answer.

    Raises:
        ExtractorContractError: If the extractor cited a source or ref the request did not
            carry. It surfaces as the ``500`` every unexpected failure does.
    """
    extractor: Extractor = request.app.state.extractor
    learned = extractor.extract(payload)
    problems = honours_sources(learned, payload)

    if problems:
        raise ExtractorContractError("; ".join(problems))

    _logger.info(
        "learned",
        extra={
            "extractor": learned.extractor,
            "sources": len(payload.sources),
            "candidates": len(learned.candidates),
        },
    )
    return learned
