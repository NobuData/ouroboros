"""``POST /v0/plan``'s shapes — the bounds, the closures, and the batch's own consistency.

The planner's answers are :mod:`tests.test_planning_planner`'s and the route's behaviour is
:mod:`tests.test_api_plan`'s. What is left for the contract is the part that has to hold for
**every** planner that ever answers it, including AN.1's: that a field cannot quietly change
meaning, that a property nobody declared is refused rather than dropped, and that a batch
whose dependency graph does not resolve never leaves this process.

That last one is why these validators are on the model rather than in the parser. A rule
that lives in an implementation is a rule the next implementation has to remember.
"""

import pytest
from pydantic import ValidationError

from ouroboros_engine.planning.contract import (
    MAX_BODY_LENGTH,
    MAX_NARRATIVE_LENGTH,
    MAX_TITLE_LENGTH,
    Draft,
    Plan,
    PlanningContext,
    PlanRequest,
)


def _draft(key: str, **overrides: object) -> Draft:
    """A valid draft, for a test that cares about one field of it.

    Args:
        key: The local key.
        **overrides: Fields to replace.

    Returns:
        The draft.
    """
    fields: dict[str, object] = {
        "local_key": key,
        "title": "A drafted ticket",
        "body": "",
        "suggested_workflow": "feature-loop",
        "dependencies": [],
    }
    return Draft.model_validate(fields | overrides)


def _plan(*drafts: Draft, notes: list[str] | None = None) -> Plan:
    """A plan carrying the given drafts.

    Args:
        drafts: The batch.
        notes: The notes, or none.

    Returns:
        The plan.
    """
    return Plan(drafts=list(drafts), planner="outline-v0", notes=notes or [])


# ---------------------------------------------------------------------------
# The documented fields, and nothing else
# ---------------------------------------------------------------------------


def test_a_draft_carries_exactly_the_documented_fields() -> None:
    assert set(Draft.model_fields) == {
        "local_key",
        "title",
        "body",
        "suggested_workflow",
        "dependencies",
    }


def test_a_plan_carries_exactly_the_documented_fields() -> None:
    assert set(Plan.model_fields) == {"drafts", "planner", "notes"}


def test_a_request_carries_exactly_the_documented_fields() -> None:
    assert set(PlanRequest.model_fields) == {"narrative", "outline", "context"}


def test_the_context_carries_exactly_the_documented_fields() -> None:
    assert set(PlanningContext.model_fields) == {
        "workflow_tags",
        "milestone",
        "local_key_prefix",
    }


def test_a_draft_carries_no_size() -> None:
    # Decision N3: there is one sizer in the product and it is the estimation pipeline. A
    # planner that guessed an effort alongside a title would make `all sized` a lie.
    assert not {"effort", "confidence", "est_minutes"} & set(Draft.model_fields)


@pytest.mark.parametrize("model", [Draft, Plan, PlanRequest, PlanningContext])
def test_every_shape_is_closed(model: type) -> None:
    assert model.model_config["extra"] == "forbid"


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------


def test_an_outline_is_optional_but_must_be_stated(plan_body: dict) -> None:
    # `None` is a value — the narrative-only case — and a *missing* key is a caller who
    # forgot, which is a different thing and is refused.
    assert PlanRequest.model_validate(plan_body | {"outline": None}).outline is None

    with pytest.raises(ValidationError):
        PlanRequest.model_validate(
            {k: v for k, v in plan_body.items() if k != "outline"}
        )


def test_a_milestone_is_optional_but_must_be_stated(plan_body: dict) -> None:
    context = plan_body["context"]

    assert PlanRequest.model_validate(
        plan_body | {"context": context | {"milestone": None}}
    )

    with pytest.raises(ValidationError):
        PlanRequest.model_validate(
            plan_body
            | {"context": {k: v for k, v in context.items() if k != "milestone"}}
        )


def test_an_empty_narrative_is_refused(plan_body: dict) -> None:
    # It is the thing being planned. An outline with no reason attached is a list of tasks
    # nobody stated an outcome for.
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(plan_body | {"narrative": ""})


def test_a_narrative_past_the_bound_is_refused(plan_body: dict) -> None:
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(
            plan_body | {"narrative": "x" * (MAX_NARRATIVE_LENGTH + 1)}
        )


def test_a_context_offering_no_workflow_tags_is_refused(plan_body: dict) -> None:
    # `suggested_workflow` is required and this service holds no list of tags, so a request
    # offering none has no batch the contract can answer with.
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(
            plan_body | {"context": plan_body["context"] | {"workflow_tags": []}}
        )


@pytest.mark.parametrize("prefix", ["ota", "OTA-", "1OTA", "", "O TA", "OTAOTAOTAOTA1"])
def test_a_prefix_that_is_not_a_prefix_is_refused(plan_body: dict, prefix: str) -> None:
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(
            plan_body | {"context": plan_body["context"] | {"local_key_prefix": prefix}}
        )


def test_a_property_the_contract_does_not_declare_is_refused(plan_body: dict) -> None:
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(plan_body | {"outlne": "- typo"})


# ---------------------------------------------------------------------------
# The draft
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key", ["OTA-0", "OTA-01", "ota-1", "OTA1", "OTA-", "-1", "OTA-1-2"]
)
def test_a_local_key_that_is_not_one_is_refused(key: str) -> None:
    with pytest.raises(ValidationError):
        _draft(key)


def test_an_empty_body_is_a_real_answer() -> None:
    # A bullet with no detail under it has nothing more to say, and `""` is honest where an
    # invented paragraph would not be.
    assert _draft("OTA-1", body="").body == ""


def test_an_empty_title_is_refused() -> None:
    assert _draft("OTA-1", title="x" * MAX_TITLE_LENGTH)

    with pytest.raises(ValidationError):
        _draft("OTA-1", title="")


def test_a_title_past_the_bound_is_refused() -> None:
    with pytest.raises(ValidationError):
        _draft("OTA-1", title="x" * (MAX_TITLE_LENGTH + 1))


def test_a_body_past_the_bound_is_refused() -> None:
    with pytest.raises(ValidationError):
        _draft("OTA-1", body="x" * (MAX_BODY_LENGTH + 1))


# ---------------------------------------------------------------------------
# The batch resolves, or it is not a batch
# ---------------------------------------------------------------------------


def test_a_batch_needs_at_least_one_draft() -> None:
    # A planner that could not decompose the work answers with the whole of it as one
    # ticket. An empty batch is not an honest degradation, it is a lost request.
    with pytest.raises(ValidationError):
        Plan(drafts=[], planner="outline-v0", notes=[])


def test_a_duplicate_local_key_is_refused() -> None:
    with pytest.raises(ValidationError, match="not unique"):
        _plan(_draft("OTA-1"), _draft("OTA-1"))


def test_a_dependency_on_a_key_outside_the_batch_is_refused() -> None:
    # A local key means nothing outside the batch it was drafted in, so this edge could
    # neither be stored nor pushed — and a graph that only looks complete is worse than one
    # that is refused.
    with pytest.raises(ValidationError, match="not in the batch"):
        _plan(_draft("OTA-1", dependencies=["OTA-9"]))


def test_a_draft_that_depends_on_itself_is_refused() -> None:
    with pytest.raises(ValidationError, match="depends on itself"):
        _plan(_draft("OTA-1", dependencies=["OTA-1"]))


def test_a_batch_whose_edges_resolve_is_accepted() -> None:
    plan = _plan(_draft("OTA-1"), _draft("OTA-2", dependencies=["OTA-1"]))

    assert plan.drafts[1].dependencies == ["OTA-1"]


def test_provenance_is_required_and_non_empty() -> None:
    with pytest.raises(ValidationError):
        Plan(drafts=[_draft("OTA-1")], planner="", notes=[])
