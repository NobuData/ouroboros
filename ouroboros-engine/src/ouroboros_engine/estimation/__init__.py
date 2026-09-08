"""Sizing an issue — the contract, and whatever is currently behind it.

Epic L (`#95 <https://github.com/NobuData/ouroboros/issues/95>`_). Two modules, and the
split between them is the whole design:
:mod:`~ouroboros_engine.estimation.contract` is what ``ouroboros-rest`` is written against
and is not allowed to change, and :mod:`~ouroboros_engine.estimation.estimator` is what
produces an answer and is expected to be replaced twice — by the heuristic L.2
(`#106 <https://github.com/NobuData/ouroboros/issues/106>`_) and then by the LLM estimator
O.2 (`#123 <https://github.com/NobuData/ouroboros/issues/123>`_).

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
    CONTRACT_STUB,
    ContractStub,
    Estimator,
    EstimatorContractError,
    honours_context,
)

__all__ = [
    "CONTRACT_STUB",
    "EFFORTS",
    "RISKS",
    "Breakdown",
    "ContractStub",
    "Effort",
    "Estimate",
    "EstimateRequest",
    "EstimationContext",
    "Estimator",
    "EstimatorContractError",
    "IssueContext",
    "Risk",
    "Trace",
    "honours_context",
]
