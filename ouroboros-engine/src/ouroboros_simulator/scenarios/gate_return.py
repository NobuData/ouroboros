"""``482-gate-return``: mockup 10 in motion.

The loop reaches ``implement``, its tests flake, the ``checks-green`` gate sends it back, and
attempt 2 picks up with the transcript filling in beneath it. The timings are the mockup's:
attempt 1 runs from 3m 21s to 7m 40s, the gate returns at 7m 48s, attempt 2 starts at
7m 55s. A steer on attempt 2 changes its approach, which is the criterion *steering
alters a scripted branch*.

::

    queued → analyze → plan → implement(1) ✗ → checks-green(1) ✗ ↺
                              → implement(2) → build → test → review → checks-green(2) ✓
                              → open-pr ✓
"""

from ouroboros_engine.control_plane.ingest import StageReturn
from ouroboros_simulator.scenarios.common import (
    PROVIDER,
    TELEMETRY_EDIT,
    TEST_ADDED,
    Outcome,
    Scenario,
    changed,
    delivery,
    diff,
    prelude,
    quote,
)
from ouroboros_simulator.session import RunSession

#: Attempt 2's edit without a steer: mockup 10's second diff.
ISR_EDIT: list[tuple[str, str]] = [
    ("del", "k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);"),
    (
        "del",
        "frame.seq = atomic_inc(&tel_seq);   /* too late: consumer may run first */",
    ),
    ("add", "frame.seq = atomic_inc(&tel_seq);   /* assign before enqueue */"),
    ("add", "int ret = k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);"),
    ("add", '__ASSERT(ret == 0, "tel msgq overflow in ISR");'),
]

#: Attempt 2's edit when a person steered it: the same window closed with an IRQ lock in a
#: new header, rather than by reordering the ISR fast path.
IRQ_LOCK_EDIT: list[tuple[str, str]] = [
    ("ctx", "/* telemetry frame path */"),
    ("add", "unsigned int key = irq_lock();"),
    ("add", "tx_frame->seq = atomic_inc(&tel_seq);"),
    ("ctx", "k_msgq_put(&tel_msgq, tx_frame, K_NO_WAIT);"),
    ("add", "irq_unlock(key);"),
]


def run(session: RunSession) -> Outcome:
    """Replay mockup 10's run, including the gate return.

    Args:
        session: The open run.

    Returns:
        ``completed``.
    """
    prelude(session)
    _attempt_one(session)

    # The gate reads attempt 1's failed tests and takes the `fail ↺` loop edge back to
    # `implement`. Build, test and review never started, so they stay pending.
    session.stage("checks-green", "active")
    session.gate("test flake reproduced — returning to implement (attempt 2) ↺")
    session.stage("checks-green", "failed")

    _attempt_two(session)
    delivery(session, gate_attempt=2)
    return "completed"


def _attempt_one(session: RunSession) -> None:
    """``implement`` attempt 1: a plausible fix whose tests still flake.

    Args:
        session: The open run.
    """
    session.stage("implement", "active")
    session.tool("read_file", "drivers/can/telemetry_buf.c")
    session.work(36)
    session.model(
        "The buffer uses a bare k_fifo shared between the RX ISR and the telemetry thread. "
        "k_fifo gives no ordering guarantee once the ISR preempts a partially completed put "
        "— that matches the flake signature. Switching to a k_msgq with an explicit "
        "per-frame sequence number lets the consumer detect and tolerate reorder."
    )
    session.work(38)
    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(TELEMETRY_EDIT))
    session.files(
        [
            changed(
                "drivers/can/telemetry_buf.c", "modified", 38, 12, (40, TELEMETRY_EDIT)
            ),
            changed(
                "tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)
            ),
        ]
    )
    session.commit("a41c9e2", "can: replace telemetry k_fifo with k_msgq + frame seq")
    session.work(32)
    session.tool(
        "run_tests",
        "twister -T tests/telemetry",
        {
            "severity": "warn",
            "result": "2 passed, 1 flaked → retrying under load profile",
        },
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=70000,
        tokens_out=20000,
        cost_cents="48.0000",
        task_kind="implement",
    )
    session.work(150)
    session.stage("implement", "failed")


def _attempt_two(session: RunSession) -> None:
    """``implement`` attempt 2, and the branch a steer takes it down.

    Args:
        session: The open run.
    """
    session.stage(
        "implement",
        "active",
        attempt=2,
        returned_from=StageReturn(
            stage_key="checks-green", kind="gate", reason="failed_tests"
        ),
    )
    session.model(
        "The reorder window is in the ISR fast path; sequence numbers must be assigned "
        "before the enqueue, not after — a consumer scheduled between the put and the "
        "increment still observes a stale seq."
    )
    # The deliberation window: the safe boundaries where a steer typed into the console
    # lands on this attempt. The branch below reads whatever landed.
    session.work(40)
    session.work(35)

    steer = session.steer_for("implement", 2)
    if steer is None:
        session.tool("edit_file", "drivers/can/isr_fastpath.c", diff(ISR_EDIT))
        second = changed("drivers/can/isr_fastpath.c", "modified", 9, 3, (88, ISR_EDIT))
        message = "can: assign frame seq in ISR before enqueue"
    else:
        session.model(
            f"Steering received on attempt 2: {quote(steer)}. Taking the alternative: "
            "keep the enqueue order and close the window with an IRQ lock around the "
            "sequence assignment, instead of editing the ISR fast path."
        )
        session.tool("edit_file", "drivers/can/telemetry_lock.h", diff(IRQ_LOCK_EDIT))
        second = changed(
            "drivers/can/telemetry_lock.h", "added", 6, 0, (1, IRQ_LOCK_EDIT)
        )
        message = "can: guard telemetry seq assignment with irq_lock"

    session.files(
        [
            changed(
                "drivers/can/telemetry_buf.c", "modified", 38, 12, (40, TELEMETRY_EDIT)
            ),
            second,
            changed(
                "tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)
            ),
        ]
    )
    session.commit("7f03b8d" if steer is None else "3c5e1a9", message)
    session.spend(
        provider=PROVIDER,
        tokens_in=46000,
        tokens_out=14000,
        cost_cents="34.0000",
        task_kind="implement",
    )
    session.tool("run_tests", "twister -T tests/telemetry --load-profile")
    session.work(90)
    session.tool(
        "run_tests",
        "twister -T tests/telemetry --load-profile",
        {"state": "running", "progress": {"done": 47, "total": 63}},
    )
    session.work(40)
    session.tool(
        "run_tests",
        "twister -T tests/telemetry --load-profile",
        {"result": "63 passed, 0 failed"},
    )
    session.stage("implement", "succeeded", attempt=2)


SCENARIO = Scenario(
    name="482-gate-return",
    summary="Mockup 10's story: implement fails its tests, the gate returns, attempt 2 "
    "proceeds (a steer on attempt 2 changes its approach).",
    branch="loop/482-canbus-flake",
    script=run,
)
