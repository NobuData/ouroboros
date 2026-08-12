/**
 * Leg 4 — *the chain leg: the engine, reached through the REST gateway*.
 *
 * The only leg that crosses every process in the stack in one request: a caller on the
 * host asks `ouroboros-rest`, which opens a connection on the compose network to
 * `ouroboros-engine`, presents the shared secret, parses what comes back through a zod
 * schema, translates `snake_case` into this API's names, and answers. Four of those five
 * steps are invisible from outside and none of them is exercised by any module's own
 * suite, because each module's suite necessarily stubs the other side.
 *
 * ## Why `/api/v1/engine/status` and not the echo route
 *
 * The issue says *engine echo via the REST gateway*. The engine does publish
 * `POST /v0/tasks/echo`, and `EngineClient.echo()` calls it — but `ouroboros-rest` puts no
 * route in front of it: `GET /api/v1/engine/status` is the whole of the gateway's engine
 * surface. That is deliberate rather than an omission, and `engine.controller.ts` argues
 * it at length: the boundary in `docs/ARCHITECTURE.md` § 10 fails in practice by way of a
 * generic proxy, so the engine is exposed as named operations and there is currently one.
 *
 * Adding a second one to satisfy the wording of a test would be the test deciding the
 * shape of the public API, which is backwards. This leg therefore asserts the same chain
 * across the same boundary through the route that exists — and asserts, below, that the
 * boundary is still closed, which is the property the echo route's absence *is*.
 */

import { expect, test } from "@playwright/test";

import { asUser, describe, expectError, expectJson, getAnonymously, restUrl } from "../support/api";
import { SEED_OWNER } from "../support/seed";
import { mintSession, SESSION_PARKED } from "../support/session";

/** The `EngineStatus` resource, as `openapi.json` defines it. */
interface EngineStatus {
  engine: "up";
  version: string;
}

test.describe("the engine answers through the gateway", () => {
  // Three of these four legs carry a session and are parked — see `support/session.ts`.
  // "A stranger cannot ask" is not one of them and still runs, which is the assertion that
  // matters most about this route.
  test("a signed-in caller learns the engine is up and which build answered", async ({
    request,
  }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = await mintSession(SEED_OWNER.id);

    const response = await request.get(restUrl("/api/v1/engine/status"), {
      headers: asUser(token),
    });
    const status = await expectJson<EngineStatus>(response, 200);

    // There is no "down" body: every way the engine can fail to answer is a 502, so a
    // body that exists at all came from a reachable engine (`engine.resources.ts`).
    expect(status.engine).toBe("up");

    // The *engine's* version, not this service's — the two are released independently.
    // Asserting its shape rather than its value is what keeps this from being a test that
    // has to be edited on every engine release; asserting it is non-empty and version-like
    // is what keeps it from passing on `undefined`, which is what a contract drift at this
    // boundary would produce.
    expect(status.version, await describe(response)).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("the answer is narrower than what the engine reported", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = await mintSession(SEED_OWNER.id);

    const status = await expectJson<Record<string, unknown>>(
      await request.get(restUrl("/api/v1/engine/status"), { headers: asUser(token) }),
      200,
    );

    // `GET /v0/status` also carries the engine's uptime and its distribution name, and
    // neither is in this resource: uptime's only reader is an operator, who has the
    // engine's own logs. A field that started leaking through would be a translation
    // layer that had quietly become a proxy, which is the thing § 10 forbids.
    expect(Object.keys(status).sort()).toEqual(["engine", "version"]);
  });

  test("a stranger cannot ask", async ({ request }) => {
    // The engine's reachability is not much of a secret, but "this is the one route we
    // left open" is how a surface starts growing exceptions (#33). The route is
    // authenticated by the polarity `@Public()` establishes, and this is the assertion
    // that the polarity still holds in the built image.
    const response = await getAnonymously(request, "/api/v1/engine/status");

    await expectError(response, 401, "unauthenticated");
  });

  test("the gateway exposes no path-forwarding proxy", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = await mintSession(SEED_OWNER.id);
    const headers = asUser(token);

    // The invariant, asserted from outside: there is no route that takes a path, a method
    // and a body and hands them to an internal service. Each of these would be one.
    //
    // This is a negative assertion and it is the kind that rots silently — nothing else in
    // the suite would notice the day one of them starts answering, and on that day the UI
    // can reach the engine, which `docs/ARCHITECTURE.md` § 10's first invariant says it
    // never may.
    for (const path of [
      "/api/v1/engine/tasks/echo",
      "/api/v1/engine/echo",
      "/api/v1/engine/v0/status",
      "/api/v1/engine/proxy/v0/status",
    ]) {
      const response = await request.post(restUrl(path), {
        headers,
        data: { task_kind: "echo", payload: { probe: true } },
      });

      expect(
        response.status(),
        `${path} must not exist — see engine.controller.ts on named operations`,
      ).toBe(404);
    }
  });
});
