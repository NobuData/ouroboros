"""The StageExecutor conformance kit — what every executor kind must satisfy (DH.1, #1302).

An adapter's test module calls :func:`check_run`, :func:`check_pause_resume` and
:func:`check_abort` with a factory for its executor and a context, and asserts the returned
list of violations is empty. The kit does not script the executor — a real harness is driven
by its model, or by a recorded provider fixture — so every check is a property of whatever
stream the executor produced:

* every event is one of the vocabulary's five kinds, for the context's stage and attempt,
  in strictly increasing ``seq``;
* every ``tool_request`` is answered by a ``tool_result`` before the next request, whose
  verdict is **the policy's own** for that request — an executor that decides for itself,
  or skips the question, fails;
* a ``deny`` ends the stream (``halted``, carrying that verdict), with no file change after
  it; every ``file_change`` follows an allowed write of that path;
* the stream ends with :attr:`~ouroboros_engine.execution.spi.StageExecutor.outcome` set;
* pause and abort take effect at a boundary: no tool request after the request was made;
  a paused executor that claims ``resume`` hands back a checkpoint a fresh instance
  continues from, and one that does not refuses to resume.
"""

import asyncio
from collections.abc import Callable
from typing import Any

from ouroboros_engine.execution.events import (
    EVENT_KINDS,
    EVENT_TYPES,
    FileChange,
    ToolRequestEvent,
    ToolResultEvent,
)
from ouroboros_engine.execution.policy import WRITE_TOOLS, evaluate, resolve_in_tree
from ouroboros_engine.execution.spi import (
    EXECUTOR_KINDS,
    Checkpoint,
    ExecutorCapabilities,
    ExecutorCapabilityError,
    StageContext,
    StageExecutor,
)

ExecutorFactory = Callable[[], StageExecutor]


async def _drain(
    stream: Any, on_event: Callable[[Any], None] | None = None
) -> list[Any]:
    """Collect a stream, calling ``on_event`` after each event."""
    events: list[Any] = []
    async for event in stream:
        events.append(event)
        if on_event is not None:
            on_event(event)
    return events


def check_stream(
    ctx: StageContext, events: list[Any], *, after_seq: int = 0
) -> list[str]:
    """Check one stream's events against the vocabulary, the context and the policy.

    Args:
        ctx: The context the stream ran under.
        events: What it yielded.
        after_seq: ``seq`` must start above this (a resumed stream).

    Returns:
        Every violation found, as a sentence; empty when the stream conforms.
    """
    problems: list[str] = []
    last_seq = after_seq
    pending: ToolRequestEvent | None = None
    allowed_writes: set[str] = set()
    halted = False
    for event in events:
        if not isinstance(event, EVENT_TYPES) or event.kind not in EVENT_KINDS:
            problems.append(
                f"event outside the vocabulary: {type(event).__name__} "
                f"{getattr(event, 'kind', None)!r}"
            )
            continue
        if halted:
            problems.append(
                f"{event.kind} seq {event.seq} after a deny halted the stage"
            )
        if event.stage_key != ctx.stage_key or event.attempt != ctx.attempt:
            problems.append(
                f"seq {event.seq} belongs to {event.stage_key}#{event.attempt}, "
                f"not {ctx.stage_key}#{ctx.attempt}"
            )
        if event.seq <= last_seq:
            problems.append(f"seq {event.seq} does not follow {last_seq}")
        last_seq = event.seq
        if isinstance(event, ToolRequestEvent):
            if pending is not None:
                problems.append(
                    f"tool request {pending.request.call_id} was never answered"
                )
            pending = event
        elif isinstance(event, ToolResultEvent):
            if pending is None or pending.request.call_id != event.call_id:
                problems.append(f"tool result {event.call_id} answers no open request")
                continue
            expected = evaluate(ctx.policy, pending.request)
            if event.verdict != expected:
                problems.append(
                    f"tool result {event.call_id} reports {event.verdict.decision} "
                    f"where the policy says {expected.decision}"
                )
            if expected.halts:
                halted = True
                if event.ok:
                    problems.append(f"denied call {event.call_id} reports it ran")
            elif pending.request.tool in WRITE_TOOLS:
                for path in pending.request.paths:
                    relative = resolve_in_tree(ctx.policy.working_tree, path)
                    if relative is not None:
                        allowed_writes.add(relative)
            pending = None
        elif isinstance(event, FileChange) and event.path not in allowed_writes:
            problems.append(f"file change {event.path} follows no allowed write")
    if pending is not None:
        problems.append(f"tool request {pending.request.call_id} was never answered")
    return problems


def check_run(factory: ExecutorFactory, ctx: StageContext) -> list[str]:
    """Run one attempt to its end and check it.

    Args:
        factory: Builds a fresh executor.
        ctx: The attempt's context.

    Returns:
        Every violation found; empty when the executor conforms.
    """
    executor = factory()
    problems: list[str] = []
    if executor.kind not in EXECUTOR_KINDS:
        problems.append(f"kind {executor.kind!r} is not one of {EXECUTOR_KINDS}")
    if not isinstance(executor.capabilities(), ExecutorCapabilities):
        problems.append("capabilities() is not an ExecutorCapabilities")
    events = asyncio.run(_drain(executor.run(ctx)))
    problems += check_stream(ctx, events)
    outcome = executor.outcome
    if outcome is None:
        problems.append("the stream ended with no outcome")
        return problems
    denies = [e for e in events if isinstance(e, ToolResultEvent) and e.verdict.halts]
    if denies and (outcome.status != "halted" or outcome.verdict != denies[0].verdict):
        problems.append(f"a deny was reported but the outcome is {outcome.status}")
    if outcome.status == "halted" and not denies:
        problems.append("the outcome is halted but no deny was reported")
    return problems


def _interrupt_after_first_result(
    executor: StageExecutor, ctx: StageContext, request: Callable[[], None]
) -> tuple[list[Any], int]:
    """Run until the first tool result, make the request, and drain the rest.

    Returns:
        The events, and how many had been seen when the request was made (-1 if never).
    """
    made_at = -1
    events: list[Any] = []

    def on_event(event: Any) -> None:
        nonlocal made_at
        events.append(event)
        if made_at < 0 and isinstance(event, ToolResultEvent):
            made_at = len(events)
            request()

    asyncio.run(_drain(executor.run(ctx), on_event))
    return events, made_at


def check_pause_resume(factory: ExecutorFactory, ctx: StageContext) -> list[str]:
    """Pause after the first tool result, then resume on a fresh instance.

    Args:
        factory: Builds a fresh executor.
        ctx: A context whose attempt makes at least two tool calls.

    Returns:
        Every violation found; empty when the executor conforms.
    """
    executor = factory()
    events, made_at = _interrupt_after_first_result(executor, ctx, executor.pause)
    if made_at < 0:
        return ["the attempt made no tool call, so pause could not be exercised"]
    problems = check_stream(ctx, events)
    late = [e for e in events[made_at:] if isinstance(e, ToolRequestEvent)]
    if late:
        problems.append(f"tool request seq {late[0].seq} ran after pause was requested")
    outcome = executor.outcome
    if outcome is None or outcome.status != "paused":
        problems.append(f"paused attempt ended {getattr(outcome, 'status', None)}")
        return problems
    capabilities = executor.capabilities()
    if outcome.checkpoint is None:
        if capabilities.resume:
            problems.append("claims resume but its pause carried no checkpoint")
        return problems
    if not capabilities.resume:
        problems.append("carried a checkpoint it does not claim to resume")
        return problems
    successor = factory()
    last_seq = events[-1].seq if events else 0
    resumed = asyncio.run(_drain(successor.resume(outcome.checkpoint)))
    problems += check_stream(ctx, resumed, after_seq=last_seq)
    if successor.outcome is None or successor.outcome.status == "paused":
        problems.append("the resumed attempt did not run on")
    return problems


def check_resume_refused(factory: ExecutorFactory, ctx: StageContext) -> list[str]:
    """An executor that does not claim ``resume`` refuses a checkpoint.

    Args:
        factory: Builds a fresh executor.
        ctx: Any context.

    Returns:
        Every violation found; empty when the executor conforms.
    """
    executor = factory()
    if executor.capabilities().resume:
        return []
    checkpoint = Checkpoint(executor_kind=executor.kind, context=ctx, next_seq=1)
    try:
        asyncio.run(_drain(executor.resume(checkpoint)))
    except ExecutorCapabilityError:
        return []
    except Exception as error:  # any other failure is itself the violation
        return [f"resume() raised {type(error).__name__}, not ExecutorCapabilityError"]
    return ["resume() ran although capabilities() says it cannot"]


def check_abort(factory: ExecutorFactory, ctx: StageContext) -> list[str]:
    """Abort after the first tool result.

    Args:
        factory: Builds a fresh executor.
        ctx: A context whose attempt makes at least two tool calls.

    Returns:
        Every violation found; empty when the executor conforms.
    """
    executor = factory()
    events, made_at = _interrupt_after_first_result(executor, ctx, executor.abort)
    if made_at < 0:
        return ["the attempt made no tool call, so abort could not be exercised"]
    problems = check_stream(ctx, events)
    late = [e for e in events[made_at:] if isinstance(e, ToolRequestEvent)]
    if late:
        problems.append(f"tool request seq {late[0].seq} ran after abort was requested")
    outcome = executor.outcome
    if outcome is None or outcome.status != "aborted":
        problems.append(f"aborted attempt ended {getattr(outcome, 'status', None)}")
    return problems
