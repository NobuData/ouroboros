"""``failing-hil``: mockup 11's story — a rig build that mass-fails, a partial one, and a green one.

AT.6 (`#334 <https://github.com/NobuData/ouroboros/issues/334>`_) amends AP.5 with the test
plane's scenario. ``implement`` attempt 1 sends two builds to the rig ``helios-rig-02``:
Build 1 fails 14 of 63, Build 2 fails 2 — the motor overshoot, 2.4 % against a 2.0 % limit —
and the loop **holds** for a person to Mark & Route it on the test results page. Their
correction round starts attempt 2 with the note, and Build 3 is green::

    queued → analyze → plan → implement(1)  Build 1 49/63 ✗ · Build 2 61/63 ✗ … Mark & Route …
                            → implement(2)  Build 3 63/63 ✓
                            → build → test → review → checks-green ✓ → open-pr ✓

**The results themselves are the farm's, not the transcript's.** Each build is a farm job on the
rig, and the rig uploads its reports through AT.2's upload path (``POST
/api/v1/farm/jobs/:id/artifacts`` with the job's single-use token); the test results page is
parsed from those uploads. This script reports what the run console shows of it — the stages,
the commits, the runs of the tests and the hold — and never writes a test result. The upload
half of the same story is replayed on the REST harness by ``ouroboros-rest``'s
``src/modules/test-plane/failing-hil.scenario.fixture.ts``, with the same builds and figures;
a loop that submits its own builds to the farm is AJ.3's
(`#265 <https://github.com/NobuData/ouroboros/issues/265>`_).

Without a correction round within :data:`WAIT_STEPS` boundaries, attempt 1 is closed ``failed``
and the run ends ``needs_human``.
"""

from dataclasses import dataclass

from ouroboros_simulator.scenarios.common import (
    PROVIDER,
    TELEMETRY_EDIT,
    TEST_ADDED,
    Outcome,
    Scenario,
    await_correction,
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

#: The rig every build runs on — mockup 11's ``rig:helios-rig-02``.
RIG = "helios-rig-02"

#: Cases on the test results page: 24 + 19 + 12 + 6 simulated, 2 on the rig.
TOTAL_CASES = 63


@dataclass(frozen=True)
class Build:
    """One build attempt, as mockup 11's attempt card prints it.

    Attributes:
        label: ``Build 1`` … ``Build 3``.
        sha: The commit it built.
        failed: Cases that failed.
        detail: What the failures were, for the transcript.
    """

    label: str
    sha: str
    failed: int
    detail: str

    @property
    def passed(self) -> int:
        """Cases that passed."""
        return TOTAL_CASES - self.failed


#: The three builds, oldest first — the same figures the REST harness uploads.
BUILDS: tuple[Build, Build, Build] = (
    Build(
        "Build 1",
        "a3f19c2",
        14,
        "12 telemetry cases, motor overshoot 2.4% > 2.0%, 37 reordered CAN frames",
    ),
    Build("Build 2", "c81d4e7", 2, "1 telemetry case, motor overshoot 2.4% > 2.0%"),
    Build("Build 3", "f42b9a0", 0, "motor overshoot 1.6% inside the 2.0% limit"),
)

#: Attempt 1's second edit: frame sequence numbers, which clear most of the telemetry failures.
SEQUENCE_EDIT: list[tuple[str, str]] = [
    ("ctx", "/* telemetry frame path */"),
    ("add", "if (rx.seq != expected_seq) { tel_stats.reordered++; }"),
    ("ctx", "k_msgq_get(&tel_msgq, &rx, K_FOREVER);"),
]

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
    """Fail two rig builds, hold for a correction round, and turn the third build green.

    Args:
        session: The open run.

    Returns:
        ``completed`` after a correction round, ``needs_human`` without one.
    """
    prelude(session)
    _attempt_one(session)

    session.model(
        "Build 2 still fails the motor overshoot on the rig (2.4% against a 2.0% limit). "
        "Holding at a safe boundary for a person to Mark & Route it on the test results "
        "page; a correction round will start attempt 2 with their note."
    )
    correction = await_correction(
        session, "implement", steps=WAIT_STEPS, seconds=WAIT_SECONDS
    )

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
        f"{quote(correction)}. Moving PID velocity sampling off the telemetry path."
    )
    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(CORRECTED_EDIT))
    session.work(30)
    session.files(
        [
            changed(
                "drivers/can/telemetry_buf.c", "modified", 42, 13, (40, CORRECTED_EDIT)
            ),
            changed(
                "tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)
            ),
        ]
    )
    _build(session, BUILDS[2], "can: sample PID velocity off the telemetry path")
    session.spend(
        provider=PROVIDER,
        tokens_in=52000,
        tokens_out=15000,
        cost_cents="36.0000",
        task_kind="implement",
    )
    session.stage("implement", "succeeded")

    delivery(session)
    return "completed"


def _attempt_one(session: RunSession) -> None:
    """``implement`` attempt 1: Build 1 mass-fails, Build 2 is partial. Left ``active``.

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
    _build(session, BUILDS[0], "can: replace telemetry k_fifo with k_msgq")

    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(SEQUENCE_EDIT))
    session.work(40)
    _build(session, BUILDS[1], "can: sequence telemetry frames")
    session.spend(
        provider=PROVIDER,
        tokens_in=70000,
        tokens_out=20000,
        cost_cents="48.0000",
        task_kind="implement",
    )


def _build(session: RunSession, build: Build, message: str) -> None:
    """Commit, send the build to the rig, and report its results as the console shows them.

    Args:
        session: The open run.
        build: The build.
        message: The commit message.
    """
    session.commit(build.sha, message)
    session.system(
        f"{build.label} of {build.sha} sent to rig {RIG}; the rig uploads its JUnit and HIL "
        "reports to the test results page. Simulated run."
    )
    session.work(60)
    result: dict[str, object] = {
        "result": f"{build.passed} passed, {build.failed} failed · {build.detail}"
    }
    if build.failed:
        # Amber in the console, as the seeded run's failing test line is.
        result["severity"] = "warn"
    session.tool("run_tests", f"farm build on {RIG}: west twister + ouro-hil", result)


SCENARIO = Scenario(
    name="failing-hil",
    summary="Mockup 11: rig Build 1 fails 14 of 63 and Build 2 fails 2 (motor overshoot); "
    "the loop holds for Mark & Route, and the correction round's Build 3 is green.",
    branch="loop/482-canbus-flake",
    script=run,
)
