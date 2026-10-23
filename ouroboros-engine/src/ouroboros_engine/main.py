"""Application factory and the module-scope instance uvicorn is pointed at.

Two entry points, one code path:

* ``create_app`` builds a fresh application, optionally from settings handed to it,
  which is what tests use to exercise a configuration without touching the environment.
* ``app`` is built at import from the process environment, and is what
  ``ouroboros_engine.main:app`` resolves to for uvicorn — in development through
  :mod:`ouroboros_engine.dev`, in a container (#53) through uvicorn directly.

Because ``app`` is built at import, a malformed environment stops the process while it
is still starting rather than on the first request. That is the fail-fast rule from
``docs/CONVENTIONS.md`` § 4 — and it now covers the API specification too, which is a
committed file this module loads rather than a document FastAPI derives from the routes
(:mod:`ouroboros_engine.openapi`).
"""

import asyncio
import importlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from ouroboros_engine.analysis.registry import default_registry
from ouroboros_engine.api import (
    analysis,
    code,
    copilot,
    dryruns,
    estimate,
    execution,
    health,
    investigate,
    learn,
    plan,
    root,
    skills,
    status,
    tasks,
    workflows,
)
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.ingest_client import IdempotencyKeys, IngestClient
from ouroboros_engine.control_plane.transport import HttpTransport
from ouroboros_engine.copilot.gateway import UrllibGateway
from ouroboros_engine.copilot.turn import CopilotTurnRunner
from ouroboros_engine.core.errors import register_error_handlers
from ouroboros_engine.core.logging import configure_logging
from ouroboros_engine.core.security import InternalKeyMiddleware
from ouroboros_engine.core.uptime import Uptime
from ouroboros_engine.dryrun.estimates import HttpReplayEstimates
from ouroboros_engine.dryrun.harness import DryRunHarness
from ouroboros_engine.dryrun.model import GatewayStageCaller
from ouroboros_engine.estimation.heuristic import HeuristicEstimator
from ouroboros_engine.estimation.model import (
    ESTIMATE_GATEWAY_TIMEOUT_SECONDS,
    GatewaySizingCaller,
    ModelEstimator,
)
from ouroboros_engine.execution.compose import register_executors
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.publisher import (
    CommitIdentity,
    DulwichPushTransport,
    Publisher,
)
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.worker import ExecutionWorker
from ouroboros_engine.execution.workspace import RunWorkspaces
from ouroboros_engine.investigation.control import HttpInvestigationControl
from ouroboros_engine.investigation.loop import InvestigationLoop
from ouroboros_engine.investigation.model import GatewayModelCaller
from ouroboros_engine.investigation.runner import InvestigationRunner
from ouroboros_engine.learning.extractor import UnavailableExtractor
from ouroboros_engine.openapi import document
from ouroboros_engine.planning.outline_planner import OutlinePlanner
from ouroboros_engine.settings import Settings, load_settings
from ouroboros_engine.skills.runner import SkillRunner
from ouroboros_engine.tasks.queue import TaskQueue
from ouroboros_engine.tasks.registry import default_registry as default_task_registry

#: The paths served without the internal key. Liveness only, and it is the route module
#: that says so — see :mod:`ouroboros_engine.api.health`. The OpenAPI document is
#: deliberately not in here: it is a map of the internal surface, and a misrouted port
#: should not hand one out. ``openapi.yaml`` says the same thing in its own terms — every
#: operation but this one carries the ``InternalKey`` requirement — and
#: ``tests/test_openapi.py`` asserts the two agree.
_PUBLIC_PATHS = (health.HEALTH_PATH,)

_log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the task worker pool for as long as the application serves.

    Reads ``app.state.tasks`` at startup and again at shutdown, so a queue a test installs
    in place of the default is the one stopped. On shutdown running tasks are cancelled and
    every record is dropped with the process — see :mod:`ouroboros_engine.tasks.queue`.

    At startup the run working trees (DI.1, #1307) are swept once — trees whose run ended,
    half-made ones and idle ones — so a restart reclaims what a dead engine left behind. A
    sweep that fails is logged and the engine still starts.

    Args:
        app: The application.

    Yields:
        Nothing; the application serves while suspended here.
    """
    workspaces: RunWorkspaces = app.state.run_workspaces
    try:
        swept = await asyncio.to_thread(workspaces.sweep)
        _log.info(
            "run workspaces swept: %d terminal, %d orphaned, %d idle",
            len(swept.terminal),
            len(swept.orphaned),
            len(swept.idle),
        )
    except OSError:
        _log.exception("run workspace sweep failed at startup")
    await app.state.tasks.start()
    try:
        yield
    finally:
        tasks: TaskQueue = app.state.tasks
        await tasks.stop()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application.

    Args:
        settings: Configuration to run with. Omitted, the environment is read and
            validated by :func:`ouroboros_engine.settings.load_settings`.

    Returns:
        A configured :class:`fastapi.FastAPI` whose ``state.settings`` holds the
        settings it was built with, so a route or a middleware can reach them without
        re-reading the environment, whose ``state.uptime`` is the stopwatch
        ``/v0/status`` reports from, whose ``state.estimator`` is the
        :class:`~ouroboros_engine.estimation.heuristic.HeuristicEstimator`
        ``POST /v0/estimate`` calls, whose ``state.planner`` is the
        :class:`~ouroboros_engine.planning.outline_planner.OutlinePlanner`
        ``POST /v0/plan`` calls, and whose ``state.extractor`` is the
        :class:`~ouroboros_engine.learning.extractor.UnavailableExtractor`
        ``POST /v0/learn`` calls.

    Raises:
        ouroboros_engine.settings.SettingsError: If ``settings`` was omitted and the
            environment is missing or malformed — which now includes
            ``OURO_ENGINE_SHARED_SECRET`` being unset, because without it every route
            but liveness would be unreachable.
        ouroboros_engine.openapi.SpecificationError: If the committed API specification
            is missing or malformed. It is what this application serves at
            ``/openapi.json``, so an image built without it is broken at build time
            rather than at the first request for the document.
    """
    resolved = load_settings() if settings is None else settings
    configure_logging(resolved.log_level)

    # The specification is the source, and the application is described by it rather
    # than the other way around: title, version and description are read off the
    # document instead of being written a second time here, where they could disagree
    # with it.
    specification = document()
    info = specification["info"]

    app = FastAPI(
        title=info["title"],
        description=info["description"],
        version=info["version"],
        lifespan=_lifespan,
    )

    def committed_document() -> dict:
        """Answer with the specification instead of one derived from the routes.

        Returns:
            The document :func:`ouroboros_engine.openapi.document` loaded, which is what
            ``/openapi.json`` and ``/docs`` serve.
        """
        return specification

    # Replacing the method rather than filling in `app.openapi_schema`: FastAPI caches a
    # generated document there but re-generates it whenever the route set changes, so a
    # schema assigned here would not survive the `include_router` calls below. Overriding
    # the producer leaves nothing that can regenerate — what a caller gets is the
    # committed file, unchanged, and no route can quietly rewrite the contract by
    # acquiring a docstring. What keeps the code honest to the document is the test suite
    # (tests/test_openapi.py), not the framework.
    app.openapi = committed_document

    app.state.settings = resolved
    app.state.uptime = Uptime()

    # Which estimator answers `POST /v0/estimate` is a property of the application rather
    # than of the route, and a test installs its own by assigning to the same attribute.
    # `ModelEstimator` (#123) sizes on the model the request names — the workspace's
    # `estimate` route, or its Ollama connection and `llama3.1:8b` — through the invocation
    # gateway, with L.2's `HeuristicEstimator` (`heuristic-v0`) behind it whenever there is no
    # model or the model cannot answer. See `ouroboros_engine.estimation.model`.
    app.state.estimator = ModelEstimator(
        GatewaySizingCaller(
            ControlPlaneClient(resolved.rest_url, resolved.shared_secret),
            UrllibGateway(timeout=ESTIMATE_GATEWAY_TIMEOUT_SECONDS),
        ),
        HeuristicEstimator(),
    )

    # And which planner answers `POST /v0/plan`, for the same reason and by the same rule.
    # `OutlinePlanner` is AL.1's deterministic parser: provenance `outline-v0` in every
    # batch, and one draft plus a note when it was given a narrative and no outline. AN.1
    # (#289) is the LLM planner that answers the same contract once the invocation gateway
    # exists, and installing it is this line. See `ouroboros_engine.planning`.
    app.state.planner = OutlinePlanner()

    # And which extractor answers `POST /v0/learn` (BF.3, #412), by the same rule.
    # `UnavailableExtractor` extracts nothing and says so — the deterministic proposers run in
    # ouroboros-rest and need no model. BH.1 (#423) is the LLM extractor that answers the same
    # contract, and installing it is this line. See `ouroboros_engine.learning`.
    app.state.extractor = UnavailableExtractor()

    # And which analyzers `/v0/analysis` runs (BV.1, #510): the built-ins plus anything
    # installed under the `ouroboros_engine.analyzers` entry-point group, checked against the
    # parameter ledger here — so an analyzer that breaks the SPI stops the process at start-up
    # rather than vanishing from every run. A test installs its own registry the same way.
    app.state.analyzer_registry = default_registry()

    # The code & git mining tool's clone cache (CL.4, #617): bare clones under
    # `OURO_ENGINE_CLONE_DIR`, fetched with the token each call carries and never stores.
    # Nothing is created until a clone is first asked for. A test installs its own.
    app.state.code_clones = CloneStore(
        resolved.clone_dir,
        refresh_seconds=resolved.clone_refresh_seconds,
        timeout_seconds=resolved.clone_timeout_seconds,
    )
    # Each run's writable working tree (DI.1, #1307), under `OURO_ENGINE_RUN_DIR`, borrowing
    # objects from those clones. The stage interpreter opens one per run; the lifespan above
    # sweeps the leftovers once at startup. A test installs its own.
    app.state.run_workspaces = RunWorkspaces(
        resolved.run_dir,
        app.state.code_clones,
        max_bytes=resolved.run_max_mb * 1024 * 1024,
        idle_seconds=resolved.run_idle_hours * 3600.0,
    )

    # The execution bridge (#160): the stage executors this process can run, and the worker
    # that turns the supervisor's calls into interpreter runs over `ouroboros-rest`'s internal
    # run surface. The composition root (DH.3, #1308) registers the Claude Agent executor
    # (`harness`) when the CLI bundled with the SDK wheel is installed; without it the registry
    # is empty, `/v0/status` reports `executors: []` and nothing is claimed or executed. A test
    # installs its own registry or worker the same way.
    app.state.executors = ExecutorRegistry()
    ingest = IngestClient(
        ControlPlaneClient(resolved.rest_url, resolved.shared_secret),
        HttpTransport(),
        IdempotencyKeys("".join(resolved.engine_worker_id.split())[:64] or "engine"),
    )
    register_executors(
        app.state.executors, rest_url=resolved.rest_url, credentials=ingest
    )
    app.state.execution = ExecutionWorker(
        ingest,
        app.state.executors,
        Interpreter(
            ingest,
            app.state.code_clones,
            app.state.run_workspaces,
            app.state.executors,
            worker=resolved.engine_worker_id,
            heartbeat_seconds=resolved.engine_heartbeat_seconds,
            # The branch publisher (DI.2, #1310): attributed commits under the configured
            # identity, one fast-forward push of the run branch with the credential
            # `ouroboros-rest` hands over for that one call.
            publisher=Publisher(
                CommitIdentity(
                    name=resolved.commit_author_name,
                    email=resolved.commit_author_email,
                ),
                DulwichPushTransport(timeout_seconds=resolved.clone_timeout_seconds),
            ),
        ).execute,
        worker=resolved.engine_worker_id,
    )
    # And the Workflow Copilot's turn runner (CD.1, #559): the control-plane client built
    # against `OURO_REST_URL` with this service's own internal key — the one principal
    # `ouroboros-rest`'s internal surface accepts from the executor — and the standard-library
    # gateway that puts an invocation on a socket. Until AF.2 (#235) lands the gateway answers
    # `501`, which a turn reports as `gateway_unavailable` rather than hiding. A test installs
    # a runner over a fake gateway the same way.
    app.state.copilot = CopilotTurnRunner(
        ControlPlaneClient(resolved.rest_url, resolved.shared_secret), UrllibGateway()
    )

    # The investigation loop (CM.1, #620) and the threads it runs on. Everything durable —
    # the lifecycle row, the citation ledger, the checkpoint — is `ouroboros-rest`'s, reached
    # over its internal research surface with the same key; models are called through the
    # same gateway the copilot uses, so until AF.2 (#235) lands an investigation ends as
    # `failed: synthesis_failure` naming the gateway rather than pretending. Nothing starts
    # until `POST /v0/investigate` is called. A test installs a runner over fakes.
    app.state.investigations = InvestigationRunner(
        InvestigationLoop(
            HttpInvestigationControl(resolved.rest_url, resolved.shared_secret),
            GatewayModelCaller(
                ControlPlaneClient(resolved.rest_url, resolved.shared_secret),
                UrllibGateway(),
            ),
        )
    )

    # The deep dry-run harness (CD.2, #560): model stages go through the same gateway — so
    # until AF.2 (#235) lands a dry run ends `failed`, naming the gateway — infrastructure
    # stages ask `ouroboros-rest`'s replay estimator, and reads resolve from the git host at
    # the pinned commit with the token each request carries. Nothing is written anywhere.
    # Nothing starts until `POST /v0/dry-runs` is called. A test installs a harness over fakes.
    app.state.dry_runs = DryRunHarness(
        GatewayStageCaller(
            ControlPlaneClient(resolved.rest_url, resolved.shared_secret),
            UrllibGateway(),
        ),
        HttpReplayEstimates(resolved.rest_url, resolved.shared_secret),
    )

    # Skill execution (CM.5, #624): a registry skill's body followed over an input — the
    # roadmap pipeline's `create-roadmap` and `create-issues`. Through the same gateway, so
    # until AF.2 (#235) lands a run answers `502 skill_model_failed` naming the gateway.
    # A test installs a runner over a scripted model.
    app.state.skills = SkillRunner(
        GatewayStageCaller(
            ControlPlaneClient(resolved.rest_url, resolved.shared_secret),
            UrllibGateway(),
        )
    )

    # The task queue (#54): an in-process asyncio queue and worker pool behind
    # `/v0/tasks`. Its workers start with the lifespan above and nothing it holds survives
    # the process; `ouroboros-rest` resubmits what a restart lost.
    app.state.tasks = TaskQueue(default_task_registry())

    # Added before any route is registered, and the only middleware there is, so it is
    # the outermost thing a request meets: the guard cannot be bypassed by a path that
    # is added later, and an unauthenticated request never reaches routing at all.
    app.add_middleware(
        InternalKeyMiddleware,
        secret=resolved.shared_secret,
        public_paths=_PUBLIC_PATHS,
    )

    # Every failure answers in one shape, including the ones no route produced: a body
    # pydantic refused, a path no router claims, an exception nobody expected. See
    # `ouroboros_engine.core.errors` — the envelope is the same one ouroboros-rest sends,
    # so a failure crossing the gateway does not change form on the way out.
    register_error_handlers(app)

    app.include_router(health.router)
    app.include_router(root.router)
    app.include_router(status.router)
    app.include_router(tasks.router)
    app.include_router(estimate.router)
    app.include_router(workflows.router)
    app.include_router(plan.router)
    app.include_router(learn.router)
    app.include_router(analysis.router)
    app.include_router(code.router)
    app.include_router(copilot.router)
    app.include_router(dryruns.router)
    app.include_router(investigate.router)
    app.include_router(skills.router)
    app.include_router(execution.router)
    _mount_simulator(app, resolved)
    return app


#: The development-only package that holds the run simulator (AP.5, #307). It is
#: named here as a string and imported only when asked for, so this module does not depend
#: on it, and the production wheel, which does not contain it, still builds and runs.
SIMULATOR_PACKAGE = "ouroboros_simulator"


def _mount_simulator(app: FastAPI, settings: Settings) -> bool:
    """Mount the run simulator's ``/dev`` routes on a development engine.

    Two conditions, and the second is the one that keeps it out of production: the
    simulator secret is set, **and** the driver's package is importable. The production
    image installs the wheel, which does not contain the package
    (``tests/test_simulator_packaging.py`` builds one and checks), so there the import
    fails and nothing is mounted, whatever the environment says.

    Args:
        app: The application being built.
        settings: Its settings.

    Returns:
        Whether ``/dev`` was mounted.

    Raises:
        ModuleNotFoundError: If the driver's package is present but something *it*
            imports is missing. That is a broken development install, not a production
            one, and hiding it would make ``/dev`` disappear for no stated reason.
    """
    if settings.run_simulator_secret is None:
        return False

    try:
        api = importlib.import_module(f"{SIMULATOR_PACKAGE}.api")
    except ModuleNotFoundError as missing:
        if missing.name != SIMULATOR_PACKAGE:
            raise
        logging.getLogger(__name__).info(
            "OURO_RUN_SIMULATOR_SECRET is set, but this build does not carry the "
            "run simulator; /dev is not mounted"
        )
        return False

    return api.mount(app, settings)


#: The instance uvicorn serves. Built at import — see the module docstring.
app = create_app()
