/**
 * `@AllowHeldAccount()` — a route a held account may still reach (account approval).
 *
 * The global guard (`auth/session-or-service.guard.ts`) refuses a signed-in person whose account
 * is not effectively approved with `403 account_pending_approval` or `account_denied`, on every
 * route — the same polarity `@AllowAnonymous()` and `@TenantOptional()` have, so a route added
 * later is closed to strangers because somebody wrote a controller, not because they remembered
 * a decorator.
 *
 * The exceptions are enumerated, and there is one: **`GET /api/v1/account/status`**, which the
 * waiting page reads to say *waiting* or *not approved*. BetterAuth's own `/api/auth/*` routes
 * (get-session, sign-out) never reach Nest's guards, and `@AllowAnonymous()` routes are left
 * alone, so a held person can always read their session and sign out.
 */

import { SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

/** The metadata key `@AllowHeldAccount()` sets. Namespaced, as `TENANT_OPTIONAL` is. */
export const ALLOW_HELD_ACCOUNT = "ouroboros:auth:allow-held-account";

/**
 * Mark a route as reachable by a signed-in person whose account is pending or denied.
 *
 * @returns The decorator. Applied to a class it covers every route in it; the guard reads the
 *   handler first.
 */
export const AllowHeldAccount = (): CustomDecorator => SetMetadata(ALLOW_HELD_ACCOUNT, true);

/**
 * Whether the route is `@AllowHeldAccount()`.
 *
 * @param reflector - The reflector.
 * @param context - The request.
 * @returns `true` when a held account may reach it.
 */
export function allowsHeldAccount(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(ALLOW_HELD_ACCOUNT, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
