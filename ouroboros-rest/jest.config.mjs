/**
 * Jest for ouroboros-rest — the unit suite `yarn test` and `ci/rest` run.
 *
 * Specs live beside the code they cover as `*.spec.ts`, which is the Nest convention
 * and the one the CLI's schematics generate into. The integration suite is
 * `*.integration-spec.ts` under `jest.integration.config.mjs` (#30) — deliberately a name
 * the `testMatch` below does not match, so a test that needs a database can never be
 * picked up by the suite that starts none. This one starts nothing, needs nothing, and is
 * expected to stay fast enough to run on save.
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
  moduleFileExtensions: ["ts", "js", "mjs", "json"],

  // ts-jest reads tsconfig.json — the same strict configuration `yarn typecheck` uses,
  // so a test cannot compile under looser rules than the code it exercises.
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
    "^.+\\.mjs$": "<rootDir>/jest.esm-transform.cjs",
  },

  // ...and the .mjs rule above reaches only what is named below, because node_modules is
  // not transformed by default. Two things are named, for the same reason and at very
  // different sizes.
  //
  // `@thallesp/nestjs-better-auth` is what mounts BetterAuth (#701), it is published as ES
  // modules only, and what it contributes is middleware ordering — so a stand-in for it
  // would be a second implementation of the thing under test. See `jest.esm-transform.cjs`,
  // which is where that trade is written down.
  //
  // BetterAuth's **access-control modules** are the second, added by
  // [#704](https://github.com/NobuData/ouroboros/issues/704), and the argument is the same
  // one at a smaller scale. That issue's third acceptance criterion is that the custom
  // `viewer` role is *asserted, not assumed* — and a `viewer` minted by a stand-in
  // `createAccessControl` would only prove the stand-in returns what it was given. These
  // two modules are a few dozen lines whose only dependency is an error class, so
  // converting them costs about a second and lets `organization.roles.spec.ts` ask the
  // library itself what a viewer may do. `better-auth/node_modules/` and `better-call/` are
  // named because that error class lives under them; nothing else of the library is
  // reachable from here — the plugin proper pulls in `better-auth/api` and is *not*
  // converted, which is why `organization()` is called in `auth.factory.ts` alone.
  //
  // The default pattern is restated because setting this replaces it.
  transformIgnorePatterns: [
    "/node_modules/(?!" +
      [
        "@thallesp/nestjs-better-auth/",
        "better-auth/dist/plugins/access/",
        "better-auth/dist/plugins/organization/access/",
        "better-auth/node_modules/",
        "@better-auth/core/dist/",
        "better-call/",
      ].join("|") +
      ")",
    "\\.pnp\\.[^\\\\/]+$",
  ],

  // `better-auth` itself is replaced rather than converted — megabytes of ES modules with
  // ES-module dependencies of their own, against a stand-in of about a hundred lines that
  // reads the request stream the way the library does. That is the seam #701 ends at: the
  // Nest integration above is real, and what BetterAuth's routes *do* is #702's and #703's
  // to prove. Four specifiers because the running code reaches for three subpaths of the
  // same library; the fixture exports all of them. `better-auth/plugins` is #704's — it is
  // where `organization()` comes from, and it is the entry point that would drag the whole
  // library in.
  moduleNameMapper: {
    "^better-auth$": "<rootDir>/src/auth/better-auth.fixture.ts",
    "^better-auth/(node|api|plugins)$": "<rootDir>/src/auth/better-auth.fixture.ts",
  },

  // Nest reads the decorator metadata the compiler emits through the reflect-metadata
  // polyfill, which has to be installed before any decorated class is imported. main.ts
  // does that for the process; this does it for the test runner.
  setupFiles: ["reflect-metadata"],

  // A mock that survives into the next test is a test that passes for the wrong reason.
  clearMocks: true,
  restoreMocks: true,

  coverageDirectory: "coverage",
  // Fixtures and the integration suites are test support, not application code:
  // `tsconfig.build.json` leaves them out of what ships, so counting them as covered or
  // uncovered says nothing.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.integration-spec.ts",
    "!src/**/*.fixture.ts",
  ],
};
