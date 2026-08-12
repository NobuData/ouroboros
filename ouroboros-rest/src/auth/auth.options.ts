/**
 * What BetterAuth is configured with — the whole of the policy, as one plain object.
 *
 * `docs/ROADMAP_MOCKUP_01_BETTERAUTH.md` decision **A1** puts BetterAuth inside
 * `ouroboros-rest` rather than beside it, which means the library's options are this
 * service's options and belong with the rest of its configuration rather than inside a
 * provider. Three things about this file are decisions rather than habit:
 *
 *   * **It imports nothing from NestJS.** The configuration has two callers that could
 *     not be less alike — the application at boot, and `@better-auth/cli` at a terminal
 *     with no Nest process anywhere ([#706](https://github.com/NobuData/ouroboros/issues/706)
 *     generates the Flyway migration that way). A module that reached for an injector
 *     would be loadable by exactly one of them, and the schema would then be hand-written
 *     from documentation, which is how drift starts.
 *   * **It imports nothing from `better-auth` at run time either.** `BetterAuthOptions`
 *     arrives through `import type`, which the compiler erases — so this module is plain
 *     data with no dependency to load, and the suite that covers it needs no ESM loader to
 *     do so. `auth.factory.ts` is where the library is actually reached for.
 *   * **It creates nothing.** Every resource it needs is a parameter, the connection pool
 *     above all ({@link AuthDependencies}). That is what makes "the adapter shares the
 *     `DbModule` pool" a property of the type rather than a promise in a comment: there is
 *     no code path here that could open a second one.
 *
 * @see auth.factory.ts — the same options, handed to `betterAuth()`.
 * @see auth.config.ts — the standalone instance `@better-auth/cli` loads.
 */

import type { BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";

import type { Configuration } from "../modules/config/configuration";
import { activeOrganizationHooks } from "./active.organization";
import { ACCOUNT_LINKING, GITHUB_PROVIDER_ID, githubProvider } from "./github.provider";
import { passwordProvider } from "./password.provider";
import { sessionOptions } from "./session.options";

/**
 * Where BetterAuth's own routes are mounted.
 *
 * The library's default, restated because it is a value two other things have to agree
 * with: [#701](https://github.com/NobuData/ouroboros/issues/701) excludes exactly this
 * prefix from the `/api/v1` global prefix, and `ouroboros-ui`'s BetterAuth client calls
 * it. It sits under `/api` beside the versioned surface rather than inside it, because
 * the library versions its own routes and a second version number in the path would be a
 * promise this service cannot keep.
 */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The application name BetterAuth reports as its own.
 *
 * Read for the OAuth consent screens and for the library's telemetry payload — which is
 * off, see {@link authOptions} — and worth setting so that neither says "Better Auth".
 */
export const AUTH_APP_NAME = "Ouroboros";

/**
 * Everything {@link authOptions} needs and cannot make for itself.
 *
 * Both fields are supplied by the caller rather than read from the environment, so that
 * the Nest application and the CLI can differ in exactly the way they have to — the
 * application passes the pool `DbModule` already owns, the CLI opens one for the length
 * of a command — and in no other way.
 */
export interface AuthDependencies {
  /** The validated configuration, from `loadConfiguration`. */
  readonly configuration: Configuration;
  /**
   * The connection pool BetterAuth issues its statements over.
   *
   * **The service's own pool**, in a running application: `DatabaseService.pool`, the one
   * `src/modules/db/pool.ts` bounds and `DatabaseService.end` drains. A second pool would
   * mean two sets of connections against one `max_connections`, two things to drain on
   * `SIGTERM`, and a `pg_stat_activity` in which "who is holding these connections" has
   * two answers.
   *
   * It also carries the `search_path` that decides *which schema* BetterAuth's tables are
   * found in. The adapter generates unqualified statements — `from "user"` — and
   * `poolOptions` connects with `-c search_path=ouroboros,public`, so they resolve to the
   * Flyway-owned schema without the library being taught about it (roadmap decision
   * **A4**).
   */
  readonly pool: Pool;
}

/**
 * BetterAuth's options for this service.
 *
 * What is deliberately *absent* is as much of the specification as what is here: an option
 * added ahead of the issue that owns it would be a route this service serves that nothing
 * tests, and `auth.options.spec.ts` pins the whole surface for exactly that reason.
 *
 * [#702](https://github.com/NobuData/ouroboros/issues/702) added the two it does own: the
 * GitHub provider, and the account-linking policy that exists because of it. Both live in
 * `github.provider.ts`, with the arguments for every value in them.
 * [#703](https://github.com/NobuData/ouroboros/issues/703) added the third, the session
 * strategy, which lives in `session.options.ts` for the same reason.
 * [#704](https://github.com/NobuData/ouroboros/issues/704) added the fourth, the session
 * hook that resolves the active organization, which lives in `active.organization.ts`.
 * [#705](https://github.com/NobuData/ouroboros/issues/705) added the fifth, the development
 * email/password sign-in, which lives in `password.provider.ts` — and which is the one
 * option here whose *value* depends on the environment rather than only its contents.
 *
 * **The organization plugin itself is not here**, and that is not an omission: `plugins`
 * takes values built by `better-auth`, and this module names no value from that library.
 * `auth.factory.ts` registers it, from the options `organization.plugin.ts` decides.
 *
 * @param dependencies - The configuration and the pool — see {@link AuthDependencies}.
 * @returns The options object, ready for `betterAuth()`. A fresh object each call: the
 *   caller owns it, and a shared literal would let one caller's plugin list reach another.
 */
export function authOptions({ configuration, pool }: AuthDependencies): BetterAuthOptions {
  return {
    appName: AUTH_APP_NAME,

    // The origin BetterAuth builds its callback and redirect URLs from, and the path it
    // serves them under. Both are stated rather than inferred: left unset, the library
    // reads `BETTER_AUTH_URL` from the process environment itself — an environment this
    // service has already validated, and reading it twice is how the two could disagree.
    baseURL: configuration.betterAuthUrl,
    basePath: AUTH_BASE_PATH,

    // Signs sessions and encrypts the OAuth tokens the `account` table holds. Passed for
    // the same reason as the URL above, and redacted from every log by
    // `src/modules/config/redaction.ts`.
    secret: configuration.betterAuthSecret,

    // **Continue with GitHub** — mockup 01's primary action, and the only way into a
    // production deployment of this service. The provider is keyed by the id that
    // is also its callback path segment and its `account.providerId` value, so registering
    // the OAuth App against `${BETTER_AUTH_URL}/api/auth/callback/github` and finding a
    // back-filled identity are the same string agreeing with itself. See
    // `github.provider.ts` for the scopes, the profile mapping and why they are stated
    // rather than inherited.
    socialProviders: { [GITHUB_PROVIDER_ID]: githubProvider(configuration) },

    // The way in that does not involve github.com — decision **A8**, and #705's. It is
    // enabled by `NODE_ENV !== "production"` and by nothing else, so the off position is
    // what a deployment inherits: `ouroboros-rest`'s image pins `NODE_ENV=production` in the
    // image itself. It replaces #33's dev-user bypass, whose variable #705 deleted from
    // every file it appeared in — a password is a way *through* authentication, where that
    // variable was a way around it. See `password.provider.ts` for that argument in full,
    // for what "disabled" actually answers, and for why the key is present-and-false in
    // production rather than absent.
    emailAndPassword: passwordProvider(configuration),

    // How long a sign-in lasts, when using it renews it, and how the per-request cost of
    // asking is kept to nothing. Decision **A6**: the session is a row in
    // `ouroboros.session`, so signing out is a `delete` and revocation is immediate — the
    // property #33's stateless cookie wrote down that it could not offer. Every number is
    // in `session.options.ts` with the argument for it.
    session: sessionOptions(),

    // When an arriving GitHub account is somebody already in the database. It is an
    // `account`-level option rather than a provider-level one — it governs every provider
    // there will ever be — but the policy exists because of this one, so it is argued for
    // beside it.
    account: { accountLinking: ACCOUNT_LINKING },

    // Where a new session starts out acting, and the personal organization that gives it
    // somewhere to be — decision **A5**, and #704's. It is a root option rather than one of
    // the organization plugin's because the library puts session hooks here; the plugin
    // itself is registered in `auth.factory.ts`, and everything it decides is in
    // `organization.plugin.ts`. See `active.organization.ts` for why the rule hangs off
    // session creation rather than user creation — in short, because `V004`'s back-filled
    // people were never *created* by a sign-in and would otherwise never get one.
    databaseHooks: activeOrganizationHooks(),

    // Decision **A2**: the built-in Kysely adapter, over the pool the service already has.
    // A `pg` pool given directly is how BetterAuth is told to build that adapter itself —
    // so the library's Kysely and this service's Kysely stay separate objects sharing one
    // set of connections, which is what keeps `WithSchemaPlugin`, the query logger and the
    // typed `Database` interface a matter for `DbModule` alone.
    database: pool,

    // Which browser origins may complete a sign-in. `OURO_CORS_ORIGINS` is already the
    // answer to "which origins may call this API with credentials", validated as origins
    // and never a wildcard (`src/modules/config/configuration.ts`), and a second list
    // would be the same question answered twice. Spread because BetterAuth's option type
    // asks for a mutable array; the configuration's own copy stays frozen.
    trustedOrigins: [...configuration.corsOrigins],

    // Off, and said out loud. BetterAuth's telemetry is opt-in and would stay off by
    // omission — but a boundary service that phones home is a decision, and a decision
    // this service has made is written down where somebody can read it. (The library also
    // honours `BETTER_AUTH_TELEMETRY` in the environment, which this cannot override; the
    // template declares no such variable.)
    telemetry: { enabled: false },
  };
}
