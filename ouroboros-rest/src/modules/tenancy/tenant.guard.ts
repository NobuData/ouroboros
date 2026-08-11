/**
 * The guard that gives every request a tenant, or refuses it.
 *
 * Registered globally in `tenancy.module.ts`, **after**
 * [#33](https://github.com/NobuData/ouroboros/issues/33)'s session guard, which is what
 * lets it assume a principal: by the time this runs, either the route is public or there is
 * somebody on the request. Nest applies global guards in the order their modules are
 * initialised, and `AppModule` imports `AuthModule` before `TenancyModule` for exactly that
 * reason — `tenancy.module.spec.ts` asserts the consequence rather than trusting the order.
 *
 * It decides nothing itself. `tenant.resolver.ts` holds the rules; this reads the request,
 * asks, and writes the answer into the `AsyncLocalStorage` store the middleware opened —
 * which is what makes `currentTenant()` work several layers below any controller, and is
 * where [#25](https://github.com/NobuData/ouroboros/issues/25)'s
 * `set_config('ouroboros.tenant_id', …)` will attach.
 */

import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC } from "../auth/public.decorator";
import { principalOf, type PrincipalRequest } from "../auth/principal";
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
 * `{tenantId}` in a path available here rather than only in a handler.
 */
export interface TenantRequest extends PrincipalRequest {
  headers?: TenantHeaders & { cookie?: string };
  params?: TenantParameters;
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  /**
   * @param reflector - How `@Public()` and `@TenantOptional()` are read.
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
   * @throws {NotFoundError} `404 tenant_not_found` — no such tenant, or none this caller may
   *   know about. The issue's first acceptance criterion, and one answer for both cases.
   * @throws {InvalidRequestError} `422 tenant_required` or `422 tenant_mismatch`.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isExempt(context, IS_PUBLIC)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TenantRequest>();
    const principal = principalOf(request);

    // Unreachable through the pipeline: a non-public route without a principal was already
    // refused by the session guard. Checked anyway, because "the guard before me ran" is an
    // assumption about registration order, and the failure mode if it is ever wrong is a
    // tenant resolved for nobody.
    if (principal === undefined) {
      return true;
    }

    // The person goes into the store even on a route that needs no tenant: `currentUser()`
    // is what scopes the tenant listing, and that listing is exactly a `@TenantOptional()`
    // route.
    setTenantContext({ user: principal.user });

    if (this.isExempt(context, TENANT_OPTIONAL)) {
      return true;
    }

    // A `{tenantId}` that is not a uuid is a malformed request, not a workspace nobody can
    // see, and the validation pipe owns that complaint — it is what produces the
    // `details.tenantId` a form renders. Resolving here first would answer with whichever
    // check ran first, and which one that is would depend on how many workspaces the caller
    // belongs to. The handler is unreachable either way: every route with a `{tenantId}`
    // validates it.
    if (pathTenantIsMalformed(request.params)) {
      return true;
    }

    const membership = await this.resolver.resolve(principal.user, request.headers, request.params);

    setTenantContext({ membership });

    return true;
  }

  /**
   * Does this route carry the given opt-out?
   *
   * @param context - The execution context.
   * @param key - `IS_PUBLIC` or `TENANT_OPTIONAL`.
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
