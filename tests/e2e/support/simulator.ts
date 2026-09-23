/**
 * The simulated-run driver, started from the host
 * ([#310](https://github.com/NobuData/ouroboros/issues/310), over AP.5's driver,
 * [#307](https://github.com/NobuData/ouroboros/issues/307)).
 *
 * The run console leg needs a run that **really acknowledges** its controls, and the only
 * thing in the repository that does is `ouroboros_simulator` — the development-only driver
 * that reports a scripted run through `ouroboros-rest`'s internal contract and applies
 * pause, resume and abort at safe boundaries, exactly as an executor will (AR.1). It is not
 * in the engine image (the wheel packages `ouroboros_engine` only), so it runs where its own
 * README says it runs against compose: on the host, through `uv`, at `localhost:4000`.
 *
 * It presents {@link SIMULATOR_SECRET}, which `docker-compose.e2e.yml` gives `rest` as
 * `OURO_RUN_SIMULATOR_SECRET` — the same literal on both sides, because the e2e override is
 * never handed to a deployment and a value read from somebody's `.env` could disagree.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";

import { REST_URL } from "./stack";

/** The secret the e2e stack's `rest` accepts from the simulator. Literal in the override. */
export const SIMULATOR_SECRET = "e2e-run-simulator-secret";

/**
 * Where the engine's uv project is, from this file. `__dirname` for `support/compose.ts`'s
 * reason: these files are CommonJS.
 */
export const ENGINE_DIR = resolvePath(__dirname, "../../../ouroboros-engine");

/** How long the driver has to open its run before the leg gives up, in milliseconds. */
export const OPEN_TIMEOUT_MS = 60 * 1000;

/** The line the CLI prints on stderr once the run is open (`ouroboros_simulator/cli.py`). */
const OPENED = /opened simulated run ([0-9a-f-]{36}) \(Loop #(\d+), #(\d+)\)/;

/** A simulation in flight. */
export interface Simulation {
  /** The run it opened. */
  readonly runId: string;
  /** The run's loop number — what the abort dialog asks for. */
  readonly loopSeq: number;
  /** Resolves with the driver's stdout and exit code once the scenario has ended. */
  readonly finished: Promise<{ readonly code: number | null; readonly output: string }>;
  /** Stop the driver, if it is still running. */
  stop(): void;
}

/**
 * Start a scenario, and wait for the run it opens.
 *
 * @param scenario One of the driver's four scenario names.
 * @param speed The time compression. The driver's safe boundaries come every
 *   `STEP_SECONDS / speed` real seconds, which is how quickly a control lands.
 * @returns The simulation, once its run is open.
 * @throws {Error} If the driver exits, or does not open a run within {@link OPEN_TIMEOUT_MS},
 *   with everything it printed.
 */
export function startSimulation(scenario: string, speed: number): Promise<Simulation> {
  const child: ChildProcess = spawn(
    "uv",
    [
      "run",
      "--project",
      ENGINE_DIR,
      "python",
      "-m",
      "ouroboros_simulator",
      scenario,
      "--speed",
      String(speed),
    ],
    {
      cwd: ENGINE_DIR,
      env: {
        ...process.env,
        OURO_REST_URL: REST_URL,
        OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  const finished = new Promise<{ code: number | null; output: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, output: stdout }));
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the simulator opened no run within ${OPEN_TIMEOUT_MS}ms:\n${stderr}`));
    }, OPEN_TIMEOUT_MS);

    child.stderr?.on("data", () => {
      const match = OPENED.exec(stderr);
      if (match === null) return;

      clearTimeout(timer);
      resolve({
        runId: match[1],
        loopSeq: Number(match[2]),
        finished,
        stop: () => {
          if (child.exitCode === null) child.kill();
        },
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`the simulator could not be started (is uv installed?): ${error.message}`));
    });

    void finished.then(({ code }) => {
      clearTimeout(timer);
      reject(
        new Error(`the simulator exited (${code}) before opening a run:\n${stderr}\n${stdout}`),
      );
    });
  });
}
