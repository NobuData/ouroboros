# The run simulator — a test tool

The **run simulator** (`ouroboros-engine/src/ouroboros_simulator`, AP.5,
[#307](https://github.com/NobuData/ouroboros/issues/307)) plays scripted runs through the real
ingestion contract (AP.1, [#303](https://github.com/NobuData/ouroboros/issues/303)) so tests can
reach states a single live run cannot be made to reach on cue: a run that honours controls at a
known pace, a gate that fails and returns, a protected-path stop, a failing HIL bench. Every run it
opens is `origin = simulated` and carries the **Simulated** label and watermark (DJ.1, DJ.3).

It is **not a product feature** (DJ.4, [#1317](https://github.com/NobuData/ouroboros/issues/1317)).
Nothing a signed-in person reaches starts it, and a production deployment cannot run it by
accident.

## How it is kept out of the product

| Guard | Where | What it does |
| --- | --- | --- |
| Not in the wheel | `ouroboros-engine/pyproject.toml` (`packages = ["src/ouroboros_engine"]`), `tests/test_simulator_packaging.py` | The production wheel — what the image installs — has no `ouroboros_simulator`, no production module imports it, and no console script names it. |
| Not in the image | `.github/workflows/engine.yml` § *Assert the image has no run simulator* | CI builds the production engine image and fails if `ouroboros_simulator` is importable in it. |
| No `/dev` routes | `ouroboros_engine/main.py` `_mount_simulator` | The engine mounts the simulator's `/dev` routes only when its secret is set **and** the package is importable — never in the production image. |
| Production refuses its secret | `ouroboros-rest` configuration (`OURO_RUN_SIMULATOR_SECRET`, `OURO_RUN_SIMULATOR_IN_PRODUCTION`) | `NODE_ENV=production` with the simulator secret set fails the boot with a sentence saying why, unless `OURO_RUN_SIMULATOR_IN_PRODUCTION=true` says it is on purpose — then every start logs a warning. |
| Proven end to end | `tests/e2e/specs-production/simulator-unreachable.spec.ts` (leg 33) | On a production-mode stack, the simulator's routes exist on no origin, its secret opens nothing, and opening every page that starts or queues work leaves no simulated run. |

## Running it

- **The e2e suite** starts it on the host per leg (`tests/e2e/support/simulator.ts`), against the
  e2e stack's `OURO_RUN_SIMULATOR_SECRET`.
- **By hand**, from `ouroboros-engine/`: `uv run python -m ouroboros_simulator --list` lists the
  scenarios, and `--help` the speed, target and ticket options; it needs `OURO_RUN_SIMULATOR_SECRET` to match the
  REST it reports to, and REST must not be in production mode (see the table above).

## Inventory of callers

Every caller, its owner, and why it keeps the simulator. There are **no product callers**: the
Get Started launcher (#388) only queues the picked issue, and admission (#1312) starts a live run
when the loop capability report (#1300) allows it; otherwise the issue waits with its reason.

| Caller | Scenario(s) | Owner | Why it keeps the simulator |
| --- | --- | --- | --- |
| Engine contract tests — `ouroboros-engine/tests/test_simulator_*.py`, `test_control_plane_*`, `test_execution_guardrails.py`, `test_tasks_queue.py` | all eight | engine (AP.1 / AP.5) | The scenarios are AP.1's contract tests: each is a recorded conversation with the ingestion API. |
| REST fixtures — `test-plane/failing-hil.scenario.fixture.ts`, `slack.decisions.integration.fixture.ts`, `testing/engine.stub.fixture.ts`, `testing/chatops.bench.fixture.ts`, `lifecycle.fixture.ts` | failing-hil, protected-path-allow-once | ouroboros-rest | Replay a scenario's requests against the integration database — surfaces a live run cannot reach on cue (a failing HIL bench, a protected-path stop). |
| e2e `runs.spec.ts` (3 calls) | control-responsive | run console (#311–#314) | A run that honours pause, resume, take-over, steer and abort on demand, at a known pace. |
| e2e `run-console.spec.ts` (2 calls) | 482-gate-return, control-responsive | run console (#314) | A gate that fails and returns the run; a run still running when the abort lands. |
| e2e `inbox.spec.ts` (1 call) | protected-path-allow-once | inbox (#470) | A loop stopped on a protected path, on cue. |
| e2e `slack.spec.ts` (2 calls) | protected-path-allow-once | chat ops (#545) | The same stop, answered from Slack. |
| e2e `settings.spec.ts` (2 call sites) | protected-path-allow-once, happy-path | settings (#496) | A gate a published policy flips; stages a workspace pause must land between. |
| e2e `wizard.spec.ts` | — | onboarding (#395) | **Moved off** in #1317: the launched first loop is asserted to stay queued, never simulated. The walk to a terminal run is the live slice's (`live-slice-fixtures.spec.ts`, DI.5). |
| Docs screenshot harness | — | ouroboros-docs | **None.** Captures read seeded rows; `user-guide.run.live` is a live-origin run opened through AP.1 (`ouroboros-docs/screenshots/live-run.recipe.md`). |
| Demonstration scripts (`DEMONSTRATION_P*.md`) | — | — | **None exist** in this repository. |

The `first-loop` scenario now has no e2e caller; it stays as a contract test. Each e2e call above
carries a one-line `// Driver (DJ.4): …` comment saying why.
