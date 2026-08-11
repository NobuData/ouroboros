/**
 * Who is asking — the one answer every authenticated handler is entitled to, and how it
 * gets there.
 *
 * The session guard resolves it once per request and hangs it on the request object;
 * `@CurrentUser()` reads it back. That indirection buys the thing the epic is heading for:
 * a controller states *that* it needs the caller, and never *how* the caller was
 * established — so when [#32](https://github.com/NobuData/ouroboros/issues/32) adds a
 * tenant to the same request context, and a later issue adds a service principal or an API
 * key, none of the handlers written against this change.
 *
 * The property is a symbol rather than a name. A request object is a bag every piece of
 * middleware in the process can write to, and `request.user` is the single most contended
 * name in that bag — Passport writes it, several logging libraries read it, and a
 * collision there is an authorization decision made from somebody else's object. A symbol
 * this module owns cannot be collided with by anything that does not import it.
 */

import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { User } from "../db/schema";

/** Where the principal is stored on the request. Not a string; see this file's header. */
export const PRINCIPAL = Symbol("ouroboros.principal");

/**
 * The signed-in person, as everything downstream of the guard sees them.
 *
 * The whole `users` row rather than an id, because the row was read to establish the
 * session in the first place (`auth.guard.ts`) and handing back only the id would mean the
 * next thing that wants a display name reads it again.
 */
export interface Principal {
  /** The person, exactly as `ouroboros.users` holds them. */
  readonly user: User;
}

/**
 * A request that may have been through the session guard.
 *
 * Structural rather than `express.Request`, matching `src/application.ts` and
 * `error.filter.ts`: this module has no opinion about the HTTP adapter, and naming the two
 * things it touches is both the documentation and the whole of the coupling.
 */
export interface PrincipalRequest {
  /** The request's headers, as the adapter parsed them. `cookie` is the one that is read. */
  headers?: { cookie?: string };
  /** The principal, once a guard has established one. */
  [PRINCIPAL]?: Principal;
}

/**
 * Record who a request is from.
 *
 * @param request - The request being handled.
 * @param principal - Who established it.
 */
export function attachPrincipal(request: PrincipalRequest, principal: Principal): void {
  request[PRINCIPAL] = principal;
}

/**
 * Read who a request is from.
 *
 * @param request - The request being handled.
 * @returns The principal, or `undefined` on a route the guard let through as public.
 */
export function principalOf(request: PrincipalRequest): Principal | undefined {
  return request[PRINCIPAL];
}

/**
 * `@CurrentUser()` — the signed-in person, as a handler parameter.
 *
 * Reaches the same request the guard wrote to, so a handler carrying this decorator is
 * guaranteed a principal by the guard having run: every route is authenticated unless it
 * is `@Public()`, and a `@Public()` route asking for the caller is asking for something
 * that may not exist.
 *
 * ```ts
 * @Get("me")
 * read(@CurrentUser() user: User): Promise<SessionResource> {
 *   return this.auth.describe(user);
 * }
 * ```
 *
 * @throws {Error} If no principal was established — which means the decorator is on a
 *   `@Public()` route. That is a programming mistake rather than a request's, and it fails
 *   loudly here instead of handing a handler `undefined` typed as a `User`, which is how a
 *   nullable principal becomes a `500` three layers down or, worse, a query filtered by
 *   `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    const principal = principalOf(request);

    if (principal === undefined) {
      throw new Error(
        "@CurrentUser() was read on a route with no principal. Remove @Public() from the handler, " +
          "or stop asking for the caller on a route that does not have one.",
      );
    }

    return principal.user;
  },
);
