/**
 * A valid environment, for the tests that need one but are not about configuration.
 *
 * Every spec that builds an application needs a `Configuration`, and hand-rolling one in
 * each of them would mean nine literals per file and a suite that drifts from the schema
 * the moment a variable is added. This is the one place they come from.
 *
 * The values are the development defaults the repo-root `.env.example` documents, which
 * makes the fixture do a second job: if a change to the schema stops those defaults from
 * validating, every suite that builds an application fails — so a clean checkout that
 * cannot start is caught here rather than by the developer who copied the template.
 *
 * **One deliberate divergence.** `.env.example` still carries `OURO_AUTH_DEV_USER`, which
 * signed a fresh checkout in against the development seed without a GitHub OAuth
 * application ([#33](https://github.com/NobuData/ouroboros/issues/33)); this fixture leaves
 * it unset. That mattered while something read it — a suite whose every request arrived
 * pre-authenticated could not assert that a route is protected, and would go on passing if
 * the guard were removed — and it is kept unset now that
 * [#703](https://github.com/NobuData/ouroboros/issues/703) has left nothing reading it at
 * all, because a fixture that supplies a value nothing consumes is a value somebody has to
 * work out the meaning of.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs, so
 * nothing under `dist/` carries these strings.
 */

import { loadConfiguration, type Configuration } from "./configuration";

/**
 * The repo-root `.env.example`, as an environment.
 *
 * Kept in lockstep with that file by `scripts/verify-dev-env.sh`, which fails the build
 * when a variable this module's README documents is missing from the template.
 */
export const DEVELOPMENT_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  OURO_DATABASE_URL: "postgresql://ouroboros:ouroboros@localhost:5432/ouroboros",
  OURO_REST_URL: "http://localhost:4000",
  OURO_UI_URL: "http://localhost:3000",
  OURO_ENGINE_URL: "http://localhost:8000",
  OURO_ENGINE_SHARED_SECRET: "dev-engine-shared-secret-change-me",
  BETTER_AUTH_SECRET: "dev-better-auth-secret-change-me",
  BETTER_AUTH_URL: "http://localhost:4000",
  OURO_GITHUB_CLIENT_ID: "dev-github-client-id",
  OURO_GITHUB_CLIENT_SECRET: "dev-github-client-secret",
  OURO_CORS_ORIGINS: "http://localhost:3000",
});

/**
 * The development environment, with whatever a test needs to be different about it.
 *
 * @param overrides - Variables to add or replace. A test that wants a variable *absent*
 *   builds the record itself; this helper is for the common case, which is one value.
 * @returns An environment, ready for `loadConfiguration`.
 */
export function testEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...DEVELOPMENT_ENVIRONMENT, ...overrides };
}

/**
 * A validated configuration a test can hand to `createApplication` or `bootstrap`.
 *
 * It goes through `loadConfiguration` rather than being written out as an object literal,
 * so a test is always exercising a configuration the schema actually produces — including
 * the coercions, which an object literal would quietly get right for the wrong reason.
 *
 * @param overrides - Environment variables to add or replace before validating.
 * @returns The frozen configuration.
 * @throws {ConfigurationError} If the overrides do not validate, which is what a test that
 *   passed a bad value should get.
 */
export function testConfiguration(overrides: NodeJS.ProcessEnv = {}): Configuration {
  return loadConfiguration(testEnvironment(overrides));
}
