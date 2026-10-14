"""A stage context over a small working tree, shared by the execution suites."""

from pathlib import Path

from ouroboros_engine.execution.policy import ToolPolicy
from ouroboros_engine.execution.spi import StageContext
from ouroboros_engine.workflows.dsl import LlmPermissions


def make_context(tree: Path, *, touch_ci: bool = False) -> StageContext:
    """An ``implement`` attempt over ``tree``, with ``boot/**`` protected.

    Args:
        tree: The working tree; ``README.md`` is written into it.
        touch_ci: The stage's ``touch_ci`` permission.

    Returns:
        The context.
    """
    (tree / "README.md").write_text("# sandbox\n")
    return StageContext(
        run_id="run-1",
        stage_key="implement",
        attempt=1,
        prompt="Add a greeting function.",
        model="claude-sonnet-5-5",
        policy=ToolPolicy(
            working_tree=str(tree),
            permissions=LlmPermissions(push_fixup=False, touch_ci=touch_ci),
            protected_paths=("boot/**",),
        ),
    )
