/**
 * The one thing in this module that has to be middleware.
 *
 * It opens an empty {@link runWithTenantContext} store and calls the rest of the request
 * inside it. That is all it does — it resolves nothing, reads no header and touches no
 * database, because at the moment it runs there is nobody to resolve a tenant *for*: Nest's
 * pipeline is middleware → guards → interceptors → pipes → handler, and the session guard
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)) has not established a principal
 * yet.
 *
 * So the work is split, and the split is forced rather than chosen: `AsyncLocalStorage.run`
 * needs something to *wrap* the request, and middleware is the only stage that can; the
 * principal only exists after a guard, so `tenant.guard.ts` is the only stage that can fill
 * the store in. See `tenant.context.ts` for the longer version.
 *
 * It is applied to every route, including the public ones. A store nothing writes to costs
 * one object per request and means `currentTenant()` is always a legitimate question with an
 * honest answer, rather than one that throws on the routes somebody forgot to list.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";

import { runWithTenantContext } from "./tenant.context";

/**
 * The part of the pipeline this middleware needs — the callback that continues it.
 *
 * Structural rather than `express.NextFunction`, matching `src/application.ts` and
 * `error.filter.ts`: this module has no opinion about the HTTP adapter, and the one thing
 * it touches is a function it calls with no arguments.
 */
export type ContinueRequest = () => void;

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  /**
   * Open a context and continue.
   *
   * @param _request - Unread. The tenant is resolved by the guard, from a principal that
   *   does not exist yet.
   * @param _response - Unread.
   * @param next - The rest of the request. Called *inside* the store, which is what puts
   *   every continuation it schedules inside it too.
   */
  use(_request: unknown, _response: unknown, next: ContinueRequest): void {
    runWithTenantContext(next);
  }
}
