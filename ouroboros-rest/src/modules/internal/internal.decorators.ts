/**
 * How a route says *this one answers to the engine, not to a browser*.
 *
 * One decorator, and it exists to be **read by something other than the guard it belongs
 * to**. `InternalKeyGuard` is applied to the two internal controllers directly, so it needs
 * no metadata to know what it is protecting; what needs the metadata is
 * `route.table.fixture.ts`, which enumerates every route in the application and sorts each
 * one into *needs a session*, *reachable by anybody*, or *needs the internal key*.
 *
 * Without a third category that enumeration would have to lie. An internal route carries
 * `@AllowAnonymous()` — it must, because the caller is a worker process that holds no
 * session and the global authentication guard would refuse it before its own guard ever ran
 * — and a route listed among the anonymous ones is a route the guard-surface suites assert
 * a stranger can reach. That is exactly what an internal route must *not* be, and the
 * assertion it would break is the one that catches a probe closing. So the metadata is what
 * lets those suites say the true thing about all three groups instead of the convenient
 * thing about two.
 *
 * The key is namespaced, unlike `@AllowAnonymous()`'s bare `"PUBLIC"`, for the reason
 * `TENANT_OPTIONAL` is: `Reflector` metadata is one flat space shared with every library in
 * the process, and this one is ours to name.
 */

import { SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

/** The metadata key {@link InternalOnly} sets. */
export const INTERNAL_ONLY = "ouroboros:internal:only";

/**
 * Mark a route as part of the engine-facing surface.
 *
 * Applied to a controller, so it covers every route on it and a route added beside an
 * existing one inherits the classification rather than having to remember it. It grants
 * nothing by itself: `InternalKeyGuard` is what refuses a request, and this is what lets
 * the route table say which refusal to expect.
 *
 * @returns The decorator.
 */
export const InternalOnly = (): CustomDecorator => SetMetadata(INTERNAL_ONLY, true);

/**
 * Is this route part of the engine-facing surface?
 *
 * @param reflector - Nest's metadata reader.
 * @param context - The execution context.
 * @returns Whether {@link InternalOnly} is on the handler or on its controller. The handler
 *   is read first, matching `isAnonymous`, so the precedence is the same one everywhere in
 *   this service.
 */
export function isInternalOnly(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(INTERNAL_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
