/**
 * The small things every integration suite needs, in one place.
 *
 * Before [#37](https://github.com/NobuData/ouroboros/issues/37) each of the three suites
 * carried its own copy of the database guard below, its own `bodyOf`, and its own way of
 * inventing a name — three copies of code whose only job is to be identical, and which had
 * already begun to differ in their error messages. The harness needed all of it as well,
 * which would have made four.
 *
 * Nothing here starts anything or knows about containers: `postgres.fixture.ts` is where a
 * database comes from and `harness.fixture.ts` is where an application does. This is the
 * layer under both, so a suite that wants only a connection string does not pull
 * Testcontainers into its module graph.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type request from "supertest";

/**
 * The database this run's suites write to.
 *
 * There is no default and no skip, and that is the oldest decision in this file: a suite
 * that quietly passes when it was given no database reports "the constraints are mapped"
 * having mapped nothing, and it is the only check in the repository that can catch the
 * types drifting from the migrations.
 *
 * Since #37 the variable is normally set by `global.setup.fixture.ts`, which starts a
 * PostgreSQL and migrates it — so the failure below now means Jest was pointed at these
 * suites without that hook, rather than that a developer forgot `docker compose up`.
 *
 * @returns The connection string.
 * @throws {Error} When the variable is absent or empty.
 */
export function integrationDatabaseUrl(): string {
  const url = process.env.OURO_DATABASE_URL;

  if (url === undefined || url === "") {
    throw new Error(
      "The integration suite needs a migrated database and was given none. `yarn " +
        "test:integration` starts one; running these specs under jest.config.mjs, or with " +
        "an empty OURO_DATABASE_URL, does not.",
    );
  }

  return url;
}

/**
 * The variable that says the database may be emptied.
 *
 * `global.setup.fixture.ts` sets it for a container it started, and a developer sets it for
 * a database they are willing to lose. Nothing else does, and the harness refuses to
 * truncate without it — see {@link databaseIsDisposable}.
 */
export const DISPOSABLE = "OURO_TEST_DATABASE_DISPOSABLE";

/** The one value {@link DISPOSABLE} may carry to mean yes. */
export const IS_DISPOSABLE = "true";

/**
 * Whether this run's database may be emptied.
 *
 * The safeguard the harness's truncation needs, and it exists because of a regression it
 * would otherwise introduce. Before #37, `OURO_DATABASE_URL=… yarn test:integration` was the
 * documented way to run these suites, it pointed at the development stack, and it was safe:
 * every suite cleaned up rows it had named. Truncation is not safe in that sense — it empties
 * `users` and `tenants` wholesale, and the demo tenant the mockups are drawn around is not
 * something a repeatable migration puts back.
 *
 * So the two are separated. A database this run started is disposable by definition. One that
 * was handed to the run is not, unless whoever handed it over says so:
 *
 * ```bash
 * OURO_DATABASE_URL=… OURO_TEST_DATABASE_DISPOSABLE=true yarn test:integration
 * ```
 *
 * The suites that clean up after themselves are unaffected either way — this gates
 * truncation, not the database.
 *
 * @returns Whether emptying it is permitted.
 */
export function databaseIsDisposable(): boolean {
  return process.env[DISPOSABLE] === IS_DISPOSABLE;
}

/**
 * A response's body, as the type `openapi.yaml` says that operation answers with.
 *
 * Supertest types `body` as `any`, which is honest — it has no idea what was asked for — and
 * unusable: every field read off it would be unchecked. Naming the type here means a spec
 * that reads `page.items[0].isPrimary` is checked against the resource this module actually
 * returns, and the drift check in `src/openapi/openapi.spec.ts` is what keeps *that* type and
 * the published contract in step.
 *
 * @param response - What Supertest returned.
 * @returns Its body, typed.
 */
export function bodyOf<T>(response: request.Response): T {
  return response.body as T;
}

/**
 * A matcher for a value the database chose, typed as the field it stands in for.
 *
 * Jest's asymmetric matchers are typed `any`, so dropping one into an object literal makes
 * the whole literal unchecked — which defeats the point of {@link bodyOf} naming the type in
 * the first place. Naming them here is what keeps `toEqual` exhaustive *and* typed: an
 * expectation that lists every field is how a column added to a resource without being
 * documented gets caught.
 *
 * @param pattern - What the value has to look like.
 * @returns The matcher, as the string the field is.
 */
export function matching(pattern: RegExp): string {
  const matcher: unknown = expect.stringMatching(pattern);

  return matcher as string;
}

/**
 * A matcher for a message that has to mention something.
 *
 * @param text - What it has to contain.
 * @returns The matcher, as the string the field is.
 */
export function containing(text: string): string {
  const matcher: unknown = expect.stringContaining(text);

  return matcher as string;
}

/**
 * Every cookie a response set, as the `Cookie` header a browser would send back.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715) needs this because its flows are
 * *multi-request*: a sign-in sets two cookies, the GitHub handshake sets a state pair on one
 * request and reads them on the next, and a suite that carried only the session token would
 * be testing a browser that discards cookies. Supertest has no cookie jar; this is the
 * smallest thing that stands in for one.
 *
 * Attributes are dropped — `Path`, `HttpOnly`, `Max-Age` and the rest describe how a browser
 * should *store* a cookie, and none of them are sent back. A removal (`name=; Max-Age=0`) is
 * kept rather than filtered, because handing an empty value back is exactly what a browser
 * that had not yet processed the removal would do, and refusing it is the server's job.
 *
 * @param response - What Supertest returned.
 * @returns The header value, `name=value` pairs joined with `; `, or an empty string when the
 *   response set no cookie.
 */
export function cookiesOf(response: request.Response): string {
  const headers = (response.headers["set-cookie"] ?? []) as unknown as string[];

  return headers.map((header) => header.split(";")[0]).join("; ");
}

/**
 * One cookie's whole `Set-Cookie` header, attributes and all.
 *
 * The counterpart to {@link cookiesOf}: that one is for carrying a cookie onward, this is for
 * asserting about it — `Max-Age=0` on a sign-out, `HttpOnly` on a session token.
 *
 * @param response - What Supertest returned.
 * @param name - The cookie to find.
 * @returns The header, or an empty string when the response did not set that cookie.
 */
export function setCookie(response: request.Response, name: string): string {
  const headers = (response.headers["set-cookie"] ?? []) as unknown as string[];

  return headers.find((candidate) => candidate.startsWith(`${name}=`)) ?? "";
}

/**
 * A name no other run of a suite will produce.
 *
 * Shaped to fit `tenants_slug_format` and `github_orgs_login_format`, which admit only
 * lower-case alphanumerics in single-hyphen-separated groups — so the same helper serves a
 * slug and an organisation login.
 *
 * @param prefix - The suite's own namespace, which its cleanup matches on.
 * @returns The name.
 */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * An address inside a suite's namespace, so its cleanup can find it.
 *
 * @param prefix - The suite's own namespace.
 * @returns The address.
 */
export function uniqueEmail(prefix: string): string {
  return `${uniqueName(prefix)}@example.test`;
}
