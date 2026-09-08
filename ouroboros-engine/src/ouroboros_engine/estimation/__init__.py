"""Sizing an issue — the contract, the rules behind it, and the seam between them.

Epic L (`#95 <https://github.com/NobuData/ouroboros/issues/95>`_). Four modules, and the
split between them is the whole design:

* :mod:`~ouroboros_engine.estimation.contract` is what ``ouroboros-rest`` is written against
  and is not allowed to change.
* :mod:`~ouroboros_engine.estimation.estimator` is the seam — a one-method
  :class:`~ouroboros_engine.estimation.estimator.Estimator` protocol, and the check that
  holds every answer to the caller's own vocabularies.
* :mod:`~ouroboros_engine.estimation.signals` is the rules L.2
  (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_) reads an issue with — one
  table and one threshold each, so the heuristic is something a reviewer can argue with a
  line at a time.
* :mod:`~ouroboros_engine.estimation.heuristic` is
  :class:`~ouroboros_engine.estimation.heuristic.HeuristicEstimator`, the arithmetic that
  combines those signals into an estimate. It is what ``create_app`` installs, and it stays
  installed as the fallback path when the LLM estimator O.2
  (`#123 <https://github.com/NobuData/ouroboros/issues/123>`_) lands beside it.

The response mirrors K.2's ``issue_estimates`` row (`#100
<https://github.com/NobuData/ouroboros/issues/100>`_) field for field so that L.3
(`#107 <https://github.com/NobuData/ouroboros/issues/107>`_) persists an answer instead of
translating one; the contract module's docstring holds that mapping, and a test holds it as
data.

The route that calls into here is :mod:`ouroboros_engine.api.estimate`.
"""

from ouroboros_engine.estimation.contract import (
    EFFORTS,
    RISKS,
    Breakdown,
    Effort,
    Estimate,
    EstimateRequest,
    EstimationContext,
    IssueContext,
    Risk,
    Trace,
)
from ouroboros_engine.estimation.estimator import (
    Estimator,
    EstimatorContractError,
    honours_context,
)
from ouroboros_engine.estimation.heuristic import (
    HEURISTIC,
    NEEDS_HUMAN_CONFIDENCE_FLOOR,
    HeuristicEstimator,
    needs_human,
)

__all__ = [
    "EFFORTS",
    "HEURISTIC",
    "NEEDS_HUMAN_CONFIDENCE_FLOOR",
    "RISKS",
    "Breakdown",
    "Effort",
    "Estimate",
    "EstimateRequest",
    "EstimationContext",
    "Estimator",
    "EstimatorContractError",
    "HeuristicEstimator",
    "IssueContext",
    "Risk",
    "Trace",
    "honours_context",
    "needs_human",
]
