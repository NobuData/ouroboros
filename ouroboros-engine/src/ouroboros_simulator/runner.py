"""Run one scenario end to end and say what happened. The CLI and the dev endpoint share it."""

import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.ingest import RunOpened
from ouroboros_simulator.clock import Clock
from ouroboros_simulator.scenarios import SCENARIOS
from ouroboros_simulator.session import (
    RunSession,
    ScenarioAborted,
    SimulationError,
    Target,
)
from ouroboros_simulator.settings import SimulatorSettings, check_principal
from ouroboros_simulator.transport import HttpTransport, Transport, TransportError

_LOG = logging.getLogger("ouroboros_simulator.runner")

#: The default compression: the flagship scenario's thirteen minutes in about eighty
#: seconds, which is slow enough to watch and fast enough to wait for.
DEFAULT_SPEED = 10.0

#: How a simulation ended. ``failed`` means the driver stopped on an error: a refusal, an
#: unreachable control plane, or a pause that outlasted its limit.
ResultOutcome = Literal["completed", "needs_human", "aborted", "failed"]


@dataclass(frozen=True)
class SimulationResult:
    """What one simulation did.

    Attributes:
        scenario: The scenario's name.
        outcome: How it ended.
        run_id: The run, or ``None`` when it never opened.
        loop_seq: Its *Loop #* number, or ``None``.
        simulated: The watermark the control plane echoed. ``True`` for every run this
            driver writes to.
        steers: Each steer applied, as ``{"attempt", "stage", "text"}``.
        acks: Each acknowledgment the control plane recorded, as
            ``{"kind", "detail"}``.
        guardrail_failures: The failed checks of each change-set, in report order.
        detail: Why it stopped, for ``aborted`` and ``failed``.
    """

    scenario: str
    outcome: ResultOutcome
    run_id: str | None = None
    loop_seq: int | None = None
    simulated: bool | None = None
    steers: list[dict[str, object]] = field(default_factory=list)
    acks: list[dict[str, object]] = field(default_factory=list)
    guardrail_failures: list[list[str]] = field(default_factory=list)
    detail: str | None = None

    def as_json(self) -> dict[str, object]:
        """The result in the dev endpoint's ``camelCase``.

        Returns:
            A JSON-ready dictionary.
        """
        return {
            "scenario": self.scenario,
            "outcome": self.outcome,
            "runId": self.run_id,
            "loopSeq": self.loop_seq,
            "simulated": self.simulated,
            "steers": self.steers,
            "acks": self.acks,
            "guardrailFailures": self.guardrail_failures,
            "detail": self.detail,
        }


def run_scenario(
    name: str,
    settings: SimulatorSettings,
    *,
    target: Target | None = None,
    speed: float = DEFAULT_SPEED,
    transport: Transport | None = None,
    clock: Clock | None = None,
    poll_interval: float = 0.5,
    max_pause: float = 600.0,
    on_open: Callable[[RunOpened], None] | None = None,
) -> SimulationResult:
    """Open a simulated run and play one scenario through it.

    Args:
        name: A key of :data:`~ouroboros_simulator.scenarios.SCENARIOS`.
        settings: Where the control plane is, and the simulator's secret.
        target: The ticket, repository and workflow. The seeded ``#482`` by default.
        speed: The time compression. See :class:`~ouroboros_simulator.clock.Clock`.
        transport: What sends requests. HTTP by default. Tests pass a fake.
        clock: The clock. A real one at ``speed`` by default.
        poll_interval: Real seconds between fetches while paused.
        max_pause: Real seconds a pause may last before the driver gives up.
        on_open: Called with the run as soon as it is open, before the scenario starts.
            The dev endpoint uses it to publish the run id early.

    Returns:
        The result. A refusal or an unreachable control plane is a ``failed`` result
        rather than an exception, because a long simulation that has already written half
        a run should say which run it was.

    Raises:
        KeyError: If no scenario has that name.
        SimulatorConfigurationError: If the simulator secret is the executor's.
    """
    scenario = SCENARIOS[name]
    check_principal(settings)

    session = RunSession(
        ControlPlaneClient(settings.rest_url, settings.simulator_secret),
        transport if transport is not None else HttpTransport(),
        clock if clock is not None else Clock(speed),
        key_prefix=f"sim-{scenario.name}-{secrets.token_hex(6)}",
        poll_interval=poll_interval,
        max_pause=max_pause,
    )

    outcome: ResultOutcome
    detail: str | None = None
    try:
        opened = session.open(
            target if target is not None else Target(), scenario.branch
        )
        if on_open is not None:
            on_open(opened)
        outcome = scenario.script(session)
        session.flush()
    except ScenarioAborted as aborted:
        outcome, detail = "aborted", str(aborted)
    except ControlPlaneError as refused:
        outcome = "failed"
        detail = f"{refused.code}: {refused} {refused.details}".strip()
    except (SimulationError, TransportError) as stopped:
        outcome, detail = "failed", str(stopped)

    run = session.run
    _LOG.info("scenario %s finished %s on run %s", name, outcome, run and run.id)
    return SimulationResult(
        scenario=name,
        outcome=outcome,
        run_id=run.id if run else None,
        loop_seq=run.loop_seq if run else None,
        simulated=run.simulated if run else None,
        steers=[
            {"stage": steer.stage_key, "attempt": steer.attempt, "text": steer.text}
            for steer in session.steers
        ],
        acks=[{"kind": ack.kind, "detail": ack.detail} for ack in session.acks],
        guardrail_failures=[
            list(done.guardrail_failures) for done in session.change_sets
        ],
        detail=detail,
    )
