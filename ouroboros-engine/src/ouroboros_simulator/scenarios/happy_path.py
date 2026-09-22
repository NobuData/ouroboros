"""``happy-path``: queued to merged, one attempt at everything, clean guardrails."""

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
)
from ouroboros_simulator.session import RunSession


def run(session: RunSession) -> Outcome:
    """Walk every stage once and merge.

    The change-set stays inside ``drivers/can`` and its test and carries hunks with nothing
    secret in them, so AP.3 judges ``ci_config`` and ``secrets`` clean.

    Args:
        session: The open run.

    Returns:
        ``completed``.
    """
    prelude(session)

    session.stage("implement", "active")
    session.tool("read_file", "drivers/can/telemetry_buf.c")
    session.work(36)
    session.model(
        "The buffer uses a bare k_fifo shared between the RX ISR and the telemetry thread. "
        "Switching to a k_msgq with a per-frame sequence number lets the consumer detect "
        "and tolerate reorder."
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
    session.spend(
        provider=PROVIDER,
        tokens_in=70000,
        tokens_out=20000,
        cost_cents="48.0000",
        task_kind="implement",
    )
    session.tool(
        "run_tests",
        "twister -T tests/telemetry",
        {"result": "3 passed, 0 failed"},
    )
    session.stage("implement", "succeeded")

    delivery(session)
    return "completed"


SCENARIO = Scenario(
    name="happy-path",
    summary="Queued → … → Open PR, one attempt at every stage, clean guardrails, merged.",
    branch="loop/482-canbus-flake",
    script=run,
)
