/**
 * Jest for ouroboros-rest — the unit suite `yarn test` and `ci/rest` run.
 *
 * Specs live beside the code they cover as `*.spec.ts`, which is the Nest convention
 * and the one the CLI's schematics generate into. The integration suite — Supertest
 * against a Testcontainers-backed database — is #37 and lands its own project; this one
 * starts nothing, needs nothing, and is expected to stay fast enough to run on save.
 *
 * @type {import("jest").Config}
 */
export default {
  // The service runs on Node and touches no DOM.
  testEnvironment: "node",

  // Only src/. dist/ holds the compiled copy of exactly these files, and matching both
  // would run every test twice — the second time against yesterday's build.
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],

  // ts-jest reads tsconfig.json — the same strict configuration `yarn typecheck` uses,
  // so a test cannot compile under looser rules than the code it exercises.
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }] },

  // Nest reads the decorator metadata the compiler emits through the reflect-metadata
  // polyfill, which has to be installed before any decorated class is imported. main.ts
  // does that for the process; this does it for the test runner.
  setupFiles: ["reflect-metadata"],

  // A mock that survives into the next test is a test that passes for the wrong reason.
  clearMocks: true,
  restoreMocks: true,

  coverageDirectory: "coverage",
  // Fixtures are test support, not application code: `tsconfig.build.json` leaves them
  // out of what ships, so counting them as covered or uncovered says nothing.
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.spec.ts", "!src/**/*.fixture.ts"],
};
