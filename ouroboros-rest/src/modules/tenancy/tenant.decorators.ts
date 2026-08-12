/**
 * How a handler asks for the tenant context, and how it opts out of needing one.
 *
 * Three decorators, and the asymmetry between them is deliberate. `@CurrentTenant()` and
 * `@CurrentMember()` *read* what the guard established, so they can assume it exists — a
 * handler that asks for the tenant is on a route that requires one. `@TenantOptional()`
 * *changes* what the guard requires, so it is the one that has to be justified wherever it
 * appears.
 */

import {
  createParamDecorator,
  SetMetadata,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";

import type { Tenant } from "../db/schema";
import { currentMembership, type ActiveMembership } from "./tenant.context";

/**
 * The metadata key `@TenantOptional()` sets.
 *
 * Namespaced, unlike the library's own `@AllowAnonymous()` key, and for the reason #33's `IS_PUBLIC` was: `Reflector` metadata is one flat space shared
 * with every library in the process.
 */
export const TENANT_OPTIONAL = "ouroboros:tenancy:optional";

/**
 * Mark a route as reachable without an active tenant.
 *
 * **Every authenticated route requires one unless it says this**, the same polarity
 * `@AllowAnonymous()` has and for the same reason: a route added later is scoped because somebody
 * wrote a controller, not because they remembered a decorator.
 *
 * The exceptions are enumerated, and each one is a question a workspace is not part of the
 * answer to:
 *
 *   * **`GET /api/v1/tenants`** — which workspaces this person belongs to. Asking them to
 *     name one first would be circular. The listing is scoped to them instead, so it is not
 *     a way around the rule.
 *   * **`POST /api/v1/tenants`** — creating the first one. Somebody who belongs to nothing
 *     yet has no tenant to be in.
 *   * **`GET /api/v1/auth/me`** — who is signed in. Its whole answer is the memberships a
 *     tenant would have had to be resolved from.
 *   * **`GET /api/v1/engine/status`** — whether `ouroboros-engine` is reachable and which
 *     build it is ([#35](https://github.com/NobuData/ouroboros/issues/35)). There is one
 *     engine behind every workspace, so naming one changes nothing about the answer. It is
 *     the first exception that is about the *installation* rather than the person, and it
 *     is still an exception rather than a category: a route that reads or writes anything
 *     belonging to a customer is scoped, whoever is asking.
 *
 * @returns The decorator. Applied to a class it covers every route in it; the guard reads
 *   the handler first.
 */
export const TenantOptional = (): CustomDecorator => SetMetadata(TENANT_OPTIONAL, true);

/**
 * `@CurrentTenant()` — the tenant this request is operating in, as a handler parameter.
 *
 * ```ts
 * @Get("members")
 * list(@CurrentTenant() tenant: Tenant): Promise<Page<MemberResource>> { … }
 * ```
 *
 * @throws {Error} If no tenant was established — which means the decorator is on a
 *   `@TenantOptional()` or `@AllowAnonymous()` route. A programming mistake rather than a request's,
 *   and it fails loudly here rather than handing a handler `undefined` typed as a `Tenant`,
 *   which is how a query ends up filtered by nothing at all.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): Tenant => requireMembership().tenant,
);

/**
 * `@CurrentMember()` — the membership that authorized this request.
 *
 * The tenant *and* the role, for a handler whose answer depends on what the caller may do
 * rather than only on which workspace they are in.
 *
 * @throws {Error} On a route with no tenant, exactly as {@link CurrentTenant} does.
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): ActiveMembership => requireMembership(),
);

/**
 * The membership, or a loud failure.
 *
 * Read from the `AsyncLocalStorage` context rather than from the execution context's
 * request, so that the decorators and the services that call `currentTenant()` are reading
 * one thing. Two sources for the same fact is two things to keep in step.
 *
 * @returns The active membership.
 * @throws {Error} When there is none.
 */
function requireMembership(): ActiveMembership {
  const membership = currentMembership();

  if (membership === undefined) {
    throw new Error(
      "@CurrentTenant()/@CurrentMember() was read on a route with no tenant context. Remove " +
        "@TenantOptional() from the handler, or stop asking for a tenant on a route that " +
        "does not have one.",
    );
  }

  return membership;
}
