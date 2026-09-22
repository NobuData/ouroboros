"""``/dev/*``: launch scenarios on a development engine.

Mounted by :func:`mount`, which ``ouroboros_engine.main`` calls only when this package can
be imported (never in the production image, which does not contain it) **and**
``OURO_RUN_SIMULATOR_SECRET`` is set. It sits behind the engine's internal-key guard like
every other route but ``/healthz``. It is not in ``openapi.yaml``, because that document
describes the service that ships.

::

    GET  /dev/scenarios            the four scripts
    POST /dev/simulations          start one in the background → 202 {id, state: running}
    GET  /dev/simulations/{id}     where it is: the run id once open, the result once done

A simulation runs on a thread of its own, because the driver's transport is synchronous
and a scenario lasts minutes. At most :data:`MAX_RUNNING` run at once, so a looping test
cannot start an unbounded number of threads on a developer's machine.
"""

import logging
import secrets
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Annotated, Any, Literal

from fastapi import APIRouter, FastAPI, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ouroboros_engine.core.errors import envelope
from ouroboros_engine.settings import Settings
from ouroboros_simulator.runner import DEFAULT_SPEED, SimulationResult, run_scenario
from ouroboros_simulator.scenarios import SCENARIOS
from ouroboros_simulator.session import Target
from ouroboros_simulator.settings import SimulatorSettings, check_principal

_LOG = logging.getLogger("ouroboros_simulator.api")

#: Where the router is mounted. Outside ``/v0``, which is the versioned contract REST calls.
DEV_PREFIX = "/dev"

#: How many simulations may run at once.
MAX_RUNNING = 4

#: How many finished simulations are remembered for ``GET``.
MAX_REMEMBERED = 50


class _Body(BaseModel):
    """Closed and camel-case, like every other body this service accepts."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )


class TargetOverrides(_Body):
    """Fields of :class:`~ouroboros_simulator.session.Target` to override.

    Attributes:
        ticket_source: ``ticket_sources.id``.
        ticket: ``tickets.external_key``.
        repository: ``github_repos.id``.
        workflow: ``workflows.slug``.
        workflow_version: The version to pin.
        model: The run's model.
    """

    ticket_source: str | None = Field(default=None, max_length=64)
    ticket: str | None = Field(default=None, min_length=1, max_length=128)
    repository: str | None = Field(default=None, max_length=64)
    workflow: str | None = Field(default=None, min_length=1, max_length=64)
    workflow_version: int | None = Field(default=None, ge=1)
    model: str | None = Field(default=None, min_length=1, max_length=200)


class StartSimulation(_Body):
    """The body of ``POST /dev/simulations``.

    Attributes:
        scenario: One of the four names.
        speed: The time compression. 60 turns the flagship scenario into about 13 seconds.
        target: What to open the run for. The seeded ``#482`` when absent.
    """

    scenario: str
    speed: float = Field(default=DEFAULT_SPEED, gt=0, le=10_000)
    target: TargetOverrides | None = None


@dataclass
class _Simulation:
    """One simulation, as the registry holds it."""

    id: str
    scenario: str
    state: Literal["running", "finished"] = "running"
    run_id: str | None = None
    loop_seq: int | None = None
    result: SimulationResult | None = None
    done: threading.Event = field(default_factory=threading.Event)

    def as_json(self) -> dict[str, Any]:
        """The simulation in the endpoint's ``camelCase``.

        Returns:
            A JSON-ready dictionary.
        """
        return {
            "id": self.id,
            "scenario": self.scenario,
            "state": self.state,
            "runId": self.run_id,
            "loopSeq": self.loop_seq,
            "result": None if self.result is None else self.result.as_json(),
        }


class SimulationRegistry:
    """The simulations this process started, and the threads running them."""

    def __init__(self, settings: SimulatorSettings) -> None:
        """Make an empty registry.

        Args:
            settings: Where the control plane is, and the simulator's secret.
        """
        self._settings = settings
        self._lock = threading.Lock()
        self._simulations: dict[str, _Simulation] = {}

    def start(self, body: StartSimulation) -> _Simulation | None:
        """Start one simulation on its own thread.

        Args:
            body: The scenario, speed and target.

        Returns:
            The simulation, or ``None`` when :data:`MAX_RUNNING` are already running.
        """
        overrides = (
            {}
            if body.target is None
            else body.target.model_dump(exclude_none=True, by_alias=False)
        )
        target = Target(**overrides)

        with self._lock:
            running = [s for s in self._simulations.values() if s.state == "running"]
            if len(running) >= MAX_RUNNING:
                return None
            simulation = _Simulation(id=secrets.token_hex(8), scenario=body.scenario)
            self._simulations[simulation.id] = simulation
            self._forget_oldest()

        thread = threading.Thread(
            target=self._run,
            args=(simulation, target, body.speed),
            name=f"simulation-{simulation.id}",
            daemon=True,
        )
        thread.start()
        return simulation

    def get(self, simulation_id: str) -> _Simulation | None:
        """Look one simulation up.

        Args:
            simulation_id: Its id.

        Returns:
            The simulation, or ``None``.
        """
        with self._lock:
            return self._simulations.get(simulation_id)

    def _run(self, simulation: _Simulation, target: Target, speed: float) -> None:
        """Run a simulation to its end. The thread's body.

        Args:
            simulation: The registry's entry, updated as the run opens and ends.
            target: What to open the run for.
            speed: The time compression.
        """

        def opened(run: Any) -> None:
            simulation.run_id = run.id
            simulation.loop_seq = run.loop_seq

        try:
            result = run_scenario(
                simulation.scenario,
                self._settings,
                target=target,
                speed=speed,
                on_open=opened,
            )
        except Exception as error:  # a thread must report its failure, not vanish
            _LOG.exception("simulation %s crashed", simulation.id)
            result = SimulationResult(
                scenario=simulation.scenario,
                outcome="failed",
                run_id=simulation.run_id,
                loop_seq=simulation.loop_seq,
                detail=f"{type(error).__name__}: {error}",
            )

        with self._lock:
            simulation.result = result
            simulation.state = "finished"
        simulation.done.set()

    def _forget_oldest(self) -> None:
        """Drop the oldest finished simulations past :data:`MAX_REMEMBERED`. Lock held."""
        finished = [s for s in self._simulations.values() if s.state == "finished"]
        for stale in finished[: max(0, len(self._simulations) - MAX_REMEMBERED)]:
            del self._simulations[stale.id]


def build_router(registry: SimulationRegistry) -> APIRouter:
    """The ``/dev`` routes over one registry.

    Args:
        registry: Where simulations are started and looked up.

    Returns:
        The router.
    """
    router = APIRouter(prefix=DEV_PREFIX, tags=["dev"])

    @router.get("/scenarios")
    def list_scenarios() -> dict[str, list[dict[str, str]]]:
        """List the scenarios.

        Returns:
            Each scenario's name, summary and branch.
        """
        return {
            "scenarios": [
                {"name": s.name, "summary": s.summary, "branch": s.branch}
                for s in SCENARIOS.values()
            ]
        }

    @router.post("/simulations", status_code=HTTPStatus.ACCEPTED)
    def start_simulation(body: StartSimulation) -> Any:
        """Start a simulation in the background.

        Args:
            body: The scenario, speed and target.

        Returns:
            ``202`` with the simulation, ``404`` for an unknown scenario, ``429`` when too
            many are running.
        """
        if body.scenario not in SCENARIOS:
            return JSONResponse(
                envelope(
                    "scenario_not_found",
                    "No such scenario.",
                    {"scenario": body.scenario, "known": sorted(SCENARIOS)},
                ),
                status_code=HTTPStatus.NOT_FOUND,
            )

        simulation = registry.start(body)
        if simulation is None:
            return JSONResponse(
                envelope(
                    "too_many_simulations",
                    "Too many simulations are running. Wait for one to finish.",
                    {"limit": MAX_RUNNING},
                ),
                status_code=HTTPStatus.TOO_MANY_REQUESTS,
            )
        return simulation.as_json()

    @router.get("/simulations/{simulation_id}")
    def get_simulation(
        simulation_id: Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")],
    ) -> Any:
        """Say where a simulation is.

        Args:
            simulation_id: Its id.

        Returns:
            The simulation, or ``404``.
        """
        simulation = registry.get(simulation_id)
        if simulation is None:
            return JSONResponse(
                envelope("simulation_not_found", "No such simulation."),
                status_code=HTTPStatus.NOT_FOUND,
            )
        return simulation.as_json()

    return router


def mount(app: FastAPI, settings: Settings) -> bool:
    """Mount ``/dev`` on a development engine, when the simulator is configured.

    Args:
        app: The application ``ouroboros_engine.main.create_app`` built.
        settings: The engine's settings, which carry ``OURO_RUN_SIMULATOR_SECRET`` and
            ``OURO_REST_URL``.

    Returns:
        ``True`` when the router was mounted. ``False`` when no simulator secret is set,
        which is every deployment that runs no simulator.

    Raises:
        SimulatorConfigurationError: If the simulator secret equals the engine's. The
            engine refuses to start rather than serve a driver whose runs would not be
            marked simulated.
    """
    if settings.run_simulator_secret is None:
        return False

    simulator = SimulatorSettings(
        OURO_REST_URL=settings.rest_url,
        OURO_RUN_SIMULATOR_SECRET=settings.run_simulator_secret,
        OURO_ENGINE_SHARED_SECRET=settings.shared_secret,
    )
    check_principal(simulator)
    registry = SimulationRegistry(simulator)
    app.state.simulations = registry
    app.include_router(build_router(registry))
    _LOG.warning(
        "simulated-run driver mounted at %s/* — a development engine", DEV_PREFIX
    )
    return True
