"""Which alias a model stage asks for (DI.6, #1321)."""

from ouroboros_engine.execution.stage import stage_model
from ouroboros_engine.workflows.dsl import LlmConfig


def _config(routing: dict[str, object]) -> LlmConfig:
    """An ``llm`` stage's config with the routing given.

    Args:
        routing: The ``routing`` object.

    Returns:
        The validated config.
    """
    return LlmConfig.model_validate(
        {
            "mode": "prompt",
            "prompt_template": "Do it.",
            "routing": routing,
            "limits": {"max_retries": 0, "token_budget": 1000},
            "permissions": {"push_fixup": False, "touch_ci": False},
        }
    )


def test_a_pinned_alias_wins() -> None:
    """A pinned stage asks with its pin, whatever the run or the tasks say."""
    config = _config({"pinned_model": {"alias": "pinned"}})

    assert stage_model(config, "run-model", {"implement": "coder"}) == "pinned"


def test_an_inheriting_stage_asks_with_its_task_route_alias() -> None:
    """``implement`` asks with the implement route's alias, not the run's model."""
    config = _config({"inherit_task": "implement"})

    assert (
        stage_model(config, "slice-planner", {"implement": "slice-coder"})
        == "slice-coder"
    )


def test_an_unrouted_task_falls_back_to_the_run_model() -> None:
    """A task ``start`` could not resolve, or an older control plane, keeps the old rule."""
    config = _config({"inherit_task": "implement"})

    assert stage_model(config, "run-model", {"plan": "planner"}) == "run-model"
    assert stage_model(config, "run-model") == "run-model"
