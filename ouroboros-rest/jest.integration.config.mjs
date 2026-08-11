/**
 * Jest for ouroboros-rest's integration suite — the tests that need a real PostgreSQL.
 *
 * A second configuration rather than a second `testMatch` in the first, because the two
 * suites answer to different rules. `yarn test` starts nothing, needs nothing and is meant
 * to run on save; this one is pointed at a migrated database by whoever runs it and fails
 * outright if it is not:
 *
 *   docker compose up -d
 *   OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
 *     yarn test:integration
 *
 * Files are `*.integration-spec.ts`, which `jest.config.mjs`'s `**\/*.spec.ts` does not
 * match — so the unit suite cannot pick one up by accident and start failing on a machine
 * with no database.
 *
 * The Testcontainers-backed harness that will run this without a compose stack, and the
 * Supertest API tests that will join it, are
 * [#37](https://github.com/NobuData/ouroboros/issues/37).
 *
 * @type {import("jest").Config}
 */
export default {
  testEnvironment: "node",

  roots: ["<rootDir>/src"],
  testMatch: ["**/*.integration-spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],

  // The same strict tsconfig the unit suite and `yarn typecheck` read, so an integration
  // test cannot compile under looser rules than the code it exercises.
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }] },

  setupFiles: ["reflect-metadata"],

  clearMocks: true,
  restoreMocks: true,

  // One worker. These suites write to a shared database and clean up after themselves;
  // two of them interleaving would have each one deleting the other's rows.
  maxWorkers: 1,

  // A connection, a migration check and a drain that waits on the server are all slower
  // than a unit test's five seconds — and a suite that times out on a cold container
  // reports a failure that is not one.
  testTimeout: 30_000,
};
