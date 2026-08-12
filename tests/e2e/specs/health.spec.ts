/**
 * Leg 5 — *health endpoints all ready*.
 *
 * The cheapest leg and the one that makes the other four legible. When this file is red,
 * every other failure in the run is downstream of it, and the report says so before
 * anybody opens a trace.
 *
 * It asserts the two probes `ouroboros-rest` publishes and, through the readiness body,
 * the two dependencies behind them — the database and the engine. The engine's own
 * `/healthz` is not called directly and cannot be: it publishes no port
 * (`docs/ARCHITECTURE.md` § 10). Readiness naming it is how a caller outside the compose
 * network learns the engine is up, which is exactly the boundary the architecture
 * describes.
 *
 * The distinction between the two probes is asserted rather than assumed, because it is
 * the whole of issue [#29](https://github.com/NobuData/ouroboros/issues/29) and it is
 * invisible while everything is healthy: liveness must depend on nothing, readiness must
 * name what it depends on. `scripts/verify-failure-modes.sh` is what proves the second
 * half — with the engine stopped, readiness turns 503 and liveness stays 200.
 */

import { expect, test } from "@playwright/test";

import { describe, expectJson, getAnonymously, restUrl } from "../support/api";
import { UI_URL } from "../support/stack";

/** Terminus's report shape, as both probes answer in it. */
interface HealthReport {
  status: string;
  info?: Record<string, { status: string }>;
  error?: Record<string, { status: string }>;
  details?: Record<string, { status: string }>;
}

test.describe("health", () => {
  test("liveness answers without touching a dependency", async ({ request }) => {
    const response = await getAnonymously(request, "/health/live");
    const report = await expectJson<HealthReport>(response, 200);

    expect(report.status).toBe("ok");

    // Shallow by contract: reaching the handler is the answer. A liveness probe that grew
    // an indicator would restart every replica of a healthy service the next time
    // PostgreSQL blinked, which is the failure mode #29 exists to prevent.
    expect(report.details ?? {}, "liveness must report no dependencies").toEqual({});
  });

  test("readiness names the database and the engine, and both are up", async ({ request }) => {
    const response = await getAnonymously(request, "/health/ready");
    const report = await expectJson<HealthReport>(response, 200);

    expect(report.status).toBe("ok");

    const details = report.details ?? {};

    // Both keys present, not just a green aggregate: a readiness probe that stopped
    // checking one of its dependencies would answer `ok` for ever, and the aggregate is
    // the one thing that cannot notice.
    expect(Object.keys(details).sort(), await describe(response)).toEqual(["database", "engine"]);
    expect(details.database?.status).toBe("up");
    expect(details.engine?.status).toBe("up");
  });

  test("both probes sit at the origin root, outside the versioned prefix", async ({ request }) => {
    // `health.paths.ts` calls this the load-bearing decision: a container's HEALTHCHECK
    // and a compose healthcheck are configured once and must survive the API gaining a
    // version. If these ever moved under /api/v1, four things would be wrong at once and
    // the stack would report unhealthy while the service was fine.
    const versioned = await getAnonymously(request, "/api/v1/health/live");

    expect(versioned.status(), await describe(versioned)).toBe(404);
  });

  test("the UI is serving", async ({ request }) => {
    // The UI's own image probes `/`, the route the application redirects from. Asserting
    // it here is what distinguishes "the UI container is unhealthy" from "the UI rendered
    // the wrong thing", which is the next leg's question.
    const response = await request.get(UI_URL, { maxRedirects: 0 });

    expect([200, 307, 308].includes(response.status()), await describe(response)).toBe(true);
  });

  test("the engine is not reachable from outside the compose network", async ({ request }) => {
    // A negative assertion, and the kind that rots silently: nothing else in the suite
    // would notice if `docker-compose.yml` grew a `ports:` entry for the engine, and the
    // day it does, `docs/ARCHITECTURE.md` § 10's first invariant is no longer true of the
    // deployment. The engine's port is 8000 (docs/CONVENTIONS.md § 4).
    const reachable = await request
      .get("http://localhost:8000/healthz", { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    expect(reachable, "the engine must publish no host port — see docker-compose.yml").toBe(false);
  });
});

test.describe("probes are open", () => {
  test("neither probe requires a session", async ({ request }) => {
    // Their reader is a container platform, which holds no session and could not be given
    // one (#33). A probe behind authentication reports the service unhealthy exactly when
    // authentication is what is broken — so this asserts the `@Public()` on the controller
    // is still there, from the only side that can see it.
    for (const path of ["/health/live", "/health/ready"]) {
      const response = await request.get(restUrl(path), { headers: { cookie: "" } });

      expect(response.status(), await describe(response)).toBe(200);
    }
  });
});
