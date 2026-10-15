"""One model-stage attempt: its prompt, its policy, and the stream of what it did.

#160. The pieces of an ``llm`` node's attempt that do not depend on the walk:

* :func:`render_prompt` — the stage's prompt template followed by the issue.
* :func:`stage_model` — the stage's pinned alias, else the run's model.
* :func:`stage_policy` — DH.1's :class:`~ouroboros_engine.execution.policy.ToolPolicy` over
  the run's working tree, the stage's declared permissions and the workspace's protected
  paths. **Enforcement is the policy's alone**: an executor asks
  :func:`~ouroboros_engine.execution.policy.evaluate` before every tool, and this module's
  only job is to hand it the right inputs.
* :func:`drive` — consume the executor's events into the reporter and read its outcome.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence

from ouroboros_engine.execution.events import StageEvent
from ouroboros_engine.execution.policy import ToolPolicy
from ouroboros_engine.execution.reporter import RunLostError, RunReporter
from ouroboros_engine.execution.spi import StageExecutor, StageOutcome
from ouroboros_engine.workflows.dsl import LlmConfig


def render_prompt(
    config: LlmConfig, issue_number: int, title: str, body: str | None
) -> str:
    """The prompt one attempt runs with.

    Deliberately plain: the stage's ``prompt_template`` as written (a skill-mode stage's
    template too — skills are resolved by the executor), then the issue it works on.

    Args:
        config: The stage.
        issue_number: The issue's number.
        title: Its title.
        body: Its body, or ``None``.

    Returns:
        The prompt.
    """
    issue = f"Issue #{issue_number}: {title}"
    if body and body.strip():
        issue = f"{issue}\n\n{body.strip()}"
    return f"{config.prompt_template.strip()}\n\n{issue}"


def stage_model(config: LlmConfig, run_model: str) -> str:
    """The model a stage asks for.

    Args:
        config: The stage.
        run_model: The run's model, from ``start`` — what an inheriting stage uses.

    Returns:
        The stage's pinned routing alias, else the run's model.
    """
    pinned = config.routing.pinned_model
    return pinned.alias if pinned is not None else run_model


def stage_policy(
    config: LlmConfig, working_tree: str, protected_paths: Sequence[str]
) -> ToolPolicy:
    """The tool policy an attempt runs under.

    Args:
        config: The stage — its P9 permissions.
        working_tree: The run's tree, absolute.
        protected_paths: The workspace's protected-path globs.

    Returns:
        The policy, with L5's default allow-list.
    """
    return ToolPolicy(
        working_tree=working_tree,
        permissions=config.permissions,
        protected_paths=tuple(protected_paths),
    )


async def drive(
    executor: StageExecutor,
    stream: AsyncIterator[StageEvent],
    reporter: RunReporter,
) -> StageOutcome:
    """Report an attempt's events as they arrive, then read how it ended.

    Args:
        executor: The attempt's executor.
        stream: What :meth:`~StageExecutor.run` or :meth:`~StageExecutor.resume` returned.
        reporter: Where the events go.

    Returns:
        The executor's outcome. An executor that raised, or ended without one, is
        ``failed`` with the reason.

    Raises:
        RunLostError: A write was refused because the run is no longer this worker's; the
            executor has been asked to abort.
    """
    iterator = stream.__aiter__()
    try:
        while True:
            try:
                event = await iterator.__anext__()
            except StopAsyncIteration:
                break
            except Exception as error:
                await reporter.flush()
                return StageOutcome(
                    status="failed", error=f"{type(error).__name__}: {error}"
                )
            await reporter.record(event)
        await reporter.flush()
    except RunLostError:
        executor.abort()
        raise
    outcome = executor.outcome
    if outcome is None:
        return StageOutcome(
            status="failed", error="the executor's stream ended without an outcome"
        )
    return outcome
