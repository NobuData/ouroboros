import { API_BASE_PATH } from "../../application";
import { ApiHarness, ORGS, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AUTH_ERRORS } from "./auth.errors";
import { routeTable, SHIPPED_PUBLIC_SURFACE, type Route } from "./route.table.fixture";

/**
 * **The public surface, enumerated — as answers.**
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s last bullet: *guard coverage —
 * the route-table enumeration #703 introduces, run here against the real app.*
 *
 * `guard.surface.spec.ts` walks the same table and reads the exemption **metadata**. That is
 * the cheap half and it runs on save, and it is not the whole claim: a guard that read the
 * right metadata and then let everybody through would satisfy it completely. What it cannot
 * do is send a request, because it starts no database — every authenticated route in this
 * service reads one to answer, so the furthest a request gets there is the pool.
 *
 * This one sends the request. Every route the application registered, over a socket, against
 * a migrated PostgreSQL, in both directions:
 *
 *   * **With no session**, every protected route must answer `401` — and answer it in this
 *     service's envelope, because a stranger's experience of the boundary is the envelope
 *     rather than the status line.
 *   * **With a session**, every one of them must answer something else. Without that half,
 *     a guard that refused everything would pass the first.
 *   * **The five exempt routes** must answer without a session, which is the failure mode
 *     that takes a healthy service off the network: a probe behind authentication reports
 *     the service unhealthy the moment authentication is what is broken.
 *
 * The list is `SHIPPED_PUBLIC_SURFACE` and the walk is `route.table.fixture.ts`, shared with
 * the unit suite — one written-down specification, asked two different questions. A route
 * added later is in both without anybody adding a test to either.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/**
 * A value for each path parameter the tenancy routes take.
 *
 * They only have to be *well-formed*, never to exist. A guard runs before the validation pipe
 * and long before a handler, so a protected route refuses a stranger whatever these say — and
 * for a signed-in caller the assertion is only *not 401*, which a `404` satisfies.
 *
 * They are well-formed anyway, and deliberately: a `422` and a `401` are both "not 200", so a
 * malformed id would let the signed-in half pass for the wrong reason — the pipe refusing
 * rather than the guard admitting.
 */
const PARAMETERS: Readonly<Record<string, string>> = {
  // 32 characters, which is `ORGANIZATION_ID_PATTERN`'s other shape — see
  // `organizations.integration-spec.ts` for why this is not a uuid.
  orgId: "a".repeat(32),
  domainId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  login: "acme-robotics",
  name: "ouroboros",
  // `GET /api/v1/runs/:id` (#71). A well-formed uuid, so the guard's answer — not the
  // pipe's 422 — is what this suite observes.
  id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
};

/**
 * A route's path with every `:name` replaced by something a client could really have sent.
 *
 * @param path - The path as the router declares it.
 * @returns The path to request.
 * @throws {Error} When the route takes a parameter this file has no value for — which is a
 *   route added without this list being revisited, and is worth failing on rather than
 *   requesting `/api/v1/orgs/:newThing/…` and reading whatever comes back.
 */
function withParameters(path: string): string {
  return path.replaceAll(/:([^/]+)/g, (_match, parameter: string) => {
    const value = PARAMETERS[parameter];

    if (value === undefined) {
      throw new Error(
        `No test value for the path parameter :${parameter} in ${path}. Add one to ` +
          "PARAMETERS in guard.surface.integration-spec.ts.",
      );
    }

    return value;
  });
}

/** A body that will get past no validator, and is not meant to — see {@link PARAMETERS}. */
const NOTHING = {};

/** The verbs the harness can send, which every route in the table has to be one of. */
const SENDABLE: readonly Method[] = ["get", "post", "patch", "delete"];

describe("what the guard actually answers, for every route in the table", () => {
  let api: ApiHarness;
  let routes: Route[];
  let person: Person;

  beforeAll(async () => {
    api = await ApiHarness.start();
    routes = routeTable(api.nest);
    person = await api.signUp();
  });

  afterAll(() => api.close());

  // No `truncate` between tests. The person signed in above has to survive the whole file,
  // and nothing below writes a row it does not immediately forget: every request is either
  // refused before a handler runs or answered by a read.

  /**
   * Send one route's request.
   *
   * @param route - Which.
   * @param as - Whose browser, or `undefined` for a stranger.
   * @returns The response.
   */
  async function call(route: Route, as?: Person): Promise<{ status: number; body: unknown }> {
    const method = route.method.toLowerCase();

    if (!SENDABLE.includes(method as Method)) {
      // A verb the harness cannot send is a route this file would silently skip, and a
      // silently skipped route is exactly the hole the enumeration exists to close.
      throw new Error(
        `${route.signature} uses ${route.method}, which src/testing/harness.fixture.ts's ` +
          "`Method` does not cover. Widen it rather than leaving the route unasserted.",
      );
    }

    const path = withParameters(route.path);
    const send =
      as === undefined ? api.anonymous(method as Method, path) : api.as(as)(method as Method, path);

    return method === "get" || method === "delete" ? send : send.send(NOTHING);
  }

  it("walked the whole route table, not a corner of it", () => {
    // A walk that silently found nothing would make every assertion below vacuously true. The
    // floor is the one `guard.surface.spec.ts` carries, for the reason it gives there — a
    // number that has to move *down* is a route that stopped existing, and deserves a look.
    expect(routes.length).toBeGreaterThanOrEqual(16);
    expect(routes.filter((route) => route.anonymous)).not.toHaveLength(0);
    expect(routes.filter((route) => !route.anonymous)).not.toHaveLength(0);
  });

  it("agrees with the metadata the unit suite reads", () => {
    // The same assertion `guard.surface.spec.ts` makes, restated against an application built
    // over a real database. It is not redundant: this one is built by `createApplication` with
    // a pool that connects, and a module that only registers a controller when it can reach
    // the database would show up as a difference between the two lists.
    expect(routes.filter((route) => route.anonymous).map((route) => route.signature)).toEqual(
      SHIPPED_PUBLIC_SURFACE,
    );
  });

  describe("a browser with no session", () => {
    it("is refused by every route that is not on the list", async () => {
      // One test rather than `it.each`, because the useful failure names *which* routes let a
      // stranger through — a list, at once — rather than one red row per run.
      const admitted: string[] = [];

      for (const route of routes.filter((each) => !each.anonymous)) {
        const { status } = await call(route);

        if (status !== 401) {
          admitted.push(`${route.signature} → ${status}`);
        }
      }

      expect(admitted).toEqual([]);
    });

    it("is refused in this service's envelope, not the library's", async () => {
      // The boundary a stranger meets is `error.filter.ts`'s shape, and `details` is empty
      // because a request that was never authenticated has nothing to be told about its
      // fields. It is asserted on one route rather than on all of them: the envelope is the
      // filter's, and the filter is the same object for every route above.
      const response = await api.anonymous("get", ORGS).expect(401);

      expect(bodyOf<ErrorEnvelope>(response)).toEqual({
        code: AUTH_ERRORS.unauthenticated,
        message: expect.any(String) as string,
        details: {},
      });
    });

    it("is refused before the validation pipe, so it learns nothing about the shape", async () => {
      // A guard runs before a pipe. Without that ordering a malformed body would be a `422`
      // that told somebody with no session which fields exist.
      const response = await api
        .anonymous("post", `${ORGS}/${PARAMETERS.orgId}/github-orgs`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ nonsense: true }));

      expect(response.status).toBe(401);
    });

    it("is let through by every route that is on it", async () => {
      // The other failure mode, and the expensive one: a probe that closes takes every replica
      // off the network. `not 401` rather than `200`, because two of the five answer something
      // else on purpose — `/health/ready` is a `503` when a dependency is down, and
      // `POST /auth/discover` with no body is a `422` from the pipe that runs *after* the
      // guard, which is the assertion rather than a compromise.
      const refused: string[] = [];

      for (const route of routes.filter((each) => each.anonymous)) {
        const { status } = await call(route);

        if (status === 401) {
          refused.push(route.signature);
        }
      }

      expect(refused).toEqual([]);
    });
  });

  describe("a browser carrying a session", () => {
    it("is admitted by every protected route", async () => {
      // Without this the suite above would pass against a guard that refused everything, which
      // is the shape of every over-corrected authentication bug.
      //
      // `not 401` is the honest claim: what these routes then answer is a `404` for a
      // workspace that does not exist, a `422` for a body this test did not bother to compose,
      // or a `200` — and which one is the subject of the suites that own those routes, not of
      // this one. What matters here is that the guard is no longer the thing refusing.
      const refused: string[] = [];

      for (const route of routes.filter((each) => !each.anonymous)) {
        const { status } = await call(route, person);

        if (status === 401) {
          refused.push(route.signature);
        }
      }

      expect(refused).toEqual([]);
    });

    it("reaches a handler, and not merely the far side of the guard", async () => {
      // The end of the chain, spelled out once on a route that answers with rows: past the
      // authentication guard, past the tenant middleware, into a query and back through the
      // serialiser. Every `not 401` above is worth what this one assertion says it is worth.
      const response = await api.as(person)("get", ORGS).expect(200);

      expect(bodyOf<{ items: unknown[]; total: number }>(response).total).toBe(1);
    });
  });

  describe("the routes BetterAuth serves, which are in no table at all", () => {
    it("answers its own liveness without a session, from ahead of Nest's router", async () => {
      // `route.table.fixture.ts` says why these are absent from the enumeration: the library
      // registers one handler on the HTTP adapter, ahead of the router, so `/api/auth/*` never
      // reaches the table this file walks. That makes it worth one assertion here — the guard
      // is not what is answering, and the mount is real.
      await api.anonymous("get", "/api/auth/ok").expect(200);
    });

    it("refuses its session route nothing rather than answering null", async () => {
      // The library's own answer for a stranger is `200 null`, not `401`, and it has to be:
      // it is what the login screen calls on load to find out whether anybody is signed in.
      const response = await api.anonymous("get", "/api/auth/get-session").expect(200);

      expect(response.body).toBeNull();
    });

    it("answers the same route with a session, which is who is signed in", async () => {
      const response = await api.as(person)("get", "/api/auth/get-session").expect(200);

      expect(bodyOf<{ user: { id: string } }>(response).user.id).toBe(person.id);
    });
  });

  describe("the heartbeat, which is the one route with no dependency at all", () => {
    it("answers a stranger", async () => {
      await api.anonymous("get", API_BASE_PATH).expect(200);
    });
  });
});
