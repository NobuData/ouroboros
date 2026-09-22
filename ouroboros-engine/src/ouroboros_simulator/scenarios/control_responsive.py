"""``control-responsive``: a long ``implement`` stage, built for pressing the controls.

A person drives this scenario from the console (or a test drives it through the public
controls API). ``implement`` is a series of short tool calls, each followed by a safe
boundary, so that:

* **Pause** lands *mid-stage*, between two tool calls, and holds there until **Resume**;
* **Steer** lands on attempt 1 without pausing, and the branch point after the survey reads
  it: a steered run takes the approach the steer asked for, with a different change-set;
* **Abort** stops the run at the next boundary from any running state, and the branch is
  preserved.

Without any control it runs to a merge, like ``happy-path``.
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

#: The survey before the branch point: each file is read, then a boundary.
SURVEY: tuple[str, ...] = (
    "drivers/can/telemetry_buf.c",
    "drivers/can/isr_fastpath.c",
    "drivers/can/Kconfig",
    "include/helios/telemetry.h",
    "tests/telemetry/test_frame_order.c",
    "tests/telemetry/testcase.yaml",
)

#: Scripted seconds each survey step takes.
STEP_SECONDS = 25

#: The steered branch's edit: a ring buffer instead of a message queue.
RING_EDIT: list[tuple[str, str]] = [
    ("ctx", "/* telemetry frame path */"),
    ("del", "static struct k_fifo tel_fifo;"),
    ("add", "RING_BUF_ITEM_DECLARE(tel_ring, CONFIG_TEL_QUEUE_DEPTH);"),
    ("add", "ring_buf_item_put(&tel_ring, TEL_FRAME, tx_frame->seq, data, words);"),
]


def run(session: RunSession) -> Outcome:
    """Survey, branch on a steer, implement, and deliver.

    Args:
        session: The open run.

    Returns:
        ``completed``, unless an abort unwinds it first.
    """
    prelude(session)

    session.stage("implement", "active")
    session.model(
        "Surveying the telemetry path before choosing an approach. Pause, steer and abort "
        "are honoured between each step. Simulated run."
    )
    for path in SURVEY:
        session.tool("read_file", path)
        session.work(STEP_SECONDS)

    steer = session.steer_for("implement", 1)
    if steer is None:
        session.model("No steering received. Taking the default approach: a k_msgq.")
        edit, message = TELEMETRY_EDIT, "can: replace telemetry k_fifo with k_msgq"
    else:
        session.model(
            f"Steering received on attempt 1: {quote(steer)}. Changing approach: a "
            "ring buffer with an explicit sequence field, instead of the default k_msgq."
        )
        edit, message = RING_EDIT, "can: move telemetry frames onto a ring buffer"

    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(edit))
    session.work(STEP_SECONDS)
    session.files(
        [
            changed("drivers/can/telemetry_buf.c", "modified", 30, 10, (40, edit)),
            changed(
                "tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)
            ),
        ]
    )
    session.commit("b7d20c1" if steer is None else "e94f3a0", message)
    session.spend(
        provider=PROVIDER,
        tokens_in=60000,
        tokens_out=18000,
        cost_cents="41.0000",
        task_kind="implement",
    )
    session.tool(
        "run_tests", "twister -T tests/telemetry", {"result": "3 passed, 0 failed"}
    )
    session.work(STEP_SECONDS)
    session.stage("implement", "succeeded")

    delivery(session)
    return "completed"


SCENARIO = Scenario(
    name="control-responsive",
    summary="A long implement stage with a safe boundary between every tool call: pause "
    "mid-stage, resume, steer to change the approach, or abort from any running state.",
    branch="loop/482-canbus-flake-controls",
    script=run,
)
