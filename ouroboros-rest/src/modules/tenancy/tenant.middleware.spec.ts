import {
  currentUser,
  setTenantContext,
  tenantContext,
  type TenantContextStore,
} from "./tenant.context";
import { TenantContextMiddleware } from "./tenant.middleware";

/**
 * Four lines of code and one property: what runs after `next()` is inside a store.
 *
 * It is worth a file because the alternative — `enterWith`, or resolving the tenant here —
 * looks equivalent and is not, and because the failure mode if this ever stops wrapping is
 * silent: every `currentTenant()` in the service starts answering `undefined`, and every
 * route that needs one starts answering `422`.
 */

describe("the tenant context middleware", () => {
  const middleware = new TenantContextMiddleware();

  it("opens a store for the rest of the request", () => {
    middleware.use(undefined, undefined, () => {
      expect(tenantContext()).toEqual({});
    });
  });

  it("opens a store the guard can write to", () => {
    // The division of labour: this cannot resolve anything, because it runs before the
    // session guard and there is nobody to resolve a tenant for yet.
    middleware.use(undefined, undefined, () => {
      setTenantContext({
        user: {
          id: "5eed0003-0000-4000-8000-000000000001",
          email: "ken@acme-robotics.dev",
          display_name: "Ken Suenobu",
          avatar_url: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      expect(currentUser()?.email).toBe("ken@acme-robotics.dev");
    });
  });

  it("keeps the store open across what the rest of the request awaits", async () => {
    let observed: TenantContextStore | undefined;

    await new Promise<void>((resolve) => {
      middleware.use(undefined, undefined, () => {
        void (async () => {
          await new Promise((tick) => setTimeout(tick, 1));
          observed = tenantContext();
          resolve();
        })();
      });
    });

    expect(observed).toBeDefined();
  });

  it("gives each request its own store", () => {
    const stores: unknown[] = [];

    middleware.use(undefined, undefined, () => stores.push(tenantContext()));
    middleware.use(undefined, undefined, () => stores.push(tenantContext()));

    expect(stores[0]).not.toBe(stores[1]);
  });

  it("leaves no store behind once the request is over", () => {
    middleware.use(undefined, undefined, () => undefined);

    expect(tenantContext()).toBeUndefined();
  });

  it("reads nothing off the request, because there is nothing to read yet", () => {
    // Passing `undefined` for both is the assertion: this middleware runs before guards, so
    // the request it is handed carries no principal and it must not need one.
    expect(() => middleware.use(undefined, undefined, () => undefined)).not.toThrow();
  });
});
