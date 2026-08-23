/**
 * Where the stack answers, and how long this suite is allowed to take.
 *
 * Two addresses and nothing else, because two addresses is the whole of what a browser
 * and a script can reach. `ouroboros-engine` is deliberately absent: it publishes no port
 * (`docker-compose.yml`, and `docs/ARCHITECTURE.md` § 10's first invariant), so a constant
 * for it here would be a constant for an address that does not exist. The engine is
 * reached the only way anything outside the compose network can reach it — through
 * `ouroboros-rest` — which is what `specs/engine.spec.ts` asserts.
 *
 * Both are overridable, because the suite is run against two things that are the same
 * stack at different addresses: `docker compose --profile full up` on a laptop, and the
 * same compose file inside a GitHub Actions runner. Neither default is a guess — they are
 * the ports `docker-compose.yml` publishes and the README documents.
 */

/**
 * Read an address from the environment, falling back to what compose publishes.
 *
 * @param name - The variable to read.
 * @param fallback - The published address, from `docker-compose.yml`.
 * @returns The address, with any trailing slash removed so callers can concatenate a path
 *   without producing a double slash — which some routers treat as a different route.
 */
function address(name: string, fallback: string): string {
  const value = process.env[name];
  const chosen = value === undefined || value.trim() === "" ? fallback : value.trim();

  return chosen.endsWith("/") ? chosen.slice(0, -1) : chosen;
}

/** `ouroboros-ui` — the product UI, published on 3000. */
export const UI_URL = address("OURO_E2E_UI_URL", "http://localhost:3000");

/** `ouroboros-rest` — the communications layer, published on 4000. */
export const REST_URL = address("OURO_E2E_REST_URL", "http://localhost:4000");

/**
 * The suite's whole wall-clock budget, in milliseconds.
 *
 * Ten minutes, which is issue [#56](https://github.com/NobuData/ouroboros/issues/56)'s
 * third acceptance criterion written as a number the runner enforces rather than as a
 * sentence somebody measures. Playwright fails the run when it is exceeded, so the budget
 * cannot quietly rot as legs are amended in — and this suite is scheduled to gain a dozen
 * more legs, each with a stated budget of its own (see this file's directory README).
 *
 * It covers the tests only. Bringing the stack up is `scripts/run.sh`'s job and is timed
 * separately, because a cold `--build` is a Docker measurement rather than a test one.
 */
export const SUITE_BUDGET_MS = 10 * 60 * 1000;

/**
 * The readability matrix's own wall-clock budget, in milliseconds.
 *
 * Three minutes, which is issue
 * [#650](https://github.com/NobuData/ouroboros/issues/650)'s first acceptance criterion
 * written as a number `playwright.readability.config.ts` enforces. It is deliberately
 * *not* part of {@link SUITE_BUDGET_MS}: that leg runs under a config of its own, in its
 * own CI step, because one number covering two gates is a number the first gate to overrun
 * quietly borrows from the other.
 *
 * The matrix is sized to fit it rather than the other way round — three scales rather than
 * § 4's five, and the page set the issue chose. A page that does not fit is a page whose
 * screenshots have to be made cheaper.
 */
export const READABILITY_BUDGET_MS = 3 * 60 * 1000;

/** How long one test may take before it is failed. */
export const TEST_TIMEOUT_MS = 60 * 1000;

/** How long a single `expect` may retry before it gives up. */
export const EXPECT_TIMEOUT_MS = 15 * 1000;
