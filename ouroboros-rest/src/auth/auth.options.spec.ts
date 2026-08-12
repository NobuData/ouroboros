import { Test } from "@nestjs/testing";
import { Pool } from "pg";

import { ConfigurationModule } from "../modules/config/config.module";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { DbModule } from "../modules/db/db.module";
import { DatabaseService } from "../modules/db/db.service";
import { AUTH_APP_NAME, AUTH_BASE_PATH, authOptions } from "./auth.options";
import { ACCOUNT_LINKING, githubProvider, GITHUB_PROVIDER_ID } from "./github.provider";

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

  // #700 was the foundation and the issues after it each own one of the options below.
  // Listing the whole surface is how that stays true: an option added here — rather than in
  // the issue that owns it, with the migration and the tests that go with it — fails this
  // test. #702 added the two it owns, `socialProviders` and `account`; #703, #704 and #705
  // are still to come.
  it("configures nothing the issues after it own", () => {
    const options = authOptions({ configuration: testConfiguration(), pool: fakePool() });

    expect(Object.keys(options).sort()).toEqual([
      "account",
      "appName",
      "basePath",
      "baseURL",
      "database",
      "secret",
      "socialProviders",
      "telemetry",
      "trustedOrigins",
    ]);
  });
});

describe("the GitHub provider", () => {
  it("is configured, and is the only one", () => {
    // Mockup 01's primary action, and the only way into this service until #705 adds a
    // development password. A second provider appearing here without an issue behind it is
    // a consent screen nobody designed.
    const { socialProviders } = authOptions({
      configuration: testConfiguration(),
      pool: fakePool(),
    });

    expect(Object.keys(socialProviders ?? {})).toEqual([GITHUB_PROVIDER_ID]);
  });

  it("is the provider `github.provider.ts` builds, decisions and all", () => {
    const configuration = testConfiguration({ OURO_GITHUB_CLIENT_ID: "Iv1.abc" });

    expect(authOptions({ configuration, pool: fakePool() }).socialProviders?.github).toEqual(
      githubProvider(configuration),
    );
  });

  it("means the callback GitHub is registered against is BETTER_AUTH_URL's", () => {
    // The URL an OAuth App has to carry, and the one string this service cannot get wrong
    // without every sign-in failing at the last hop. It is built by the library from
    // `baseURL` + `basePath` + `/callback/` + the provider id — all four of which are
    // asserted above, so this composes them rather than hard-coding the result.
    const options = authOptions({
      configuration: testConfiguration({ BETTER_AUTH_URL: "https://api.ouroboros.build" }),
      pool: fakePool(),
    });

    // `baseURL` is typed as a union with an object form the library also accepts; this
    // service always sets the string, which `auth.options.ts` does from one validated
    // variable — so the cast narrows a type rather than assuming a value.
    const origin = options.baseURL as string;

    expect(`${origin}${options.basePath}/callback/${GITHUB_PROVIDER_ID}`).toBe(
      "https://api.ouroboros.build/api/auth/callback/github",
    );
  });
});

describe("account linking", () => {
  it("is the policy `github.provider.ts` argues for", () => {
    // An `account`-level option rather than a provider-level one — it governs every
    // provider there will ever be — but the policy exists because of GitHub, so it is
    // argued for and asserted beside it.
    expect(authOptions({ configuration: testConfiguration(), pool: fakePool() }).account).toEqual({
      accountLinking: ACCOUNT_LINKING,
    });
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
