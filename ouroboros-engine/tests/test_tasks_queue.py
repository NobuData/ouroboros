"""The task registry and the in-process queue behind ``/v0/tasks`` (#54).

Each test drives the queue inside one ``asyncio.run`` — the queue lives on one event loop,
as it does under the application's lifespan. Handlers are gated on events rather than on
sleeps wherever an ordering is asserted, so a slow machine cannot reorder them.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError

from ouroboros_engine.tasks.contract import (
    ENGINE_SHUTDOWN,
    TASK_CRASHED,
    TaskFailedError,
    TaskRecord,
)
from ouroboros_engine.tasks.queue import (
    QueueFullError,
    QueueNotRunningError,
    TaskQueue,
)
from ouroboros_engine.tasks.registry import (
    MAX_SLEEP_SECONDS,
    TaskKind,
    TaskRegistry,
    UnknownTaskKindError,
    default_registry,
)


class _Empty(BaseModel):
    """A payload with no fields."""

    model_config = ConfigDict(extra="forbid")


def _kind(name: str, handler: Callable[[Any], Awaitable[dict[str, Any]]]) -> TaskKind:
    """A test kind over an empty payload.

    Args:
        name: Its name.
        handler: What it runs.

    Returns:
        The kind.
    """
    return TaskKind(name, _Empty, handler)


async def _settled(queue: TaskQueue, task_id: str) -> TaskRecord:
    """Wait until a task is final.

    Args:
        queue: The queue.
        task_id: The task.

    Returns:
        Its final record.
    """
    for _ in range(500):
        record = queue.get(task_id)
        assert record is not None
        if record.status in ("done", "failed", "cancelled"):
            return record
        await asyncio.sleep(0.01)
    raise AssertionError(f"task {task_id} never finished")


def _run(scenario: Callable[[], Awaitable[None]]) -> None:
    """Run one scenario on a fresh loop.

    Args:
        scenario: The coroutine function.
    """
    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


def test_the_default_registry_holds_sleep_and_echo() -> None:
    assert default_registry().names() == ["echo", "sleep"]


def test_an_unknown_kind_is_refused() -> None:
    with pytest.raises(UnknownTaskKindError):
        default_registry().get("build")


def test_a_kind_cannot_be_registered_twice() -> None:
    registry = default_registry()

    with pytest.raises(ValueError, match="already registered"):
        registry.register(registry.get("sleep"))


def test_bounds_below_one_are_refused() -> None:
    with pytest.raises(ValueError):
        TaskQueue(default_registry(), workers=0)


# ---------------------------------------------------------------------------
# Submit → poll → complete
# ---------------------------------------------------------------------------


def test_a_sleep_task_runs_to_done() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()
        submitted = queue.submit("sleep", {"seconds": 0.01})

        assert submitted.status == "queued"
        assert submitted.started_at is None

        record = await _settled(queue, submitted.task_id)
        await queue.stop()

        assert record.status == "done"
        assert record.result == {"slept_seconds": 0.01}
        assert record.error is None
        assert record.started_at is not None and record.finished_at is not None
        assert record.created_at <= record.started_at <= record.finished_at

    _run(scenario)


def test_an_echo_task_answers_its_payload() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()
        submitted = queue.submit("echo", {"note": "hi", "n": [1, 2]})
        record = await _settled(queue, submitted.task_id)
        await queue.stop()

        assert record.result == {"note": "hi", "n": [1, 2]}

    _run(scenario)


def test_a_payload_that_does_not_fit_the_kind_is_refused_before_queueing() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()

        with pytest.raises(ValidationError):
            queue.submit("sleep", {"seconds": MAX_SLEEP_SECONDS + 1})
        with pytest.raises(ValidationError):
            queue.submit("sleep", {"seconds": 1, "extra": True})
        with pytest.raises(UnknownTaskKindError):
            queue.submit("build", {})
        await queue.stop()

    _run(scenario)


def test_a_submission_before_start_is_refused() -> None:
    with pytest.raises(QueueNotRunningError):
        TaskQueue(default_registry()).submit("echo", {})


def test_a_full_queue_refuses_more() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()

        async def blocked(_payload: _Empty) -> dict[str, Any]:
            await gate.wait()
            return {}

        queue = TaskQueue(
            TaskRegistry([_kind("blocked", blocked)]), workers=1, max_pending=1
        )
        await queue.start()
        running = queue.submit("blocked", {})
        await asyncio.sleep(0)  # the one worker takes it off the queue
        queue.submit("blocked", {})

        with pytest.raises(QueueFullError):
            queue.submit("blocked", {})

        gate.set()
        await _settled(queue, running.task_id)
        await queue.stop()

    _run(scenario)


def test_the_pool_runs_tasks_concurrently_up_to_its_size() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()
        active = 0
        peak = 0

        async def counted(_payload: _Empty) -> dict[str, Any]:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await gate.wait()
            active -= 1
            return {}

        queue = TaskQueue(TaskRegistry([_kind("counted", counted)]), workers=2)
        await queue.start()
        ids = [queue.submit("counted", {}).task_id for _ in range(3)]
        for _ in range(5):
            await asyncio.sleep(0)

        assert peak == 2
        assert queue.get(ids[2]).status == "queued"  # type: ignore[union-attr]

        gate.set()
        for task_id in ids:
            assert (await _settled(queue, task_id)).status == "done"
        await queue.stop()

    _run(scenario)


# ---------------------------------------------------------------------------
# Failure
# ---------------------------------------------------------------------------


def test_a_named_failure_is_recorded_with_its_code() -> None:
    async def scenario() -> None:
        async def refuses(_payload: _Empty) -> dict[str, Any]:
            raise TaskFailedError("repo_missing", "The repository is gone.")

        queue = TaskQueue(TaskRegistry([_kind("refuses", refuses)]))
        await queue.start()
        record = await _settled(queue, queue.submit("refuses", {}).task_id)
        await queue.stop()

        assert record.status == "failed"
        assert record.error is not None
        assert record.error.model_dump() == {
            "code": "repo_missing",
            "message": "The repository is gone.",
        }

    _run(scenario)


def test_an_unexpected_error_fails_the_task_not_the_worker() -> None:
    async def scenario() -> None:
        async def crashes(_payload: _Empty) -> dict[str, Any]:
            raise RuntimeError("secret internals")

        registry = TaskRegistry([_kind("crashes", crashes)])
        registry.register(default_registry().get("echo"))
        queue = TaskQueue(registry, workers=1)
        await queue.start()
        crashed = await _settled(queue, queue.submit("crashes", {}).task_id)
        after = await _settled(queue, queue.submit("echo", {"ok": 1}).task_id)
        await queue.stop()

        assert crashed.status == "failed"
        assert crashed.error is not None
        assert crashed.error.code == TASK_CRASHED
        assert "secret" not in crashed.error.message
        assert after.status == "done", "the one worker survived the crash"

    _run(scenario)


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def test_a_queued_task_is_cancelled_and_never_starts() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()
        started: list[str] = []

        async def blocked(_payload: _Empty) -> dict[str, Any]:
            started.append("ran")
            await gate.wait()
            return {}

        queue = TaskQueue(TaskRegistry([_kind("blocked", blocked)]), workers=1)
        await queue.start()
        first = queue.submit("blocked", {})
        second = queue.submit("blocked", {})
        await asyncio.sleep(0)

        cancelled = queue.cancel(second.task_id)
        gate.set()
        await _settled(queue, first.task_id)
        for _ in range(5):
            await asyncio.sleep(0)
        await queue.stop()

        assert cancelled is not None
        assert cancelled.status == "cancelled"
        assert cancelled.started_at is None
        assert started == ["ran"], "the cancelled task never ran"

    _run(scenario)


def test_a_running_task_is_cancelled_at_once() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()
        submitted = queue.submit("sleep", {"seconds": MAX_SLEEP_SECONDS})
        await asyncio.sleep(0.01)
        assert queue.get(submitted.task_id).status == "running"  # type: ignore[union-attr]

        cancelled = queue.cancel(submitted.task_id)
        await asyncio.sleep(0.01)
        after = queue.get(submitted.task_id)
        await queue.stop()

        assert cancelled is not None and cancelled.status == "cancelled"
        assert cancelled.finished_at is not None
        assert after == cancelled, "the record does not move after the cancel"

    _run(scenario)


def test_cancelling_a_finished_task_leaves_it_as_it_was() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()
        done = await _settled(queue, queue.submit("echo", {}).task_id)

        assert queue.cancel(done.task_id) == done
        await queue.stop()

    _run(scenario)


def test_an_unknown_id_is_none() -> None:
    queue = TaskQueue(default_registry())

    assert queue.get("nope") is None
    assert queue.cancel("nope") is None


# ---------------------------------------------------------------------------
# Restart behaviour and retention
# ---------------------------------------------------------------------------


def test_stop_cancels_running_tasks_as_engine_shutdown() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry())
        await queue.start()
        submitted = queue.submit("sleep", {"seconds": MAX_SLEEP_SECONDS})
        await asyncio.sleep(0.01)
        await queue.stop()
        record = queue.get(submitted.task_id)

        assert record is not None
        assert record.status == "cancelled"
        assert record.error is not None and record.error.code == ENGINE_SHUTDOWN
        assert not queue.started

    _run(scenario)


def test_a_new_process_knows_none_of_the_old_ids() -> None:
    async def scenario() -> None:
        before = TaskQueue(default_registry())
        await before.start()
        submitted = before.submit("echo", {})
        await before.stop()

        after = TaskQueue(default_registry())
        await after.start()

        assert after.get(submitted.task_id) is None
        await after.stop()

    _run(scenario)


def test_the_oldest_finished_records_are_forgotten_past_the_bound() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry(), retain_finished=2)
        await queue.start()
        ids = []
        for _ in range(3):
            task_id = queue.submit("echo", {}).task_id
            await _settled(queue, task_id)
            ids.append(task_id)
        await queue.stop()

        assert queue.get(ids[0]) is None
        assert queue.get(ids[1]) is not None
        assert queue.get(ids[2]) is not None

    _run(scenario)


def test_start_twice_does_not_double_the_pool() -> None:
    async def scenario() -> None:
        queue = TaskQueue(default_registry(), workers=2)
        await queue.start()
        await queue.start()

        assert len(queue._pool) == 2
        await queue.stop()

    _run(scenario)
