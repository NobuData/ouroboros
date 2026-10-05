"""``protected-path-allow-once``: a protected path stops the loop, and *Allow once* resumes it.

The inbox's allow-once chain, end to end (`#470
<https://github.com/NobuData/ouroboros/issues/470>`_). ``implement`` reports a change-set
that edits the telemetry buffer **and** adds one line to ``boot/can_bringup.c``. The control
plane judges it (AP.3): ``boot/**`` is protected, so ``allowed_paths`` fails, and after the
report commits the ingest service hands the run to the protected-path emitter, which files a
``protected_path_allow_once`` decision item — *"Allow a one-time edit to a protected path?"*.
The driver does not post a verdict and does not file the card; it reads the answer.

Then, unlike ``guardrail-violation``, the loop **holds** rather than ending. A person who
chooses *Allow once* grants a one-time exception for the path and submits a ``resume``;
:meth:`~ouroboros_simulator.session.RunSession.await_resume` claims it, and the driver
reports the change-set again — the grant lifts exactly that path, so ``allowed_paths``
passes and the grant is spent — and walks on as ``happy-path`` does: ``implement``
succeeded, build, test, review, the gate, ``open-pr``. With no resume inside the session's
``max_pause``, it stops for a person as ``guardrail-violation`` does.

**Why ``boot/**``.** Every published version of the development seed's org policy (v1 to v7,
``R__dev_seed_workspace_settings.sql``) protects ``boot/**``; v2 adds ``keys/**`` and v3
``.github/**``. ``.github/**`` would be the wrong choice: ``.github/workflows/**`` is also
in the CI registry (``guardrails.ci.ts``), and ``implement``'s pinned ``touch_ci`` is false,
so it would fail ``ci_config`` as well — and an allow-once lifts ``allowed_paths`` only, so
the resumed report would still fail. ``boot/**`` is protected and nothing else, so
``allowed_paths`` is the **only** failing check: the change-set carries no secret, touches
no CI file, and the seeded ``#482`` has no estimate whose file list would narrow the scope.

**Why no boundary between the verdict and the hold.** The ``resume`` may be pending before
the driver next looks. A :meth:`~ouroboros_simulator.session.RunSession.checkpoint` — which
``work`` and a starting ``stage`` both reach — would claim it and acknowledge it as having
nothing to resume, and the hold would then wait for one that already came. So the script
says what happened, flushes, and calls ``await_resume`` straight away.
"""

from ouroboros_engine.control_plane.ingest import IngestFile
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

#: The protected path the change-set edits, under the org policy's ``boot/**``.
PROTECTED_PATH = "boot/can_bringup.c"

#: The org policy glob that protects it.
PROTECTED_GLOB = "boot/**"

#: The guardrail check a protected path fails — and the only one this change-set fails.
ALLOWED_PATHS = "allowed_paths"

#: The one-line boot edit: initialise the telemetry queue before CAN RX can fire.
BOOT_EDIT: list[tuple[str, str]] = [
    ("ctx", "\t/* CAN RX may interrupt as soon as the controller starts */"),
    ("add", "\ttelemetry_queue_init();"),
    ("ctx", "\tcan_start(can_dev);"),
]


def _change_set() -> list[IngestFile]:
    """The change-set ``implement`` reports — both times, unchanged.

    Returns:
        The telemetry buffer edit, its new test, and the one-line protected boot edit.
    """
    return [
        changed(
            "drivers/can/telemetry_buf.c", "modified", 38, 12, (40, TELEMETRY_EDIT)
        ),
        changed("tests/telemetry/test_frame_order.c", "added", 21, 0, (1, TEST_ADDED)),
        changed(PROTECTED_PATH, "modified", 1, 0, (57, BOOT_EDIT)),
    ]


def run(session: RunSession) -> Outcome:
    """Report a protected-path edit, hold for *Allow once*, and carry on to a merge.

    Args:
        session: The open run.

    Returns:
        ``completed`` once a resume arrived and the change-set passed on its second report;
        ``completed`` too if the control plane passed it the first time, which the caller
        reports as the failure it is. ``needs_human`` when no resume arrived within the
        session's ``max_pause``, or the resumed report was still refused.

    Raises:
        ScenarioAborted: If a person aborts the run while it holds.
    """
    prelude(session)

    session.stage("implement", "active")
    session.tool("read_file", "drivers/can/telemetry_buf.c")
    session.work(36)
    session.model(
        "The buffer fix alone leaves a window at boot: CAN RX is enabled before the telemetry "
        "queue exists. One line in boot/can_bringup.c initialises the queue first."
    )
    session.tool("edit_file", "drivers/can/telemetry_buf.c", diff(TELEMETRY_EDIT))
    session.tool("edit_file", PROTECTED_PATH, diff(BOOT_EDIT))
    session.work(38)

    verdict = session.files(_change_set())
    session.commit("b7e2c19", "can: init telemetry msgq before RX; frame seq numbers")
    session.spend(
        provider=PROVIDER,
        tokens_in=64000,
        tokens_out=18000,
        cost_cents="44.0000",
        task_kind="implement",
    )

    if verdict.needs_human:
        failed = ", ".join(verdict.guardrail_failures)
        session.system(
            f"Guardrails failed change-set {verdict.change_set_seq}: {failed}. "
            f"{PROTECTED_PATH} is a protected path ({PROTECTED_GLOB}). Holding implement for "
            "a person to allow a one-time edit, rather than stopping. Simulated run."
        )
        # No checkpoint between the verdict and the hold — see the module note.
        if not session.await_resume():
            session.system(
                "No one allowed the edit in time. Stopping this attempt for a person to "
                "review. Simulated run."
            )
            session.stage("implement", "failed")
            return "needs_human"

        again = session.files(_change_set())
        if again.needs_human:
            refused = ", ".join(again.guardrail_failures)
            session.system(
                f"Resumed, but guardrails still fail change-set {again.change_set_seq}: "
                f"{refused}. Stopping this attempt for a person to review. Simulated run."
            )
            session.stage("implement", "failed")
            return "needs_human"

        session.system(
            f"One-time edit to {PROTECTED_PATH} allowed: change-set {again.change_set_seq} "
            "passed its guardrails. Carrying on. Simulated run."
        )
    else:
        session.system("Guardrails passed this change-set. Simulated run.")

    session.tool(
        "run_tests", "twister -T tests/telemetry", {"result": "3 passed, 0 failed"}
    )
    session.stage("implement", "succeeded")

    delivery(session)
    return "completed"


SCENARIO = Scenario(
    name="protected-path-allow-once",
    summary="A one-line edit to protected boot/**: AP.3 fails allowed_paths, the loop holds "
    "for Allow once, resumes and runs on to a merge.",
    branch="loop/482-canbus-flake-allow-once",
    script=run,
)
