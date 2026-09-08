"""The seam, and the check that holds every answer to the request it answered.

What is left for this file once L.2's rule engine has its own suite
(:mod:`tests.test_estimation_heuristic`) is the part of the seam that is not any one
estimator's: that the protocol recognises an implementation, and that
:func:`~ouroboros_engine.estimation.estimator.honours_context` refuses an answer naming a
vocabulary the caller did not offer.

That check is tested here rather than through the route, because what it guards is not the
caller's request but *this service's own answer* — and the case that matters most is an
estimator nobody has written yet returning something the offer does not contain. So the
implementations below are deliberately bad ones: no estimator in this repository behaves
this way, and the guard exists for the one that eventually does.
"""

import logging

import pytest

from ouroboros_engine.estimation.contract import (
    Estimate,
    EstimateRequest,
    EstimationContext,
    IssueContext,
)
from ouroboros_engine.estimation.estimator import (
    Estimator,
    EstimatorContractError,
    honours_context,
)
from ouroboros_engine.estimation.heuristic import HeuristicEstimator


class Wanderer:
    """An estimator that answers with whatever it was told to, offer or no offer.

    Attributes:
        name: What it would write into a trace.
    """

    name = "wanderer-for-test"

    def __init__(self, estimate: Estimate) -> None:
        """Hold the answer to give.

        Args:
            estimate: What every call returns.
        """
        self._estimate = estimate

    def estimate(self, request: EstimateRequest) -> Estimate:  # noqa: ARG002
        """Answer, ignoring the request entirely.

        Args:
            request: The validated request, unread — which is the whole point.

        Returns:
            The estimate this instance was built with.
        """
        return self._estimate


# ---------------------------------------------------------------------------
# The seam
# ---------------------------------------------------------------------------


def test_the_installed_estimator_is_an_estimator() -> None:
    # The check O.2's replacement has to keep passing: the LLM estimator is a new class on
    # this protocol rather than an edit to the route.
    assert isinstance(HeuristicEstimator(), Estimator)


def test_something_that_is_not_an_estimator_is_not_mistaken_for_one() -> None:
    assert not isinstance(object(), Estimator)


def test_a_test_double_is_an_estimator_too(mockup_estimate: Estimate) -> None:
    # Which is what lets a suite install one on `app.state` without patching a module.
    assert isinstance(Wanderer(mockup_estimate), Estimator)


# ---------------------------------------------------------------------------
# The answer is checked against the request — decisions K5 and K6
# ---------------------------------------------------------------------------


def test_an_answer_out_of_the_offer_is_accepted(
    estimation_context: EstimationContext, mockup_estimate: Estimate
) -> None:
    # The mockup's own estimate against the mockup's own vocabularies: `standard-fix` is one
    # of the four tags and `claude-fable-5` is one of the two models.
    honours_context(mockup_estimate, estimation_context)


def test_a_workflow_tag_the_caller_does_not_have_is_refused(
    estimation_context: EstimationContext, mockup_estimate: Estimate
) -> None:
    invented = mockup_estimate.model_copy(
        update={"suggested_workflow": "invented-loop"}
    )

    with pytest.raises(EstimatorContractError, match="invented-loop"):
        honours_context(invented, estimation_context)


def test_a_model_the_caller_does_not_have_is_refused(
    estimation_context: EstimationContext, mockup_estimate: Estimate
) -> None:
    invented = mockup_estimate.model_copy(update={"routed_model": "invented-model"})

    with pytest.raises(EstimatorContractError, match="invented-model"):
        honours_context(invented, estimation_context)


def test_answering_with_a_key_of_the_model_map_is_refused(
    estimation_context: EstimationContext, mockup_estimate: Estimate
) -> None:
    # The map's *values* are the models. An estimator reading it the wrong way round would
    # route to a class of work rather than to a model, and every one of those keys is a
    # plausible-looking string.
    key = next(iter(estimation_context.model_defaults))
    inverted = mockup_estimate.model_copy(update={"routed_model": key})

    with pytest.raises(EstimatorContractError, match=key):
        honours_context(inverted, estimation_context)


def test_the_refusal_tells_an_operator_what_was_offered(
    estimation_context: EstimationContext,
    mockup_estimate: Estimate,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The caller is told nothing but `500`, so the diagnosis has to be in the log — the
    # offending value, the offer it was measured against, and which estimator produced it.
    invented = mockup_estimate.model_copy(
        update={"suggested_workflow": "invented-loop"}
    )

    with (
        caplog.at_level(logging.ERROR, logger="ouroboros_engine.estimation.estimator"),
        pytest.raises(EstimatorContractError),
    ):
        honours_context(invented, estimation_context)

    record = caplog.records[-1]
    assert record.suggested_workflow == "invented-loop"
    assert record.workflow_tags == list(estimation_context.workflow_tags)
    assert record.estimator == mockup_estimate.trace.estimator


def test_an_estimator_that_ignores_the_request_is_caught_by_the_check(
    estimation_context: EstimationContext, mockup_estimate: Estimate
) -> None:
    # End to end over the seam: a badly-written estimator produces a well-formed estimate,
    # and the guard is what stops it reaching a row.
    other = EstimationContext(
        workflow_tags=["triage"], model_defaults={"default": "ollama/qwen3-coder"}
    )
    estimator = Wanderer(mockup_estimate)

    answer = estimator.estimate(
        EstimateRequest(
            issue=IssueContext(
                number=1, title="anything", body=None, labels=[], repo="a/b"
            ),
            context=other,
        )
    )

    honours_context(answer, estimation_context)
    with pytest.raises(EstimatorContractError):
        honours_context(answer, other)
