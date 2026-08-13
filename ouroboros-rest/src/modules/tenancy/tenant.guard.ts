/**
 * The guard that gives every request a tenant, or refuses it.
 *
 * Registered globally in `tenancy.module.ts`, **after** the global authentication guard,
 * which is what lets it assume a principal: by the time this runs, either the route is
 * anonymous or there is somebody on the request. Nest applies global guards in the order
 * their modules are initialised, and `AppModule` imports `BetterAuthModule` — which is
 * where [#703](https://github.com/NobuData/ouroboros/issues/703) registers the library's
 * `AuthGuard` — before `TenancyModule` for exactly that reason.
 * `tenancy.module.spec.ts` asserts the consequence rather than trusting the order.
 *
 * It decides nothing itself. `tenant.resolver.ts` holds the rules; this reads the request,
 * asks, and writes the answer into the `AsyncLocalStorage` store the middleware opened —
 * which is what makes `currentTenant()` work several layers below any controller, and is
 * where [#25](https://github.com/NobuData/ouroboros/issues/25)'s
 * `set_config('ouroboros.tenant_id', …)` will attach.
 */

import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { isAnonymous } from "../auth/anonymous";
import { activeOrganizationOf, principalOf, type PrincipalRequest } from "../auth/principal";
import { setTenantContext } from "./tenant.context";
import { TENANT_OPTIONAL } from "./tenant.decorators";
import {
  pathTenantIsMalformed,
  TenantResolver,
  type TenantHeaders,
  type TenantParameters,
} from "./tenant.resolver";

/**
 * The part of a request this guard reads.
 *
 * `params` is populated by the router before any guard runs, which is what makes the
 * `{orgId}` in a path available here rather than only in a handler.
 */
export interface TenantRequest extends PrincipalRequest {
  headers?: TenantHeaders & { cookie?: string };
  params?: TenantParameters;
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  /**
   * @param reflector - How `@AllowAnonymous()` and `@TenantOptional()` are read.
   * @param resolver - Where the rules are.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: TenantResolver,
  ) {}

  /**
   * Establish the tenant context, or refuse the request.
   *
   * @param context - The execution context, read as HTTP.
   * @returns `true` — always, when it returns at all. A guard's `false` is a bare `403` with
   *   no envelope and nothing to act on, so every refusal here is a thrown `DomainError`
   *   that `error.filter.ts` renders like any other failure.
   * @throws {NotFoundError} `404 tenant_not_found` — no such workspace, or none this caller
   *   may know about. The issue's first acceptance criterion, and one answer for both cases.
   * @throws {InvalidRequestError} `422 tenant_mismatch`.
   * @throws {BadRequestError} `400 organization_required` — the session is acting nowhere and
   *   the request named nothing.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isAnonymous(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TenantRequest>();
    const principal = principalOf(request);

    // Unreachable through the pipeline: a route that is not `@AllowAnonymous()` and carries
    // no session was already refused by the authentication guard. Checked anyway, because
    // "the guard before me ran" is an assumption about registration order, and the failure
    // mode if it is ever wrong is a tenant resolved for nobody.
    if (principal === undefined) {
      return true;
    }

    // The person goes into the store even on a route that needs no tenant: `currentUser()`
    // is what scopes the workspace listing, and that listing is exactly a `@TenantOptional()`
    // route. The session's user goes in unchanged — it was adapted into a `users` row until
    // [#714](https://github.com/NobuData/ouroboros/issues/714), and V006 dropped that table.
    const user = principal.user;

    setTenantContext({ user });

    if (this.isExempt(context, TENANT_OPTIONAL)) {
      return true;
    }

    // An `{orgId}` that is not a uuid is a malformed request, not a workspace nobody can
    // see, and the validation pipe owns that complaint — it is what produces the
    // `details.orgId` a form renders. Resolving here first would answer with whichever
    // check ran first, and which one that is would depend on how many workspaces the caller
    // belongs to. The handler is unreachable either way: every route with an `{orgId}`
    // validates it.
    if (pathTenantIsMalformed(request.params)) {
      return true;
    }

    const membership = await this.resolver.resolve({
      userId: user.id,
      // The session's own pointer, which is the primary source since
      // [#713](https://github.com/NobuData/ouroboros/issues/713). It is read here rather than
      // in the resolver because this is the one stage that holds the request: the resolver is
      // given facts, not a request, so a spec can state a session without building one.
      activeOrganizationId: activeOrganizationOf(principal),
      headers: request.headers,
      params: request.params,
    });

    setTenantContext({ membership });

    return true;
  }

  /**
   * Does this route carry the given opt-out?
   *
   * @param context - The execution context.
   * @param key - `TENANT_OPTIONAL`. (`@AllowAnonymous()` is read through `isAnonymous`,
   *   which owns the library's key so that nothing else has to name it.)
   * @returns Whether the handler or its controller is marked. The handler is read first, so
   *   an exempt route inside a scoped controller works — and, because the value is only ever
   *   `true`, neither can turn the other off.
   */
  private isExempt(context: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
