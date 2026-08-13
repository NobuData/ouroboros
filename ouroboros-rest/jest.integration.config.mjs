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
  moduleFileExtensions: ["ts", "js", "mjs", "json"],

  // **This is where the two suites part company, and it is the whole of
  // [#715](https://github.com/NobuData/ouroboros/issues/715)'s foundation.**
  //
  // `jest.config.mjs` *replaces* `better-auth` with `src/auth/better-auth.fixture.ts`,
  // because the unit suite starts nothing and a hundred-line stand-in is enough to assert
  // where the library is mounted. This one **converts it and loads the real thing**. The
  // difference is the difference between the two suites: a mocked guard proves the mock
  // works, and every claim #715 has to make — that a password buys a session, that signing
  // out revokes one, that a `viewer` is refused where a `member` is not, that the GitHub
  // callback writes an `account` row — is a claim about the library's own routes.
  //
  // The conversion is `jest.esm-transform.cjs`, the same one `@thallesp/nestjs-better-auth`
  // has always gone through, pointed at every ES module the library pulls in. The list is
  // written out rather than left as "transform node_modules": naming them is what makes a
  // new ES-module dependency an error a person reads rather than a silent minute added to
  // every run.
  //
  //   * `better-auth/`, `@better-auth/` — the library, its core, the Kysely adapter it
  //     builds from a `pg` pool, and the utils its crypto is written against.
  //   * `better-call/` — the router and the cookie signing every session token carries.
  //   * `@better-fetch/`, `defu/`, `rou3/` — fetch, option merging and route matching.
  //   * `kysely/` — the library ships **its own copy**, nested under `better-auth/`, which
  //     is why this entry is here even though the service's own Kysely is CommonJS. Both
  //     resolve through a `/node_modules/kysely/` path, and this pattern admits either.
  //   * `jose/`, `@noble/` — the JWT and hashing primitives, which is where scrypt lives
  //     and therefore what makes #705's password real rather than compared.
  //   * `zod/` — the request schemas every one of those routes validates against.
  //   * `@opentelemetry/semantic-conventions` — reached by the telemetry module, which this
  //     service turns off but the library still loads.
  //
  // What this costs is about a second and a half of transform on a cold cache, once per
  // spec file, which the run's #37 container start dwarfs.
  transformIgnorePatterns: [
    "/node_modules/(?!" +
      [
        "@thallesp/nestjs-better-auth/",
        "better-auth/",
        "@better-auth/",
        "@better-fetch/",
        "better-call/",
        "defu/",
        "jose/",
        "kysely/",
        "rou3/",
        "zod/",
        "@noble/",
        "@opentelemetry/",
      ].join("|") +
      ")",
    "\\.pnp\\.[^\\\\/]+$",
  ],

  // `.js` as well as `.mjs`, which `jest.config.mjs` does not need. Some of the packages
  // above ship ES modules under a `.js` extension — `@noble/hashes` is the one that first
  // proved it — and Jest picks a transform by filename, so the pattern has to admit both.
  // Application code is `.ts` and is unaffected; a CommonJS file in `node_modules` passes
  // through `ts.transpileModule` unchanged.
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
    "^.+\\.(mjs|js|cjs)$": "<rootDir>/jest.esm-transform.cjs",
  },

  setupFiles: ["reflect-metadata"],

  // The database, started once for the whole run and stopped however the run ends. They are
  // a matched pair and share one value through `global.state.fixture.ts`; see the header of
  // each. Neither is under `roots`, so neither is mistaken for a suite.
  globalSetup: "<rootDir>/src/testing/global.setup.fixture.ts",
  globalTeardown: "<rootDir>/src/testing/global.teardown.fixture.ts",

  clearMocks: true,
  restoreMocks: true,

  // The application under test does not get to write on the runner's terminal.
  //
  // `createApplication(…, { logger: false })` silences Nest, and until
  // [#715](https://github.com/NobuData/ouroboros/issues/715) that was everything that
  // logged. The real BetterAuth is a second logger: it writes to `console` directly, with
  // its own formatting and ANSI colours, and it writes an `ERROR` for every refusal — which
  // in a suite whose subject is *refusals* means a wrong password, a disabled provider and a
  // rejected callback each print a stack trace beside a passing test. Read literally, a run
  // full of red `ERROR` lines and 0 failures is worse than useless: it trains whoever reads
  // it to ignore the words.
  //
  // Silenced here rather than configured away in `auth.options.ts`, because what the service
  // logs in production is a decision that belongs to the service and not to its test runner.
  // A suite that needs to assert *that* something was logged spies on the method, which
  // `silent` does not prevent; a developer who wants to watch the library think runs
  // `yarn test:integration --silent=false`.
  silent: true,

  // One worker. These suites share one database and empty it between tests; two of them
  // interleaving would have each one truncating the other's rows mid-test.
  maxWorkers: 1,

  // A connection, a migration check and a drain that waits on the server are all slower
  // than a unit test's five seconds — and a suite that times out on a cold container
  // reports a failure that is not one. Starting the container is *not* covered by this:
  // Jest does not time out `globalSetup`, and `MIGRATION_TIMEOUT_MS` is what bounds it.
  testTimeout: 30_000,
};
