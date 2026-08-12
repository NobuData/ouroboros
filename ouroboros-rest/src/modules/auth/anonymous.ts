/**
 * `@AllowAnonymous()`'s metadata key, named once.
 *
 * The decorator is the library's — `@thallesp/nestjs-better-auth` exports it, and
 * [#703](https://github.com/NobuData/ouroboros/issues/703) ported every `@Public()` in this
 * service to it one for one. What the library does *not* export is the key it writes under,
 * and two things here have to read it: `TenantContextGuard`, which must skip a route the
 * authentication guard let through anonymously, and `guard.surface.spec.ts`, which
 * enumerates the exemption across the whole route table.
 *
 * So the key is written down here, once, with the two things that make that safe rather
 * than fragile:
 *
 *   * **It is asserted against the decorator**, in `anonymous.spec.ts`, by applying
 *     `@AllowAnonymous()` and reading the metadata back. A library upgrade that renamed the
 *     key fails there — loudly, in a unit test — rather than silently un-exempting the
 *     health probes.
 *   * **It is read through {@link isAnonymous}**, so the handler-then-class precedence is
 *     decided in one place. That precedence is the one asymmetry worth having in a
 *     decorator that removes authentication: the value is only ever `true`, so an exempt
 *     handler inside a protected controller works and neither can turn the other off.
 *
 * The key itself is `"PUBLIC"` — a bare, un-namespaced string in a metadata space shared
 * with every library in the process. #33's own `IS_PUBLIC` was namespaced
 * (`ouroboros:auth:public`) for exactly that reason, and this is the cost of using the
 * library's decorator rather than keeping a second one: it is the library's key or it is
 * not the library's guard reading it.
 */

import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

/** The metadata key `@AllowAnonymous()` sets. Verified against the decorator in the spec. */
export const ALLOW_ANONYMOUS = "PUBLIC";

/**
 * Is this route reachable without a session?
 *
 * @param reflector - Nest's metadata reader.
 * @param context - The execution context.
 * @returns Whether `@AllowAnonymous()` is on the handler or on its controller. The handler
 *   is read first, so an exempt route inside a protected controller works.
 */
export function isAnonymous(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(ALLOW_ANONYMOUS, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
