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
 * **`NODE_ENV` is deliberately left unset**, so every configuration built here is a
 * `development` one — which is the environment a developer runs and therefore the one worth
 * defaulting to. It matters more than it used to:
 * [#705](https://github.com/NobuData/ouroboros/issues/705) gates the email/password sign-in
 * on this value, so a suite asserting the *production* posture has to ask for it by name
 * (`testConfiguration({ NODE_ENV: "production" })`), and `password.provider.spec.ts` does.
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
  // 32 bytes of ASCII, base64 — the template's placeholder, and a value chosen to be
  // unmistakably a placeholder when it is decoded rather than to look like key material.
  OURO_VAULT_MASTER_KEY: "b3Vyb2Jvcm9zLWRldi12YXVsdC1tYXN0ZXIta2V5ISE=",
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
