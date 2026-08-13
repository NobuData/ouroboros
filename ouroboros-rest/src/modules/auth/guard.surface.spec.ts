import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { API_BASE_PATH, createApplication } from "../../application";
import { grantSession, revokeGrantedSessions } from "../../auth/better-auth.fixture";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { HEALTH_PATH, LIVE_ROUTE } from "../health/health.paths";
import { AUTH_ERRORS } from "./auth.errors";
import { routeTable, SHIPPED_PUBLIC_SURFACE, type Route } from "./route.table.fixture";

/**
 * **The public surface, enumerated — as metadata.**
 *
 * [#703](https://github.com/NobuData/ouroboros/issues/703)'s second acceptance criterion is
 * the one that is not about a mechanism: *every route that `public.decorator.ts` exempted is
 * still exempt, and no route that wasn't became public — asserted by a test enumerating the
 * guard's decisions across the full route table, not by inspection.*
 *
 * The reason it is written that way is the shape of the change. Swapping the guard under a
 * service that is already authenticated is a change with two silent failure modes, and
 * neither is caught by any other test in this repository:
 *
 *   * **A route that was open closes.** The health probes stop answering, a container
 *     platform restarts a service that was perfectly healthy, and it does it to every
 *     replica.
 *   * **A route that was protected opens.** Nothing fails. The suite is green. The tenancy
 *     API answers strangers.
 *
 * So this file does not check three routes it happens to remember. It walks **every
 * controller the running application registered**, reads the exemption metadata off each
 * handler, and compares the whole set against `SHIPPED_PUBLIC_SURFACE` — which is that list,
 * in the issue's own words, with the argument for each entry beside it.
 *
 * The walk itself is `route.table.fixture.ts`, shared since
 * [#715](https://github.com/NobuData/ouroboros/issues/715) with
 * `guard.surface.integration-spec.ts` — which asks the same list what a stranger *actually
 * gets*, against a migrated database and over a socket. This suite starts nothing, so the
 * furthest it can follow a request is the pool; that one follows it to a status code, and
 * between them the claim is complete. See that fixture's header for where the line is drawn,
 * and for why BetterAuth's own routes are in neither.
 */

describe("the guard's decision for every route in the table", () => {
  let app: INestApplication;
  let routes: Route[];

  beforeAll(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
    routes = routeTable(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("finds the whole route table, not a corner of it", () => {
    // A walk that silently found nothing would make every assertion below vacuously true.
    // The number is a floor rather than an equality: a route added later must not have to
    // edit this line, only the exemption list — which is the one that matters.
    //
    // It was 20 until [#714](https://github.com/NobuData/ouroboros/issues/714), which
    // deleted this service's workspace and member operations in favour of the organization
    // plugin's. A floor that moves *down* has to be edited, and lowering it is the one
    // direction that deserves a second look: it means routes stopped existing.
    expect(routes.length).toBeGreaterThanOrEqual(16);
  });

  it("exempts exactly the surface #33 shipped, and nothing else", () => {
    // The acceptance criterion, in one assertion and in both directions: a route that lost
    // its exemption is a missing entry, and a route that gained one is an extra.
    const anonymous = routes.filter((route) => route.anonymous).map((route) => route.signature);

    expect(anonymous).toEqual(SHIPPED_PUBLIC_SURFACE);
  });

  it("requires a session on every other route", () => {
    const protectedRoutes = routes
      .filter((route) => !route.anonymous)
      .map((route) => route.signature);

    expect(protectedRoutes).not.toHaveLength(0);
    for (const signature of protectedRoutes) {
      expect(SHIPPED_PUBLIC_SURFACE).not.toContain(signature);
    }
  });
});

describe("the decisions, as answers rather than as metadata", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    revokeGrantedSessions();
  });

  const server = (): Server => app.getHttpServer() as Server;

  // Metadata is what the guard reads; a status code is what a caller gets. Both, because a
  // guard that read the right metadata and then let everybody through would satisfy the
  // enumeration above and nothing else.
  it.each([
    ["the heartbeat", "get", API_BASE_PATH],
    ["liveness", "get", `/${HEALTH_PATH}/${LIVE_ROUTE}`],
  ] as const)("answers %s without a session", async (_description, method, path) => {
    await request(server())[method](path).expect(200);
  });

  it("answers signing out without a session", async () => {
    await request(server()).post(`${API_BASE_PATH}/auth/logout`).expect(204);
  });

  it("lets domain discovery past without a session", async () => {
    // A `422` rather than a `200`, and that is the assertion rather than a compromise: this
    // suite starts no database, so the furthest an accepted request gets is the pool. What
    // is being proved is which layer refused it — a `401` would mean the guard, and a `422`
    // means the guard let it through and the *validation pipe* answered, which runs after.
    const response = await request(server())
      .post(`${API_BASE_PATH}/auth/discover`)
      .send({ domain: "" });

    expect(response.status).toBe(422);
  });

  it.each([
    ["the tenancy API", "get", `${API_BASE_PATH}/orgs`],
    ["the engine gateway", "get", `${API_BASE_PATH}/engine/status`],
  ] as const)("refuses %s without one, in the envelope", async (_description, method, path) => {
    const response = await request(server())[method](path).expect(401);

    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
    expect((response.body as ErrorEnvelope).details).toEqual({});
  });

  it("refuses before the validation pipe runs, so a stranger learns nothing about the shape", async () => {
    // A guard runs before a pipe. Without that ordering a malformed body would be a `422`
    // that told somebody with no session which fields exist.
    const response = await request(server())
      .post(`${API_BASE_PATH}/orgs/00000000-0000-4000-8000-000000000000/github-orgs`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ nonsense: true }));

    expect(response.status).toBe(401);
  });

  it("lets the same route past for somebody who is signed in", async () => {
    // The other direction, and the one a guard that simply refused everything would pass:
    // the exemptions are not what makes the API reachable, a session is.
    //
    // The assertion is *not 401* rather than *200*, and that is the honest claim this suite
    // can make. Every authenticated route in this service reads the database to answer, and
    // this one starts none — so past the guard is as far as a request gets, and it then
    // fails on a connection rather than on a session. `auth.integration-spec.ts` is where
    // the same request answers `200` against real rows.
    //
    // The workspace listing rather than `GET /api/v1/auth/me`, which was this assertion's
    // route until [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it as the
    // duplicate answer to *who is signed in*. Any authenticated route will do here — the
    // subject is the guard.
    const response = await request(server())
      .get(`${API_BASE_PATH}/orgs`)
      .set("Cookie", grantSession());

    expect(response.status).not.toBe(401);
  });
});
