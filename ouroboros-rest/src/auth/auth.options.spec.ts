import { Test } from "@nestjs/testing";
import { Pool } from "pg";

import { ConfigurationModule } from "../modules/config/config.module";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { DbModule } from "../modules/db/db.module";
import { DatabaseService } from "../modules/db/db.service";
import { AUTH_APP_NAME, AUTH_BASE_PATH, authOptions } from "./auth.options";

/**
 * What BetterAuth is configured with, and what it is deliberately not configured with.
 *
 * `pg` is mocked throughout: nothing here connects to anything, because nothing here is
 * about connecting. The subject is an object — which values reach the library, which of
 * this service's decisions they encode, and whose pool ends up inside it.
 *
 * The suite that exercises the library itself is `auth.integration-spec.ts`; the library
 * is ES-module-only and this runner is CommonJS, which is the reason `auth.options.ts`
 * takes its types from `better-auth` and its values from nowhere.
 */

jest.mock("pg");

/** A stand-in for the service's pool, distinguishable by identity and nothing else. */
function fakePool(): Pool {
  return new Pool();
}

describe("authOptions", () => {
  it("reads BetterAuth's own two variables, not a second pair beside them", () => {
    const options = authOptions({
      configuration: testConfiguration({
        BETTER_AUTH_SECRET: "a-secret-long-enough-to-pass",
        BETTER_AUTH_URL: "https://api.ouroboros.build",
      }),
      pool: fakePool(),
    });

    expect(options.secret).toBe("a-secret-long-enough-to-pass");
    expect(options.baseURL).toBe("https://api.ouroboros.build");
  });

  it("mounts the library where the versioned API is not", () => {
    // `/api/auth`, beside `/api/v1` rather than inside it: BetterAuth versions its own
    // routes, and #701 excludes exactly this prefix from the global one.
    expect(authOptions({ configuration: testConfiguration(), pool: fakePool() }).basePath).toBe(
      AUTH_BASE_PATH,
    );
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });

  it("names the application, so nothing it renders says Better Auth", () => {
    expect(authOptions({ configuration: testConfiguration(), pool: fakePool() }).appName).toBe(
      AUTH_APP_NAME,
    );
  });

  it("trusts the browser origins the API already trusts with credentials", () => {
    const options = authOptions({
      configuration: testConfiguration({
        OURO_CORS_ORIGINS: "http://localhost:3000,https://app.ouroboros.build",
      }),
      pool: fakePool(),
    });

    expect(options.trustedOrigins).toEqual([
      "http://localhost:3000",
      "https://app.ouroboros.build",
    ]);
  });

  it("hands over a copy of that list, not the frozen configuration's own array", () => {
    // The configuration is frozen so nothing can widen the policy after boot; a library
    // handed the frozen array itself would either mutate it — and throw — or be trusted
    // not to. A copy is neither.
    const configuration = testConfiguration();
    const { trustedOrigins } = authOptions({ configuration, pool: fakePool() });

    expect(trustedOrigins).not.toBe(configuration.corsOrigins);
    expect(Object.isFrozen(trustedOrigins)).toBe(false);
  });

  it("does not phone home", () => {
    expect(authOptions({ configuration: testConfiguration(), pool: fakePool() }).telemetry).toEqual(
      { enabled: false },
    );
  });

  it("hands back a fresh object each time", () => {
    // Two callers exist — the application and the CLI — and a shared literal would let a
    // plugin list added to one appear in the other. One pool for both, so that what is
    // compared is everything *except* the dependency that is meant to differ.
    const pool = fakePool();
    const first = authOptions({ configuration: testConfiguration(), pool });
    const second = authOptions({ configuration: testConfiguration(), pool });

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  // This issue is the foundation, and the four that build on it each own one of the
  // options below. Listing the whole surface is how "before any provider or route exists"
  // stays true: adding `socialProviders` here — rather than in #702, with the migration
  // and the tests that go with it — fails this test.
  it("configures nothing the issues after it own", () => {
    const options = authOptions({ configuration: testConfiguration(), pool: fakePool() });

    expect(Object.keys(options).sort()).toEqual([
      "appName",
      "basePath",
      "baseURL",
      "database",
      "secret",
      "telemetry",
      "trustedOrigins",
    ]);
  });
});

describe("the database", () => {
  it("is the pool it was given, and nothing it made for itself", () => {
    const pool = fakePool();

    expect(authOptions({ configuration: testConfiguration(), pool }).database).toBe(pool);
  });

  // [#700](https://github.com/NobuData/ouroboros/issues/700)'s third acceptance criterion:
  // *no second database pool is created*. Asserted rather than assumed, which is why this
  // spec reaches for `DbModule` at all — the claim is about two modules at once, so
  // neither of them can make it alone. The wiring that passes one to the other is
  // [#701](https://github.com/NobuData/ouroboros/issues/701)'s; what is fixed here is that
  // there is one pool to pass.
  it("is the pool DbModule already owns, so the service holds one set of connections", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DbModule],
    }).compile();
    const database = moduleRef.get(DatabaseService);

    const options = authOptions({ configuration: testConfiguration(), pool: database.pool });

    expect(options.database).toBe(database.pool);
    expect(jest.mocked(Pool)).toHaveBeenCalledTimes(1);

    await moduleRef.close();
  });
});
