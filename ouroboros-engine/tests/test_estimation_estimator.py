"""The seam, and the estimator that is installed until L.2 fills it.

Two things are worth testing about a placeholder, and neither is its arithmetic. The first
is that it is **honest**: an answer that looked like an estimate would be persisted as one,
rendered as one, and re-estimated only when somebody noticed — so every field a reader
checks has to say that nothing estimated this. The second is that it **answers out of the
caller's vocabularies** rather than out of a constant in this service, which is decisions
**K5** and **K6** and is the part L.2 inherits unchanged.

:func:`~ouroboros_engine.estimation.estimator.honours_context` is tested here rather than
through the route, because what it guards is not the caller's request but *this service's
own answer* — the case that matters most is an estimator nobody has written yet returning
something the offer does not contain.
"""

import pytest

from ouroboros_engine.estimation.contract import (
    Estimate,
    EstimateRequest,
    EstimationContext,
)
from ouroboros_engine.estimation.estimator import (
    CONTRACT_STUB,
    NO_ESTIMATOR_SIGNAL,
    ContractStub,
    Estimator,
    EstimatorContractError,
    honours_context,
)


@pytest.fixture
def stub() -> ContractStub:
    """The estimator ``create_app`` installs.

    Returns:
        A :class:`ouroboros_engine.estimation.estimator.ContractStub`.
    """
    return ContractStub()


# ---------------------------------------------------------------------------
# The seam
# ---------------------------------------------------------------------------


def test_the_stub_is_an_estimator(stub: ContractStub) -> None:
    # The check `create_app`'s replacement has to keep passing: L.2 and O.2 are new
    # classes on this protocol rather than edits to the route.
    assert isinstance(stub, Estimator)


def test_something_that_is_not_an_estimator_is_not_mistaken_for_one() -> None:
    assert not isinstance(object(), Estimator)


# ---------------------------------------------------------------------------
# The stub answers, and says it is a stub
# ---------------------------------------------------------------------------


def test_it_answers_the_contract(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # Constructing an `Estimate` is validating one, so this is the whole contract: an
    # answer that broke a bound would not reach the assertion.
    assert isinstance(stub.estimate(estimate_request), Estimate)


def test_it_names_itself_rather_than_the_estimator_it_stands_in_for(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # Decision K10. A stub borrowing `heuristic-v0` is exactly the masquerade provenance
    # exists to prevent, and it is the string L.3 and an operator read.
    trace = stub.estimate(estimate_request).trace

    assert trace.estimator == CONTRACT_STUB == stub.name
    assert trace.estimator != "heuristic-v0"


def test_it_claims_no_confidence_at_all(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # Below any floor L.3 could set, so an issue "sized" by this estimator becomes
    # needs_human rather than sized.
    assert stub.estimate(estimate_request).confidence == 0


def test_its_breakdown_is_nothing_anybody_could_plan_with(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    breakdown = stub.estimate(estimate_request).breakdown

    assert breakdown.files == []
    assert (breakdown.est_tokens, breakdown.cycle_min, breakdown.cycle_max) == (0, 0, 0)
    assert breakdown.est_minutes == 0


def test_it_says_in_words_that_nothing_estimated_this(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # The risk note is the only field that can explain the other seven, and the trace's
    # one signal is a rule name in the shape L.2's will have.
    estimate = stub.estimate(estimate_request)

    assert "No estimator is installed" in estimate.risk_note
    assert estimate.trace.signals == [NO_ESTIMATOR_SIGNAL]
    assert estimate.trace.tokens_used == 0


def test_it_reports_risk_conservatively_rather_than_reassuringly(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # There is no `unknown` in K.2's vocabulary, and unsized work is not low-risk work.
    assert stub.estimate(estimate_request).risk == "high"


# ---------------------------------------------------------------------------
# It answers out of the caller's vocabularies
# ---------------------------------------------------------------------------


def test_it_suggests_a_workflow_the_caller_offered(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    estimate = stub.estimate(estimate_request)

    assert estimate.suggested_workflow in estimate_request.context.workflow_tags


def test_it_routes_to_a_model_the_caller_offered(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    estimate = stub.estimate(estimate_request)

    assert estimate.routed_model in estimate_request.context.model_defaults.values()


def test_the_vocabularies_come_from_the_request_and_not_from_this_service(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # The same estimator, a different installation: nothing in this service holds a list
    # of workflow tags or of models, so the answer has to move with the offer.
    elsewhere = estimate_request.model_copy(
        update={
            "context": EstimationContext(
                workflow_tags=["nightly-sweep"],
                model_defaults={"default": "some-other-model"},
            )
        }
    )

    estimate = stub.estimate(elsewhere)

    assert estimate.suggested_workflow == "nightly-sweep"
    assert estimate.routed_model == "some-other-model"


def test_it_takes_the_first_default_the_caller_wrote(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # Insertion order survives JSON parsing, so "the first one" is the caller's first one
    # rather than whichever the dictionary happened to yield.
    assert stub.estimate(estimate_request).routed_model == "claude-fable-5"


def test_the_same_issue_is_answered_the_same_way_twice(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # Determinism is L.2's acceptance criterion and the placeholder is held to it too:
    # a re-estimation that changes an answer for no reason is a trace nobody can read.
    assert stub.estimate(estimate_request) == stub.estimate(estimate_request)


# ---------------------------------------------------------------------------
# An answer is checked against the request that asked for it
# ---------------------------------------------------------------------------


def test_an_answer_out_of_the_offer_is_accepted(
    stub: ContractStub, estimate_request: EstimateRequest
) -> None:
    # The guard the route runs on every answer, against the estimator it ships with.
    honours_context(stub.estimate(estimate_request), estimate_request.context)


def test_a_workflow_the_caller_never_offered_is_refused(
    mockup_estimate: Estimate, estimation_context: EstimationContext
) -> None:
    invented = mockup_estimate.model_copy(update={"suggested_workflow": "made-up-loop"})

    with pytest.raises(EstimatorContractError, match="made-up-loop"):
        honours_context(invented, estimation_context)


def test_a_model_the_caller_never_offered_is_refused(
    mockup_estimate: Estimate, estimation_context: EstimationContext
) -> None:
    invented = mockup_estimate.model_copy(update={"routed_model": "gpt-from-nowhere"})

    with pytest.raises(EstimatorContractError, match="gpt-from-nowhere"):
        honours_context(invented, estimation_context)


def test_the_model_has_to_be_one_of_the_values_and_not_one_of_the_keys(
    mockup_estimate: Estimate,
) -> None:
    # `model_defaults` is keyed by the caller's name for a class of work; the models are
    # its values. An estimator reading the map the wrong way round would otherwise answer
    # with a key and be believed.
    context = EstimationContext(
        workflow_tags=["standard-fix"], model_defaults={"claude-fable-5": "docs-model"}
    )

    with pytest.raises(EstimatorContractError, match="claude-fable-5"):
        honours_context(mockup_estimate, context)


def test_the_workflow_is_checked_before_the_model(
    mockup_estimate: Estimate,
) -> None:
    # Both are wrong; the message names the first, so a log line points at one thing to
    # fix rather than at two.
    context = EstimationContext(
        workflow_tags=["nightly-sweep"], model_defaults={"default": "some-other-model"}
    )

    with pytest.raises(EstimatorContractError, match="suggested_workflow"):
        honours_context(mockup_estimate, context)
