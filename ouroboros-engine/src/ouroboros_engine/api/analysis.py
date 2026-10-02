"""``/v0/analysis`` — the Build Analyzer's dispatch route (BV.1, #510).

BV.2 (`#511 <https://github.com/NobuData/ouroboros/issues/511>`_) built the analyzer SPI and
its harness and deliberately served none of it. This is the HTTP half the run orchestrator in
``ouroboros-rest`` calls:

* ``GET /v0/analysis/analyzers`` — the installed analyzer set, in ``analysis_runs.analyzer_set``'s
  shape (``V080``). ``ouroboros-rest`` records it on the run *before* assembling a corpus, so a
  run's provenance is known from its first row.
* ``POST /v0/analysis/runs`` — a corpus and its budget in, the run streamed back as
  newline-delimited JSON: an :class:`~ouroboros_engine.analysis.harness.AnalyzerStarted` when an
  analyzer's sandbox starts, an :class:`~ouroboros_engine.analysis.harness.AnalyzerFinished`
  with its outcome and findings the moment it ends, and one
  :class:`~ouroboros_engine.analysis.harness.AnalysisFinished` last. Streaming is what makes the
  page's per-analyzer progress real rather than a spinner, and what lets a run that hits its
  compute ceiling keep the findings of the analyzers that finished.

**Nothing leaves the tenant.** The corpus arrives in the request body from the deployment's own
``ouroboros-rest``, is analyzed in sandboxes that cannot open a socket
(:mod:`ouroboros_engine.analysis.sandbox`), and the findings go back on the same connection.
This service writes nothing anywhere.

A stream that ends **without** a report line was cut short — the engine crashed or the harness
raised — and the caller treats the run as failed. That is why the report is always last: its
absence is the signal.
"""

import logging
from collections.abc import Iterator
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.analysis.contract import ANALYZER_ID_PATTERN, Corpus
from ouroboros_engine.analysis.harness import iter_analysis
from ouroboros_engine.analysis.registry import AnalyzerRegistry
from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG

#: Where the installed analyzer set is read.
ANALYZERS_ROUTE = "/analysis/analyzers"

#: Where a run is dispatched.
RUNS_ROUTE = "/analysis/runs"

#: The media type a run streams in: one JSON document per line.
NDJSON_MEDIA_TYPE = "application/x-ndjson"

#: What *Analyzed by* renders for the MVP's analyzers (decision A3). Every built-in is
#: ``deterministic``; BX.1's LLM synthesis pass is what changes this label, and the analyzer
#: kinds beside it say so either way.
ANALYZER_SET_LABEL = "deterministic analyzers v1"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


class AnalyzerSetEntry(BaseModel):
    """One analyzer in the set: its id, version and kind."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[str, Field(pattern=ANALYZER_ID_PATTERN)]
    version: Annotated[int, Field(ge=1)]
    kind: Literal["deterministic", "llm"]


class AnalyzerSet(BaseModel):
    """The installed analyzers — ``analysis_runs.analyzer_set`` exactly (``V080``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    label: Annotated[str, Field(min_length=1)]
    analyzers: list[AnalyzerSetEntry]


class AnalysisRequest(BaseModel):
    """One run's dispatch: which run, its corpus, and the compute it may still spend.

    Attributes:
        run_id: The ``analysis_runs`` row this run is — echoed into the log, nothing else.
        corpus: The assembled, bounded corpus.
        compute_ceiling_seconds: What is left of the run's compute ceiling once assembly
            has spent its share, or ``None`` for no ceiling.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: Annotated[
        str,
        Field(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ),
    ]
    corpus: Corpus
    compute_ceiling_seconds: Annotated[float, Field(gt=0)] | None = None


def _registry(request: Request) -> AnalyzerRegistry:
    """The registry installed on the application (:func:`ouroboros_engine.main.create_app`).

    Args:
        request: The incoming request.

    Returns:
        The registry — read from ``app.state`` so a test installs its own.
    """
    return request.app.state.analyzer_registry


@router.get(
    ANALYZERS_ROUTE,
    summary="The installed analyzer set",
    response_model=AnalyzerSet,
)
async def analyzer_set(request: Request) -> AnalyzerSet:
    """Describe the analyzers a run would execute.

    Args:
        request: The incoming request, read for the installed registry.

    Returns:
        ``{label, analyzers: [{id, version, kind}]}`` in id order.
    """
    return AnalyzerSet.model_validate(
        _registry(request).analyzer_set(ANALYZER_SET_LABEL)
    )


def _lines(registry: AnalyzerRegistry, payload: AnalysisRequest) -> Iterator[str]:
    """The run, one NDJSON line per harness event.

    A plain (synchronous) generator on purpose: Starlette iterates it in a worker thread, so a
    sandbox that takes minutes holds a thread, never the event loop.

    Args:
        registry: The analyzers to run.
        payload: The validated request.

    Yields:
        Each event's JSON and a newline. If the harness raises, the stream ends without a
        report line — the caller's signal that the run failed — and the reason is logged.
    """
    try:
        for event in iter_analysis(
            registry,
            payload.corpus,
            compute_ceiling_seconds=payload.compute_ceiling_seconds,
        ):
            yield event.model_dump_json() + "\n"
    except Exception:
        _logger.exception("analysis run ended early", extra={"run_id": payload.run_id})


@router.post(
    RUNS_ROUTE,
    summary="Run the analyzers over a corpus, streaming progress",
    response_class=StreamingResponse,
)
async def run(request: Request, payload: AnalysisRequest) -> StreamingResponse:
    """Dispatch one analysis run and stream it back.

    Args:
        request: The incoming request, read for the installed registry.
        payload: The validated run — a body that does not validate is the ``422`` envelope
            before anything runs.

    Returns:
        A ``200`` streaming ``application/x-ndjson``: started/outcome events per analyzer in
        id order, then the report.
    """
    _logger.info(
        "analysis run dispatched",
        extra={"run_id": payload.run_id, "repo_ref": payload.corpus.repo_ref},
    )
    return StreamingResponse(
        _lines(_registry(request), payload), media_type=NDJSON_MEDIA_TYPE
    )
