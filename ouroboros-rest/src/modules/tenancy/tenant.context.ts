/**
 * The tenant a request is operating in, available anywhere without being passed anywhere.
 *
 * The issue's third acceptance criterion is *context available in services without passing
 * parameters through*, and `AsyncLocalStorage` is what makes that true: a store is opened
 * for each request by `tenant.middleware.ts`, filled in by `tenant.guard.ts`, and read by
 * {@link currentTenant} and {@link currentMember} from any depth of call stack — including
 * from code that never saw the request.
 *
 * Two halves, because neither can do the other's job:
 *
 *   * **Only middleware can open the store.** `AsyncLocalStorage.run` takes a callback and
 *     the store exists for its duration, so something has to *wrap* the rest of the
 *     request. Middleware is the one place in Nest's pipeline that does. (`enterWith` would
 *     avoid the callback and is the wrong tool: it leaks the store into whatever async
 *     resource happened to be running, which is a request's context escaping into the
 *     next.)
 *   * **Only a guard can fill it in.** Middleware runs *before* guards, so at the moment
 *     the store is opened there is no principal yet —
 *     [#33](https://github.com/NobuData/ouroboros/issues/33)'s session guard has not run.
 *     The tenant guard runs after it, and writes what it resolved into the store the
 *     middleware opened.
 *
 * **Ambient context is a loaded gun, and this one is loaded deliberately.** A service that
 * reads `currentTenant()` has a dependency the compiler cannot see and a test has to
 * remember. So the rule in this module is narrow: repositories and services take their
 * `tenantId` as a parameter, exactly as they did before this file existed, and the ambient
 * form exists for the two cases where threading a parameter is the *problem* rather than
 * the solution — the caller-scoped tenant listing (`tenants.service.ts`), and the
 * `set_config('ouroboros.tenant_id', …)` that [#25](https://github.com/NobuData/ouroboros/issues/25)
 * will set on a connection nothing in the call chain is holding.
 *
 * That last one is why this is `AsyncLocalStorage` rather than a property on the request.
 * A row-level-security GUC has to be set on the connection a query is about to use, by code
 * several layers below any controller, and passing a tenant id from a controller down
 * through every repository to get there would be the "re-implemented per controller" this
 * issue exists to prevent.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { Tenant, TenantRole, User } from "../db/schema";

/**
 * The membership that authorized this request, joined to the person holding it.
 *
 * `MemberRow` (`resources.ts`) is the same join, and this is deliberately not that type:
 * that one describes what a *listing* selects and is rendered into a resource, and this
 * describes what an authorization decision is made from. They will drift, and when they do
 * the drift should be free.
 */
export interface ActiveMembership {
  /** The tenant. */
  readonly tenant: Tenant;
  /** What this person may do in it. */
  readonly role: TenantRole;
}

/** Everything one request knows about who it is and where. */
export interface TenantContextStore {
  /** The signed-in person, from the session guard. */
  user?: User;
  /** The tenant this request is operating in, and the role that lets it. */
  membership?: ActiveMembership;
}

/**
 * The store itself.
 *
 * A module-level singleton, which is what an `AsyncLocalStorage` has to be: two instances
 * are two unrelated stores, and a provider would give one per module instantiation. Nothing
 * outside this file touches it — the four functions below are the whole surface.
 */
const storage = new AsyncLocalStorage<TenantContextStore>();

/**
 * Open a context for the duration of `work`.
 *
 * @param work - The rest of the request. Everything it awaits, however deep, reads the same
 *   store.
 * @returns Whatever `work` returned.
 */
export function runWithTenantContext<T>(work: () => T): T {
  return storage.run({}, work);
}

/**
 * The current request's store, if there is one.
 *
 * @returns The store, or `undefined` outside a request — which is what a background job, a
 *   shutdown hook, or a unit test that did not open one looks like.
 */
export function tenantContext(): TenantContextStore | undefined {
  return storage.getStore();
}

/**
 * Record who this request is from and where it is operating.
 *
 * @param values - The fields to set. Merged rather than replaced, so the guard can write
 *   the user and the membership in one call or two.
 * @returns Nothing. Called outside a request it does nothing at all, deliberately: the
 *   alternative is a guard that throws during a test that did not open a context, which
 *   would make the store's absence a failure rather than an honest "no context here".
 */
export function setTenantContext(values: TenantContextStore): void {
  const store = tenantContext();

  if (store === undefined) {
    return;
  }

  Object.assign(store, values);
}

/**
 * The tenant this request is operating in.
 *
 * @returns The tenant, or `undefined` on a route that needs none — see `@TenantOptional()`.
 */
export function currentTenant(): Tenant | undefined {
  return tenantContext()?.membership?.tenant;
}

/**
 * The membership that authorized this request.
 *
 * @returns The tenant and the role, or `undefined` on a route that needs no tenant.
 */
export function currentMembership(): ActiveMembership | undefined {
  return tenantContext()?.membership;
}

/**
 * The signed-in person.
 *
 * @returns The user, or `undefined` on a `@Public()` route.
 */
export function currentUser(): User | undefined {
  return tenantContext()?.user;
}
