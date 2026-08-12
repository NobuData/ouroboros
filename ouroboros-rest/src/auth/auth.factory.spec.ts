import { betterAuth } from "better-auth";
import { Pool } from "pg";

import { testConfiguration } from "../modules/config/configuration.fixture";
import { createAuth } from "./auth.factory";
import { authOptions } from "./auth.options";

/**
 * That the library is handed the options this service decided on, and nothing else.
 *
 * `better-auth` is replaced by the factory below rather than loaded, and the substitution
 * is not a convenience: the library is ES-module-only and this runner is CommonJS, so a
 * spec that imported it for real would fail to parse it. Passing a *factory* to
 * `jest.mock` is what keeps Jest from resolving the real file at all.
 *
 * What that costs is exactly one claim — that `betterAuth()` accepts these options — and
 * it is bought back outside Jest: `@better-auth/cli generate` loads `auth.config.ts`,
 * builds a real instance from the same function, and prints the schema (`README.md`
 * § Generating the auth schema). A green suite here and a generated `V004` there are the
 * two halves.
 */

jest.mock("better-auth", () => ({
  betterAuth: jest.fn((options: unknown) => ({ options, handler: jest.fn() })),
}));
jest.mock("pg");

/** The stand-in, typed so its calls can be read. */
const betterAuthMock = jest.mocked(betterAuth);

describe("createAuth", () => {
  it("builds the instance from this service's options", () => {
    const dependencies = { configuration: testConfiguration(), pool: new Pool() };

    createAuth(dependencies);

    expect(betterAuthMock).toHaveBeenCalledTimes(1);
    expect(betterAuthMock).toHaveBeenCalledWith(authOptions(dependencies));
  });

  it("shares the pool it was given rather than opening one", () => {
    const pool = new Pool();
    // One `pg.Pool` exists in this test, and it is the caller's. A factory that reached
    // for a connection string would show up here as a second construction.
    jest.mocked(Pool).mockClear();

    createAuth({ configuration: testConfiguration(), pool });

    expect(jest.mocked(Pool)).not.toHaveBeenCalled();
    expect(betterAuthMock.mock.calls[0]?.[0]).toMatchObject({ database: pool });
  });

  it("returns what the library returned, so a caller holds the instance itself", () => {
    const instance = createAuth({ configuration: testConfiguration(), pool: new Pool() });

    expect(instance).toBe(betterAuthMock.mock.results[0]?.value);
  });
});
