import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { Pool } from "pg";

import { testConfiguration } from "../modules/config/configuration.fixture";
import { createAuth } from "./auth.factory";
import { authOptions } from "./auth.options";
import { organizationOptions } from "./organization.plugin";

/**
 * That the library is handed the options this service decided on, and nothing else.
 *
 * `better-auth` is replaced by the factory below rather than loaded, and the substitution
 * is not a convenience: the library is ES-module-only and this runner is CommonJS, so a
 * spec that imported it for real would fail to parse it. Passing a *factory* to
 * `jest.mock` is what keeps Jest from resolving the real file at all. (Since
 * [#701](https://github.com/NobuData/ouroboros/issues/701) the whole suite maps
 * `better-auth` at `better-auth.fixture.ts` for the same reason — see `jest.config.mjs`.
 * The factory below is what governs *here*, and is kept because this spec is about which
 * options reach the library rather than about what it does with them.)
 *
 * What that costs is exactly one claim — that `betterAuth()` accepts these options — and
 * it is bought back outside Jest: `@better-auth/cli generate` loads `auth.config.ts`,
 * builds a real instance from the same function, and prints the schema (`README.md`
 * § Generating the auth schema). A green suite here and a generated `V004` there are the
 * two halves.
 */

// One factory for both specifiers, and it has to be one. `jest.config.mjs` maps
// `better-auth` and `better-auth/plugins` at the same fixture module, so `jest.mock`
// registers against the same resolved path for either name — two factories would mean the
// second silently replacing the first, and whichever export it omitted would be undefined
// at the point `createAuth` reaches for it.
jest.mock("better-auth", () => ({
  betterAuth: jest.fn((options: unknown) => ({ options, handler: jest.fn() })),
  organization: jest.fn((options: unknown) => ({ id: "organization", options })),
}));
jest.mock("pg");

/** The stand-in, typed so its calls can be read. */
const betterAuthMock = jest.mocked(betterAuth);
/** The plugin factory, typed the same way. */
const organizationMock = jest.mocked(organization);

describe("createAuth", () => {
  it("builds the instance from this service's options", () => {
    const dependencies = { configuration: testConfiguration(), pool: new Pool() };

    createAuth(dependencies);

    expect(betterAuthMock).toHaveBeenCalledTimes(1);

    // Every option except the plugin list, which is this file's own addition and is
    // asserted below. Separated rather than compared whole so that an option added to
    // `authOptions` still has to appear here — the property #700 established.
    const { plugins, ...rest } = betterAuthMock.mock.calls[0]?.[0] ?? {};

    expect(rest).toEqual(authOptions(dependencies));
    expect(plugins).toEqual([organizationMock.mock.results[0]?.value]);
  });

  describe("the organization plugin (#704)", () => {
    it("is registered, and is the only plugin", () => {
      // Tenancy is the plugin's (decision A5). A second plugin appearing here without an
      // issue behind it is a route surface nobody designed — #722's SSO is the next one,
      // and it is v2.
      createAuth({ configuration: testConfiguration(), pool: new Pool() });

      const registered = betterAuthMock.mock.calls[0]?.[0]?.plugins;

      expect(registered).toHaveLength(1);
      expect(registered?.[0]).toMatchObject({ id: "organization" });
    });

    it("is built from the options `organization.plugin.ts` decides, and nothing else", () => {
      // The roles, the creator's role and the hooks are asserted where they are decided.
      // What is fixed here is that this factory adds no policy of its own on the way past —
      // a `roles:` written inline here would be a second place tenancy could be configured.
      //
      // The access control and the role table are compared by **identity**, which is the
      // strongest form the claim takes and is the one the plugin needs: it resolves a role
      // out of `roles` and authorizes against `ac`, so an equivalent-but-separate instance
      // would authorize nothing with no error to say why.
      createAuth({ configuration: testConfiguration(), pool: new Pool() });

      const expected = organizationOptions();
      const passed = organizationMock.mock.calls[0]?.[0] as ReturnType<typeof organizationOptions>;

      expect(organizationMock).toHaveBeenCalledTimes(1);
      expect(passed.ac).toBe(expected.ac);
      expect(passed.roles).toBe(expected.roles);
      expect(passed.creatorRole).toBe(expected.creatorRole);
      // The hooks are closures over an optional audit sink, so they are equal in everything
      // but identity; that both are registered, and what they do, is
      // `organization.plugin.spec.ts`.
      expect(Object.keys(passed.organizationHooks ?? {}).sort()).toEqual(
        Object.keys(expected.organizationHooks ?? {}).sort(),
      );
    });
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
