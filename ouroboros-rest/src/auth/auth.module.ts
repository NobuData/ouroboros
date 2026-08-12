/**
 * BetterAuth, mounted — the Nest half of `src/auth/`
 * ([#701](https://github.com/NobuData/ouroboros/issues/701)).
 *
 * It is the one file under this directory that imports `@nestjs/*`, and that is the split
 * the directory is organised around: `auth.options.ts`, `auth.factory.ts` and
 * `auth.config.ts` are loadable by `@better-auth/cli` with no application anywhere, which
 * is how [#706](https://github.com/NobuData/ouroboros/issues/706) generates the Flyway
 * migration. This one is the opposite — it exists only inside a running Nest — and keeping
 * it separate is what stops the CLI's import graph from reaching an injector.
 *
 * What the library's module actually does, since none of it is a route declaration:
 *
 *   * **Registers one handler on the HTTP adapter**, ahead of Nest's router, matching
 *     `/api/auth` and everything under it. That is why those paths escape the `/api/v1`
 *     prefix and URI versioning without an exemption — they never reach the routing table
 *     the two are applied to. `auth.routes.ts` states the exclusion anyway; see there.
 *   * **Re-adds the JSON and URL-encoded body parsers** for every route that is *not* an
 *     auth route. `src/application.ts` boots with Nest's own parsers switched off, because
 *     BetterAuth signs what it reads and a body already parsed into an object is a body it
 *     cannot verify. The regression surface that creates — every other endpoint in the
 *     service — is what `application.spec.ts` covers.
 *
 * Two of its defaults are turned off here, and neither is a preference:
 *
 *   * **Its global guard.** The library registers an `APP_GUARD` that requires a BetterAuth
 *     session on every route. This service already has one — `SessionGuard`, from
 *     [#33](https://github.com/NobuData/ouroboros/issues/33) — reading the cookie that is
 *     still what signs people in. Two global guards would mean every request had to satisfy
 *     both, which no caller can do until the sessions are the same sessions.
 *     [#703](https://github.com/NobuData/ouroboros/issues/703) is the issue that swaps
 *     them, and it is the issue that deletes this flag.
 *   * **Its CORS.** Given `trustedOrigins`, the library calls `enableCors` on the adapter
 *     for itself. This service already answers that question in one place — see
 *     `permitBrowserOrigins` in `src/application.ts` — over the same list, since
 *     `authOptions` sets `trustedOrigins` from `OURO_CORS_ORIGINS`. A second policy would
 *     be the same origins with different allowed headers and a different verb list,
 *     applied by whichever middleware Express reached first.
 */

import { Module } from "@nestjs/common";
import { AuthModule as NestBetterAuth } from "@thallesp/nestjs-better-auth";

import { AppConfigService } from "../modules/config/config.service";
import { DbModule } from "../modules/db/db.module";
import { DatabaseService } from "../modules/db/db.service";
import { createAuth, type Auth } from "./auth.factory";

/** What {@link betterAuthOptions} hands the library. */
export interface BetterAuthOptions {
  /** The instance whose routes are served. */
  readonly auth: Auth;
  /** Whether the library applies a CORS policy of its own — never; see {@link betterAuthOptions}. */
  readonly disableTrustedOriginsCors: true;
}

/**
 * Build the options the library's module is configured with.
 *
 * Exported because it is the half of this module that can be asserted about. The CORS
 * decision below is invisible from outside a running application — the two policies would
 * name the same origins, since `authOptions` sets `trustedOrigins` from the same
 * `OURO_CORS_ORIGINS` — so the place to hold it is here, where it is made.
 *
 * @param config - The validated configuration, as every other module reads it.
 * @param database - The pool owner. Its `pool` is passed rather than a connection string,
 *   so BetterAuth's adapter issues its statements over the connections `DbModule` already
 *   opened and `DatabaseService.end` already drains — one pool, one drain, one row in
 *   `pg_stat_activity`.
 * @returns The instance, and the one default this module turns off in the injected
 *   options. (The other, the global guard, is an "extra" and is set below — the library's
 *   own distinction: extras build the provider list rather than reaching the module.)
 */
export function betterAuthOptions(
  config: AppConfigService,
  database: DatabaseService,
): BetterAuthOptions {
  return {
    auth: createAuth({ configuration: config.all, pool: database.pool }),
    disableTrustedOriginsCors: true,
  };
}

/**
 * The library's module, configured against this service's instance.
 *
 * `forRootAsync` rather than `forRoot` because the instance cannot be built until the
 * configuration is validated and the pool exists — the two things `createAuth` takes. A
 * `forRoot` would need a module-level instance built at import time, which is the second
 * pool `auth.options.ts` exists to prevent.
 */
const betterAuth = NestBetterAuth.forRootAsync({
  // `DbModule` for `DatabaseService`; the configuration module is global, so
  // `AppConfigService` needs no import to be injectable.
  imports: [DbModule],
  inject: [AppConfigService, DatabaseService],
  useFactory: betterAuthOptions,
  disableGlobalAuthGuard: true,
});

@Module({
  imports: [betterAuth],
  // Re-exported so `AuthService` — the library's typed access to `auth.api` — is injectable
  // wherever this module is imported. Nothing needs it yet; #703's guard is the first, and
  // a module that has to be re-imported to reach the provider it exists to wire is the
  // shape that gets copied instead of imported.
  exports: [betterAuth],
})
export class BetterAuthModule {}
