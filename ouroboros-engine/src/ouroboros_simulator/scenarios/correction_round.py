"""``correction-round``: a failure a person marks and routes, and the attempt it starts.

Mockup 11's *Queue correction round → attempt N+1* (`#332
<https://github.com/NobuData/ouroboros/issues/332>`_, decision **T6**). ``implement`` attempt 1
lands a fix whose tests fail, and the loop **holds** — a safe boundary every
:data:`WAIT_SECONDS` — for somebody to classify the failure on the test results page. The
classification sends a steer with ``retryStage``: the session records its note against
attempt 2, and the script starts attempt 2 with that note as its planning context::

    queued → analyze → plan → implement(1) ✗ … Mark & Route … → implement(2) ✓
                            → build → test → review → checks-green ✓ → open-pr ✓

Without a correction round within :data:`WAIT_STEPS` boundaries, attempt 1 is closed
``failed`` and the run ends ``needs_human``.
"""

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

#: How many safe boundaries the loop holds for a correction round before it gives up.
WAIT_STEPS = 12

#: Scripted seconds between those boundaries.
WAIT_SECONDS = 20

#: Attempt 2's edit: the correction note's approach — PID sampling off the telemetry path.
CORRECTED_EDIT: list[tuple[str, str]] = [
    ("ctx", "/* telemetry frame path */"),
    ("del", "pid_sample_velocity(&tel_ctx);"),
    (
        "add",
        "/* PID velocity is sampled by the control thread, not the telemetry ISR */",
    ),
    ("ctx", "k_msgq_put(&tel_msgq, tx_frame, K_NO_WAIT);"),
]


def run(session: RunSession) -> Outcome:
    """Fail attempt 1, hold for a correction round, and run attempt 2 with its note.

    Args:
        session: The open run.

    Returns:
        ``completed`` after a correction round, ``needs_human`` without one.
    """
    prelude(session)
    _attempt_one(session)

    session.model(
        "2 tests still fail. Holding at a safe boundary for a person to Mark & Route the "
        "failure; a correction round will start attempt 2 with their note."
    )
    correction = None
    for _ in range(WAIT_STEPS):
        session.work(WAIT_SECONDS)
        correction = session.correction_for("implement")
        if correction is not None:
            break

    session.stage("implement", "failed")
    if correction is None:
        session.system(
            "No correction round arrived. Attempt 1 is closed failed and the loop needs a "
            "human. Simulated run."
        )
        session.flush()
        return "needs_human"

    session.stage("implement", "active", attempt=correction.attempt)
    session.model(
        f"Correction round on attempt {correction.attempt}, planned with the note: "
        f"{quote(correction)}. Keeping the k_msgq and moving PID velocity sampling off the "
        "telemetry path."
    )
    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(CORRECTED_EDIT))
    session.work(30)
    session.files(
        [
            changed(
                "drivers/can/telemetry_buf.c", "modified", 40, 13, (40, CORRECTED_EDIT)
            ),
            changed(
                "tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)
            ),
        ]
    )
    session.commit("f42b9a0", "can: sample PID velocity off the telemetry path")
    session.tool(
        "run_tests", "twister -T tests/telemetry", {"result": "3 passed, 0 failed"}
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=52000,
        tokens_out=15000,
        cost_cents="36.0000",
        task_kind="implement",
    )
    session.work(30)
    session.stage("implement", "succeeded")

    delivery(session)
    return "completed"


def _attempt_one(session: RunSession) -> None:
    """``implement`` attempt 1: a fix whose tests fail. Left ``active`` while the loop holds.

    Args:
        session: The open run.
    """
    session.stage("implement", "active")
    session.tool("read_file", "drivers/can/telemetry_buf.c")
    session.work(36)
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
    session.commit("a3f19c2", "can: replace telemetry k_fifo with k_msgq + frame seq")
    session.tool(
        "run_tests",
        "twister -T tests/telemetry",
        {"severity": "warn", "result": "1 passed, 2 failed"},
    )
    session.spend(
        provider=PROVIDER,
        tokens_in=70000,
        tokens_out=20000,
        cost_cents="48.0000",
        task_kind="implement",
    )


SCENARIO = Scenario(
    name="correction-round",
    summary="Attempt 1's tests fail and the loop holds for Mark & Route: a correction round "
    "starts attempt 2 with the note as its planning context.",
    branch="loop/482-canbus-flake-correction",
    script=run,
)
