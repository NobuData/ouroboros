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
 * been worthless. What is replaced is BetterAuth itself, by `better-auth.fixture.ts`, which
 * is the seam [#701](https://github.com/NobuData/ouroboros/issues/701) ends at: mounting is
 * this issue's, and what the routes then do belongs to
 * [#702](https://github.com/NobuData/ouroboros/issues/702) and
 * [#703](https://github.com/NobuData/ouroboros/issues/703).
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
    expect(instanceOf(options.auth).options).toEqual(
      authOptions({ configuration: config.all, pool }),
    );
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

  it("resolves the library's service, so #703 has something to inject", () => {
    // A module whose provider cannot be reached from outside it is one the next issue
    // copies instead of importing. This is the `exports` line in `auth.module.ts`.
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
  });

  it("serves from an instance holding the application's own pool", () => {
    // The same claim as above, one step further along: not that the factory shares the
    // pool, but that the instance the mounted handler serves from is the one that did.
    expect(instanceOf(app.get(AuthService).instance).options.database).toBe(
      app.get(DatabaseService).pool,
    );
  });

  it("registers no global guard of its own", async () => {
    // The library's default is an `APP_GUARD` requiring a BetterAuth session on every
    // route. This service already has one — #33's `SessionGuard`, reading the cookie that
    // still signs people in — and two would mean every request had to satisfy both, which
    // no caller can do until they are the same session. #703 is what swaps them.
    await request(server()).get(API_BASE_PATH).expect(200);
  });

  it("leaves the guard that is in force this service's own", async () => {
    // The other half: a route that *does* need a session is still refused by #33's guard,
    // in #33's shape. A BetterAuth guard answering here would be a different code in a
    // different envelope, which is what `ouroboros-ui` would notice first.
    const response = await request(server()).get(`${API_BASE_PATH}/auth/me`).expect(401);

    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
  });
});
