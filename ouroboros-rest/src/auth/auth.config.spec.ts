import { Pool } from "pg";

import { DEVELOPMENT_ENVIRONMENT } from "../modules/config/configuration.fixture";
import { poolOptions } from "../modules/db/pool";

/**
 * The file `@better-auth/cli` loads: what it builds, and what it opens to build it.
 *
 * Everything here happens when the module is *imported*, which is what the CLI does and
 * what the application must never do — so the module is loaded inside
 * `jest.isolateModulesAsync` with an environment this suite controls, rather than at the
 * top of the file. `better-auth` is substituted for the reason `auth.factory.spec.ts`
 * gives, and `pg` so that nothing connects to anything.
 *
 * What no suite in this runner can prove is that the CLI *itself* can read the file —
 * that needs the real library and the loader the CLI brings. `README.md` § Generating the
 * auth schema is the command, and [#706](https://github.com/NobuData/ouroboros/issues/706)
 * is the issue that runs it.
 */

// Both exports from one factory, because `jest.config.mjs` maps `better-auth` and
// `better-auth/plugins` at the same fixture module: `jest.mock` registers against the
// resolved path, so a second factory would replace this one rather than sit beside it.
// `organization` is here because `auth.config.ts` builds a real instance through
// `createAuth`, which registers the plugin ([#704](https://github.com/NobuData/ouroboros/issues/704)).
jest.mock("better-auth", () => ({
  betterAuth: jest.fn((options: unknown) => ({ options })),
  organization: jest.fn((options: unknown) => ({ id: "organization", options })),
}));
jest.mock("pg");

/** The module, as its exports are typed. Referenced as a type only, so nothing loads. */
type ConfigModule = typeof import("./auth.config");

/**
 * Load the configuration the way the CLI does, under a known environment.
 *
 * Every variable the schema requires is set on `process.env` before the module is loaded,
 * so the repo's `.env` files — which the module layers *underneath* the process
 * environment, as `main.ts` does — cannot change what this suite observes on one machine
 * and not another.
 *
 * @param overrides - Variables to set on top of the development defaults.
 * @returns The module's exports, from a registry of its own.
 */
async function loadCliConfig(overrides: NodeJS.ProcessEnv = {}): Promise<ConfigModule> {
  const environment = { ...DEVELOPMENT_ENVIRONMENT, ...overrides };
  Object.assign(process.env, environment);

  try {
    let loaded: ConfigModule | undefined;
    await jest.isolateModulesAsync(async () => {
      loaded = await import("./auth.config");
    });

    if (loaded === undefined) {
      throw new Error("auth.config.ts did not load");
    }

    return loaded;
  } finally {
    for (const name of Object.keys(environment)) {
      delete process.env[name];
    }
  }
}

describe("the instance the CLI reads", () => {
  it("is exported under both names the loader looks for", async () => {
    const { auth, default: fallback } = await loadCliConfig();

    expect(auth).toBeDefined();
    expect(fallback).toBe(auth);
  });

  it("is configured from the environment the command was run with", async () => {
    const { auth } = await loadCliConfig({ BETTER_AUTH_URL: "https://api.ouroboros.build" });

    expect(auth.options.baseURL).toBe("https://api.ouroboros.build");
    expect(auth.options.secret).toBe(DEVELOPMENT_ENVIRONMENT.BETTER_AUTH_SECRET);
    expect(auth.options.trustedOrigins).toEqual(["http://localhost:3000"]);
  });

  it("issues its statements over the one pool it opened", async () => {
    const { auth } = await loadCliConfig();

    expect(jest.mocked(Pool)).toHaveBeenCalledTimes(1);
    expect(auth.options.database).toBe(jest.mocked(Pool).mock.instances[0]);
  });
});

describe("commandPool", () => {
  it("connects on the search path the service writes on", async () => {
    // Without it `generate` introspects `public`, finds none of the Flyway-owned tables,
    // and emits a migration that recreates the schema this service is already running on.
    const { commandPool } = await loadCliConfig();
    jest.mocked(Pool).mockClear();

    commandPool("postgresql://ouroboros:ouroboros@localhost:5432/ouroboros");

    expect(jest.mocked(Pool)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: poolOptions("postgresql://ouroboros:ouroboros@localhost:5432/ouroboros").options,
      }),
    );
  });

  it("takes one connection, where the service's pool takes ten", async () => {
    const { commandPool, CLI_POOL_CONNECTIONS } = await loadCliConfig();
    jest.mocked(Pool).mockClear();

    commandPool(DEVELOPMENT_ENVIRONMENT.OURO_DATABASE_URL);

    expect(CLI_POOL_CONNECTIONS).toBe(1);
    expect(jest.mocked(Pool)).toHaveBeenCalledWith(
      expect.objectContaining({ max: CLI_POOL_CONNECTIONS }),
    );
  });
});
