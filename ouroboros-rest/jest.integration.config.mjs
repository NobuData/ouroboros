/**
 * Jest for ouroboros-rest's integration suite — the tests that need a real PostgreSQL.
 *
 * A second configuration rather than a second `testMatch` in the first, because the two
 * suites answer to different rules. `yarn test` starts nothing, needs nothing and is meant
 * to run on save; this one starts a `postgres:17-alpine`, migrates it with `ouroboros-db`'s
 * Flyway project, and runs Supertest against a listening application on a random port
 * ([#37](https://github.com/NobuData/ouroboros/issues/37)):
 *
 *   yarn test:integration
 *
 * Docker is the only prerequisite, and the container is thrown away when the run ends. A
 * developer who would rather keep the database — to look at what a failing suite left, or
 * because the compose stack is already up — exports one instead, and the hooks below start
 * nothing:
 *
 *   docker compose up -d
 *   OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
 *     yarn test:integration
 *
 * Files are `*.integration-spec.ts`, which `jest.config.mjs`'s `**\/*.spec.ts` does not
 * match — so the unit suite cannot pick one up by accident and start failing on a machine
 * with no database.
 *
 * @type {import("jest").Config}
 */
export default {
  testEnvironment: "node",

  roots: ["<rootDir>/src"],
  testMatch: ["**/*.integration-spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],

  // The same strict tsconfig the unit suite and `yarn typecheck` read, so an integration
  // test cannot compile under looser rules than the code it exercises. It transforms the
  // two hooks below as well, which is why they can be TypeScript at all.
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }] },

  setupFiles: ["reflect-metadata"],

  // The database, started once for the whole run and stopped however the run ends. They are
  // a matched pair and share one value through `global.state.fixture.ts`; see the header of
  // each. Neither is under `roots`, so neither is mistaken for a suite.
  globalSetup: "<rootDir>/src/testing/global.setup.fixture.ts",
  globalTeardown: "<rootDir>/src/testing/global.teardown.fixture.ts",

  clearMocks: true,
  restoreMocks: true,

  // One worker. These suites share one database and empty it between tests; two of them
  // interleaving would have each one truncating the other's rows mid-test.
  maxWorkers: 1,

  // A connection, a migration check and a drain that waits on the server are all slower
  // than a unit test's five seconds — and a suite that times out on a cold container
  // reports a failure that is not one. Starting the container is *not* covered by this:
  // Jest does not time out `globalSetup`, and `MIGRATION_TIMEOUT_MS` is what bounds it.
  testTimeout: 30_000,
};
