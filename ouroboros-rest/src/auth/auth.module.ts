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
 * **The library's `AuthGuard` is this application's global authentication guard**, and
 * [#703](https://github.com/NobuData/ouroboros/issues/703) is what turned it on: until then
 * this service ran [#33](https://github.com/NobuData/ouroboros/issues/33)'s `SessionGuard`
 * over its own cookie, and two global guards would have meant every request satisfying
 * both, which no caller could do until the sessions were the same sessions. They are now.
 * Every route is authenticated unless it carries `@AllowAnonymous()`, and
 * `src/modules/auth/guard.surface.spec.ts` enumerates the guard's decision for every route
 * in the table rather than trusting this paragraph.
 *
 * **It is registered by this module rather than by the library's, and that is about
 * order.** The library will register it for itself — the `disableGlobalAuthGuard` extra
 * below is what declines the offer — but it would do so from the dynamic module *inside*
 * this one, which Nest's scanner reaches a level later than `AppModule`'s own imports. The
 * observable consequence is not subtle: `TenancyModule`'s `TenantContextGuard` and
 * `RolesGuard` would run **before** anybody had been authenticated, and `@Roles()` on a
 * route reached with no tenant context is a `500` rather than the `401` it should have
 * been. Registered here, the guard is a provider of a module `AppModule.forRoot` imports
 * *first*, so it is the first global guard in the chain. `tenancy.module.spec.ts` asserts
 * the consequence rather than the arrangement.
 *
 * That is the whole of the change: the class is the library's, unwrapped and unsubclassed,
 * and this module says only *when* it runs.
 *
 * One default is still turned off for a different reason, and it is not a preference:
 *
 *   * **Its CORS.** Given `trustedOrigins`, the library calls `enableCors` on the adapter
 *     for itself. This service already answers that question in one place — see
 *     `permitBrowserOrigins` in `src/application.ts` — over the same list, since
 *     `authOptions` sets `trustedOrigins` from `OURO_CORS_ORIGINS`. A second policy would
 *     be the same origins with different allowed headers and a different verb list,
 *     applied by whichever middleware Express reached first.
 */

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard, AuthModule as NestBetterAuth } from "@thallesp/nestjs-better-auth";

import { AppConfigService } from "../modules/config/config.service";
import { DbModule } from "../modules/db/db.module";
import { DatabaseService } from "../modules/db/db.service";
import { createAuth, type Auth } from "./auth.factory";

/**
 * How large a JSON request body this service will read.
 *
 * **`express.json()`'s own default is 100 kB, and it is too small for one thing this API
 * stores: a workflow definition.** The DSL bounds a document at 200 nodes and each model
 * stage's `prompt_template` at 20 000 characters (`workflows/dsl.schema.ts`), so a document
 * the validator *accepts* can be four megabytes of JSON — and a draft autosave carrying one
 * would be refused by the parser before any handler saw it
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)). Even mockup 04's twelve-node
 * canvas goes past 100 kB once its prompts are real. A limit that refuses what the grammar
 * admits is a limit that makes the grammar a lie.
 *
 * So it is sized from that ceiling rather than guessed at, with room for the structure around
 * the prompts — titles, descriptions, positions, edges — and for JSON's own escaping.
 *
 * **It is deliberately one number for the whole service.** The parser runs ahead of Nest's
 * router, so a per-route limit would have to be a second parser racing the first, and which
 * one won would depend on the order two modules happened to register middleware. What this
 * widens is the bytes an unauthenticated caller can make this process buffer; **rate limiting
 * and the rest of the hardening review are
 * [#38](https://github.com/NobuData/ouroboros/issues/38)'s**, and a body above this limit is a
 * `413 payload_too_large` with no handler reached (`errors/error.filter.ts`).
 */
export const REQUEST_BODY_LIMIT = "8mb";

/** What {@link betterAuthOptions} hands the library. */
export interface BetterAuthOptions {
  /** The instance whose routes are served. */
  readonly auth: Auth;
  /** Whether the library applies a CORS policy of its own — never; see {@link betterAuthOptions}. */
  readonly disableTrustedOriginsCors: true;
  /** The parser the library re-adds for every path outside `/api/auth` — see {@link REQUEST_BODY_LIMIT}. */
  readonly bodyParser: { readonly json: { readonly limit: string } };
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
 * @returns The instance, the one default this module turns off, and the body-parser limit in
 *   the injected options. (The global guard is an "extra" and is declined below — the
 *   library's own distinction: extras build the provider list rather than reaching the
 *   module.)
 */
export function betterAuthOptions(
  config: AppConfigService,
  database: DatabaseService,
): BetterAuthOptions {
  return {
    auth: createAuth({ configuration: config.all, pool: database.pool }),
    disableTrustedOriginsCors: true,
    // `application.ts` turns Nest's own parser off so BetterAuth can sign the bytes it was
    // sent; the library re-adds `express.json()` for every other path, and this is the one
    // option this service has about it.
    bodyParser: { json: { limit: REQUEST_BODY_LIMIT } },
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
  // Declined so that this module can register the same class itself, one level up, where
  // it lands ahead of the tenancy guards. See this file's header — the reason is guard
  // order, not a difference of opinion about the guard.
  disableGlobalAuthGuard: true,
});

@Module({
  imports: [betterAuth],
  // The library's own guard class, registered as *this* module's global guard. `APP_GUARD`
  // is Nest's token for "run this before every handler in the application"; it resolves
  // `Reflector` and the library's options from the module above, both of which the
  // dynamic module exports globally.
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  // Re-exported so `AuthService` — the library's typed access to `auth.api` — is injectable
  // wherever this module is imported. `AuthController.logout` is the first caller: signing
  // out is `auth.api.signOut`, which deletes the session row. (The library's module is
  // global as well, so the re-export is belt and braces — but a module that has to be
  // re-imported to reach the provider it exists to wire is the shape that gets copied
  // instead of imported.)
  exports: [betterAuth],
})
export class BetterAuthModule {}
