import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import request from "supertest";

import { API_BASE_PATH, createApplication } from "../../application";
import { grantSession, revokeGrantedSessions } from "../../auth/better-auth.fixture";
import { ALLOW_ANONYMOUS } from "./anonymous";
import { AUTH_ERRORS } from "./auth.errors";
import { testConfiguration } from "../config/configuration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { LIVE_ROUTE, READY_ROUTE, HEALTH_PATH } from "../health/health.paths";

/**
 * **The public surface, enumerated.**
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
 * handler, and compares the whole set against a list written down below — which is #33's
 * shipped surface, transcribed once. A route added later is in the enumeration whether or
 * not anybody thought to add a test, and a route that quietly gains `@AllowAnonymous()`
 * fails here by name.
 *
 * ## What the list is, and what it deliberately is not
 *
 * {@link SHIPPED_PUBLIC_SURFACE} is the spec, in the issue's own words. It holds four
 * entries because #33 shipped four `@Public()` decisions — the heartbeat, the two probes,
 * and signing out — and the two decorators that expressed them (`@Public()` on a class
 * covering both probes) are flattened into the routes they actually exempted, because
 * "which routes answer a stranger" is the question and a decorator's placement is not.
 *
 * Three surfaces are *not* in it and are not omissions:
 *
 *   * **Swagger UI and the two specification routes.** They are registered on the HTTP
 *     adapter rather than declared by a controller, so no guard sees them at all — the same
 *     reason they are absent from `openapi.yaml`. `application.spec.ts` is where they are
 *     asserted to answer.
 *   * **BetterAuth's own routes under `/api/auth`.** The library mounts a handler ahead of
 *     Nest's router, so those never reach the routing table this walks. `auth.routes.ts` is
 *     their map and `application.spec.ts` asserts they answer.
 *   * **[#712](https://github.com/NobuData/ouroboros/issues/712)'s discovery endpoint**,
 *     which the issue lists among the exempt paths and which does not exist yet. When it
 *     lands it adds one line here, and until it does a line for it would be a promise about
 *     a route nothing serves.
 */

/**
 * The routes #33 shipped as reachable without a session.
 *
 * Written as `METHOD path` exactly as {@link routeTable} renders one, so the comparison is
 * between two lists of the same strings rather than between a list and a rule.
 */
const SHIPPED_PUBLIC_SURFACE: readonly string[] = [
  // The heartbeat. It says which build is answering and nothing else, and whatever polls it
  // holds no session.
  `GET ${API_BASE_PATH}`,
  // The two probes. Their reader is a container platform, which holds no session and could
  // not be given one — and a probe behind authentication reports the service unhealthy the
  // moment authentication is what is broken.
  `GET /${HEALTH_PATH}/${LIVE_ROUTE}`,
  `GET /${HEALTH_PATH}/${READY_ROUTE}`,
  // Signing out, which is disposing of a session that may already have expired: requiring
  // one would mean an expired cookie could never be cleared.
  `POST ${API_BASE_PATH}/auth/logout`,
].sort();

/** One route, as the enumeration sees it. */
interface Route {
  /** `METHOD path`, from the origin root. */
  readonly signature: string;
  /** Whether the guard would let a request with no session through. */
  readonly anonymous: boolean;
}

/** Nest's numeric `RequestMethod`, as a verb. Indexed by the enum's own values. */
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD", "SEARCH"];

/**
 * Every route the application registered, with the guard's decision for each.
 *
 * `DiscoveryService` is asked for the controllers rather than a list being imported,
 * because an imported list is a list somebody has to remember to add to — which is the
 * failure this whole file exists to catch. `MetadataScanner` then walks each controller's
 * prototype for handlers, and the two path halves are read from the same metadata keys
 * Nest's own router reads.
 *
 * @param app - The initialised application.
 * @returns One entry per handler, sorted by signature.
 */
function routeTable(app: INestApplication): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: Route[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;

    if (controller === undefined || controller === null) {
      continue;
    }

    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");

    for (const name of scanner.getAllMethodNames(controller.prototype as object)) {
      const handler = (controller.prototype as Record<string, () => unknown>)[name];
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;

      if (method === undefined) {
        continue;
      }

      routes.push({
        signature: `${METHODS[method]} ${fullPath(base, path)}`,
        // The same read the guard makes, through the same helper: handler first, then the
        // controller, so a class-level exemption covers its handlers.
        anonymous:
          reflector.getAllAndOverride<boolean | undefined>(ALLOW_ANONYMOUS, [
            handler,
            controller,
          ]) === true,
      });
    }
  }

  return routes.sort((left, right) => left.signature.localeCompare(right.signature));
}

/**
 * Where a route answers, from the origin root.
 *
 * The health controller is `VERSION_NEUTRAL` and its path is excluded from the global
 * prefix, so it answers at the root; everything else sits under `/api/v1`. That is two
 * cases rather than a general rule because there are two cases —
 * `src/modules/health/health.paths.ts` is the list, and a third would be a decision
 * somebody made rather than a pattern to be inferred.
 *
 * @param base - The controller's own path segment.
 * @param path - The handler's.
 * @returns The path a client writes.
 */
function fullPath(base: string, path: string): string {
  const segments = [base, path].filter((segment) => segment !== "" && segment !== "/");
  const prefix = base === HEALTH_PATH ? "" : API_BASE_PATH;
  const joined = segments.join("/");

  return joined === "" ? prefix : `${prefix}/${joined}`;
}

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
    expect(routes.length).toBeGreaterThanOrEqual(20);
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

  it.each([
    ["the tenancy API", "get", `${API_BASE_PATH}/tenants`],
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
      .post(`${API_BASE_PATH}/tenants`)
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
    // The tenancy listing rather than `GET /api/v1/auth/me`, which was this assertion's
    // route until [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it as the
    // duplicate answer to *who is signed in*. Any authenticated route will do here — the
    // subject is the guard.
    const response = await request(server())
      .get(`${API_BASE_PATH}/tenants`)
      .set("Cookie", grantSession());

    expect(response.status).not.toBe(401);
  });
});
