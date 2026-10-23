/**
 * Nothing a signed-in person reaches starts the run simulator on a production deployment (DJ.4,
 * [#1317](https://github.com/NobuData/ouroboros/issues/1317)).
 *
 * The stack is `scripts/run.sh --production`'s: `rest` in production mode, no run-simulator
 * secret, the production engine image. The leg mints an owner's session in the database (see
 * `support/mint-session.ts` on why) and tries every way in:
 *
 *   * the simulator's own routes, on every origin a person can address — the UI, the API, and
 *     the engine's published port when there is one — must not exist;
 *   * the ingestion contract presented with the development stacks' simulator secret must be
 *     refused, because a production deployment holds no such principal;
 *   * every page that starts or queues work is opened, and afterwards the workspace holds no
 *     simulated run of any kind.
 *
 * Run with `yarn production` against `scripts/run.sh --production`'s stack.
 */

import { expect, test } from "@playwright/test";

import { mintProductionSession } from "../support/mint-session";
import { SESSION_COOKIE } from "../support/session";
import { REST_URL, UI_URL } from "../support/stack";

/** The secret the development and e2e stacks give the simulator (docker-compose.e2e.yml). */
const DEVELOPMENT_SIMULATOR_SECRET = "e2e-run-simulator-secret";

/** The simulator's routes (`ouroboros_simulator/api.py`), as anyone might try them. */
const SIMULATOR_ROUTES = [
  { method: "GET", path: "/dev/scenarios" },
  { method: "POST", path: "/dev/simulations" },
  { method: "GET", path: "/api/v1/dev/scenarios" },
  { method: "POST", path: "/api/v1/dev/simulations" },
] as const;

/** The pages a person starts or queues work from. */
const LAUNCH_PAGES = ["/get-started", "/dashboard", "/issues", "/workflows", "/insights"] as const;

test.describe("a production deployment", () => {
  test("offers no way to start the run simulator, and holds no simulated run", async ({
    context,
    page,
  }) => {
    const session = await mintProductionSession("production");
    const cookie = `${SESSION_COOKIE}=${session.cookieValue}`;

    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: session.cookieValue,
        domain: new URL(UI_URL).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    // The simulator's routes exist on no origin a person can address.
    for (const origin of [UI_URL, REST_URL]) {
      for (const route of SIMULATOR_ROUTES) {
        const response = await fetch(`${origin}${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/json", cookie },
          body: route.method === "POST" ? JSON.stringify({ scenario: "happy-path" }) : undefined,
        });

        expect(
          [401, 403, 404, 405],
          `${route.method} ${origin}${route.path} answered ${String(response.status)}`,
        ).toContain(response.status);
      }
    }

    // The ingestion contract refuses the simulator's principal: production holds no such secret.
    const ingest = await fetch(`${REST_URL}/internal/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ouro-internal-key": DEVELOPMENT_SIMULATOR_SECRET,
      },
      body: JSON.stringify({}),
    });

    expect(ingest.status, "the simulator's secret must open nothing").toBe(401);

    // Every page that starts or queues work, opened as the owner — none of them opens a run.
    for (const path of LAUNCH_PAGES) {
      const response = await page.goto(path);

      expect(response?.status(), `${path} must render for the owner`).toBeLessThan(500);
    }

    for (const family of ["active", "terminal"] as const) {
      const response = await fetch(`${REST_URL}/api/v1/runs?status=${family}&origin=simulated`, {
        headers: { cookie },
      });

      expect(response.status, `the ${family} runs must be readable`).toBe(200);
      expect((await response.json()) as { items: unknown[] }).toMatchObject({ items: [] });
    }
  });
});
