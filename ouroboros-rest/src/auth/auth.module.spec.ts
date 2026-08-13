import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { Pool } from "pg";
import request from "supertest";

import { API_BASE_PATH, createApplication } from "../application";
import { AUTH_ERRORS } from "../modules/auth/auth.errors";
import { AppConfigService } from "../modules/config/config.service";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { DatabaseService } from "../modules/db/db.service";
import type { ErrorEnvelope } from "../modules/errors/error.envelope";
import { betterAuthOptions } from "./auth.module";
import { authOptions } from "./auth.options";
import type { StubbedAuth } from "./better-auth.fixture";

/**
 * The mounting, from both ends: the options this service hands the library, and what a
 * running application does with them.
 *
 * `@thallesp/nestjs-better-auth` is loaded for real here — `jest.esm-transform.cjs` is what
 * makes that possible in a CommonJS runner, and its header says why a stand-in would have
 * been worthless. That matters more since
 * [#703](https://github.com/NobuData/ouroboros/issues/703) than it did when this file was
 * written: the `AuthGuard` this module registers is the library's own class, so the guard
 * exercised below is the genuine article and only the session lookup behind it is
 * `better-auth.fixture.ts`.
 *
 * The HTTP surface itself — that `/api/auth/*` answers, that it escapes the prefix, that
 * every other route still parses its body — is `application.spec.ts`, because it is a
 * property of the whole bootstrap rather than of this module.
 *
 * Nothing connects. `pg` connects lazily, so the pools below are objects and nothing else.
 */

/** A configuration service holding the test configuration and nothing else. */
function stubConfig(): AppConfigService {
  return { all: testConfiguration() } as AppConfigService;
}

/** A database service owning a pool it never connects. */
function stubDatabase(pool: Pool): DatabaseService {
  return { pool } as DatabaseService;
}

/** What the factory built, read as the stand-in shapes it. */
function instanceOf(auth: unknown): StubbedAuth {
  return auth as StubbedAuth;
}

describe("the options handed to the library", () => {
  it("builds the instance from this service's own configuration", () => {
    const pool = new Pool();
    const config = stubConfig();

    const options = betterAuthOptions(config, stubDatabase(pool));

    // `authOptions` is where every decision lives (#700). Comparing against it rather than
    // against a literal is what stops this module from becoming a second place a policy
    // can be set — a provider added here and not there would show up as a difference.
    //
    // `plugins` is `createAuth`'s addition rather than `authOptions`', so it is asserted
    // beside rather than inside: the organization plugin's own hooks are closures built per
    // call (`organization.plugin.ts` takes an optional audit sink), and two of them are
    // equal in every way except the identity `toEqual` compares functions by.
    const { plugins, ...rest } = instanceOf(options.auth).options;

    expect(rest).toEqual(authOptions({ configuration: config.all, pool }));
    expect(plugins).toHaveLength(1);
    expect(plugins?.[0]).toMatchObject({ id: "organization" });
  });

  it("shares the pool it was given rather than opening one", () => {
    // The invariant #700 established and this issue is the first that could break it: two
    // pools would be two sets of connections against one `max_connections`, and two things
    // to drain on SIGTERM. `auth.factory.spec.ts` holds the other half — that the factory
    // itself constructs no pool.
    const pool = new Pool();

    expect(
      instanceOf(betterAuthOptions(stubConfig(), stubDatabase(pool)).auth).options.database,
    ).toBe(pool);
  });

  it("keeps the library out of the CORS policy", () => {
    // Given `trustedOrigins`, the library calls `enableCors` on the adapter for itself.
    // This service already answers that question, over the same list, in
    // `permitBrowserOrigins` — so a second policy would be the same origins with a
    // different verb list and different allowed headers, applied by whichever middleware
    // Express reached first. It is asserted here because it cannot be seen from outside:
    // both policies would name the same origins.
    const options = betterAuthOptions(stubConfig(), stubDatabase(new Pool()));

    expect(options.disableTrustedOriginsCors).toBe(true);
  });
});

describe("the module, in a running application", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  it("resolves the library's service, which is what sign-out is called through", () => {
    // A module whose provider cannot be reached from outside it is one the next issue
    // copies instead of importing. This is the `exports` line in `auth.module.ts`, and
    // `AuthController.logout` is the caller.
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
  });

  it("serves from an instance holding the application's own pool", () => {
    // The same claim as above, one step further along: not that the factory shares the
    // pool, but that the instance the mounted handler serves from is the one that did.
    expect(instanceOf(app.get(AuthService).instance).options.database).toBe(
      app.get(DatabaseService).pool,
    );
  });

  it("registers the global guard, so a route that needs a session is refused without one", async () => {
    // #703 turned the library's `AuthGuard` on. The envelope is unchanged — `401` with
    // `code: "unauthenticated"` — because the code is derived from the status
    // (`error.envelope.ts`), which is what keeps a swap of guard from being a change of
    // contract for `ouroboros-ui`.
    //
    // The engine gateway rather than `${API_BASE_PATH}/auth/me`, which was this assertion's
    // route until [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it. What
    // is being asked about is the guard, so any route that needs a session will do.
    const response = await request(server()).get(`${API_BASE_PATH}/engine/status`).expect(401);

    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
  });

  it("registers exactly one, and it is not the library's own registration", async () => {
    // The guard is declared by *this* module rather than by the dynamic module inside it,
    // because Nest reaches the nested one a scan level later — after `TenancyModule`'s
    // guards, which then run before anybody has been authenticated. The observable form of
    // that mistake is a `500` from `@Roles()` on a route with no tenant context, so the
    // route that would produce it is what this asks about.
    const response = await request(server())
      .patch(`${API_BASE_PATH}/orgs/00000000-0000-4000-8000-000000000000/github-orgs/nobudata`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ displayName: "Anything" }))
      .expect(401);

    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
  });

  it("leaves the routes the shipped public surface exempts alone", async () => {
    // One case here; `src/modules/auth/guard.surface.spec.ts` is the enumeration over the
    // whole route table, which is #703's second acceptance criterion.
    await request(server()).get(API_BASE_PATH).expect(200);
  });
});
