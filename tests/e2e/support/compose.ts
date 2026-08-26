/**
 * Stopping and starting one service of the stack, from inside a test
 * ([#233](https://github.com/NobuData/ouroboros/issues/233)).
 *
 * `scripts/verify-failure-modes.sh` already stops services — but it stops one *around* a
 * whole spec, to prove the spec can go red. This is the other thing, and only one leg needs
 * it: AE.7's `test-connection truth` asks that a provider go away **while the page is open**,
 * and that the card then say so. That is a state transition rather than a fixture, so it
 * cannot be arranged before the run.
 *
 * ## What is being stopped, and what is not
 *
 * `provider-stub` — `docker-compose.e2e.yml`'s fourth service, and the only one in the stack
 * whose absence is not a stack failure. Nothing depends on it: `rest` does not probe it, `ui`
 * does not know it exists, and the seeded connections point somewhere else entirely. Stopping
 * it is exactly *a provider went down*, which is the fact the leg is about.
 *
 * The three application services are deliberately out of reach here. Stopping `rest` strands
 * `ui` in a network namespace that no longer exists (`docker-compose.yml` explains the
 * arrangement, and `verify-failure-modes.sh` is where that conversation belongs), and a test
 * that could reach for `db` would be a test that could leave the suite unrunnable. The
 * signature therefore names no service: there is one thing this may stop.
 *
 * ## It runs `docker compose`, and that is a real coupling
 *
 * The suite is otherwise pure HTTP, and this is the one place it is not. The alternative — a
 * control route on the stub that makes it start refusing — was rejected because it changes
 * *what the failure is*: a stub answering `503` on request is classified `upstream` and draws
 * `degraded upstream`, while a container that is gone is `ECONNREFUSED`, classified `network`,
 * and draws `unreachable`. The second is the one a person means by *the provider went down*,
 * and it is the one that cannot be produced by asking the provider nicely.
 *
 * The coupling is the same one `scripts/run.sh` and both verify-* scripts already have — the
 * suite is run from a checkout, on a machine with the stack on it — and it fails loudly rather
 * than silently: a `docker` that is not there is an error naming the command, not a skip.
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The one service this module may stop — `docker-compose.e2e.yml`'s provider stub.
 *
 * Written here rather than passed in, for the reason the header gives: a parameter would be a
 * way to ask this to stop `db`.
 */
const STUB_SERVICE = "provider-stub";

/**
 * The repository root, from this file — `tests/e2e/support` is three levels down.
 *
 * `__dirname` rather than `import.meta.url`: this directory's `tsconfig.json` is `nodenext`
 * over a package with no `"type": "module"`, so these files are CommonJS and `import.meta` is
 * a compile error rather than a stylistic choice.
 */
const ROOT = resolve(__dirname, "../../..");

/**
 * The same pair of files `scripts/run.sh` composes, and the same profile.
 *
 * Recreating the stack from the base file alone would put `rest`'s production posture back and
 * re-park sign-in in the middle of a run, which is the note `verify-failure-modes.sh` carries
 * for its own invocation.
 */
const COMPOSE_ARGS = [
  "compose",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.e2e.yml",
  "--profile",
  "full",
];

/** How long a compose call may take before it is a failure rather than a slow machine. */
const COMPOSE_TIMEOUT_MS = 60_000;

/** How long the stub is given to become healthy again after a start. */
const HEALTHY_TIMEOUT_MS = 30_000;

/** How often its health is read while waiting. */
const HEALTHY_POLL_MS = 250;

/**
 * Run `docker compose …` at the repository root.
 *
 * @param args - What to pass after the composed file and profile flags.
 * @returns The command's standard output.
 * @throws {Error} With the command and everything it wrote, because the interesting failure
 *   here is *docker said something* and a bare exit code names none of it.
 */
async function compose(...args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await run("docker", [...COMPOSE_ARGS, ...args], {
      cwd: ROOT,
      timeout: COMPOSE_TIMEOUT_MS,
    });

    return stdout;
  } catch (reason) {
    throw new Error(
      `docker compose ${args.join(" ")} failed. This leg drives the compose stack directly ` +
        `(see support/compose.ts); it needs the stack this checkout brought up. ${String(reason)}`,
    );
  }
}

/**
 * Stop the provider stub, and do not come back until it is really gone.
 *
 * `compose stop` returns when the container has exited, so there is nothing to poll for on
 * this side: the next connection to it is refused by the network rather than by the process.
 *
 * @returns When the container has stopped.
 * @throws {Error} If the command failed — see {@link compose}.
 */
export async function stopProviderStub(): Promise<void> {
  await compose("stop", STUB_SERVICE);
}

/**
 * Start the provider stub again, and wait until compose reports it healthy.
 *
 * The wait is the load-bearing half. `compose start` returns when the container has been
 * asked to run, which is several hundred milliseconds before a socket accepts — and a leg that
 * carried on at that moment would press **Test connection** into the gap and read a refusal it
 * had itself created. The healthcheck is the stub's own (`/healthz`), so this waits on the
 * same definition of ready `--wait` uses for every other service.
 *
 * @returns When the container is healthy.
 * @throws {Error} If it did not become healthy inside {@link HEALTHY_TIMEOUT_MS}. That is a
 *   real finding rather than a timeout to swallow: the rest of the run assumes a provider.
 */
export async function startProviderStub(): Promise<void> {
  await compose("start", STUB_SERVICE);

  const deadline = Date.now() + HEALTHY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await stubIsHealthy()) return;

    await new Promise((resolve) => setTimeout(resolve, HEALTHY_POLL_MS));
  }

  throw new Error(
    `${STUB_SERVICE} did not become healthy within ${(HEALTHY_TIMEOUT_MS / 1000).toString()}s ` +
      "after being started; every leg after this one that connects a provider will fail.",
  );
}

/**
 * Whether compose currently reports the stub healthy.
 *
 * `ps --format json` prints one JSON object per line for the services it was asked about, so
 * the single line is parsed rather than the whole document. A container that is stopped prints
 * a line with no health at all, and a `docker` that answered something unparseable is *not
 * healthy* rather than an exception — the caller is in a poll loop and will say so itself when
 * the deadline passes, with a sentence about the stub rather than about JSON.
 *
 * @returns Whether it is healthy right now.
 */
async function stubIsHealthy(): Promise<boolean> {
  let line: string;

  try {
    line = (await compose("ps", "--format", "json", STUB_SERVICE)).trim();
  } catch {
    return false;
  }

  if (line === "") return false;

  try {
    const { Health, State } = JSON.parse(line.split("\n")[0]) as {
      Health?: string;
      State?: string;
    };

    return Health === "healthy" || (Health === "" && State === "running");
  } catch {
    return false;
  }
}
