import type { Organization, User } from "../db/schema";
import { FIXTURE_ORGANIZATION, FIXTURE_OTHER_ORGANIZATION } from "./organization.fixture";
import {
  currentMembership,
  currentTenant,
  currentUser,
  runWithTenantContext,
  setTenantContext,
  tenantContext,
} from "./tenant.context";

/**
 * The store, and the property that makes it worth having: **it survives an `await`**.
 *
 * That is the whole of the issue's third acceptance criterion — *context available in
 * services without passing parameters through* — and it is the one thing about
 * `AsyncLocalStorage` that a reader has to take on trust unless a test says otherwise. So
 * the tests below reach for the context from inside promises, timers and nested calls, and
 * from two overlapping requests at once.
 */

const TENANT = FIXTURE_ORGANIZATION;

const OTHER = FIXTURE_OTHER_ORGANIZATION;

const USER: User = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

describe("outside a request", () => {
  it("has no context, and says so rather than throwing", () => {
    // A background job, a shutdown hook, a unit test that opened none: all legitimate, and
    // none of them is a failure.
    expect(tenantContext()).toBeUndefined();
    expect(currentTenant()).toBeUndefined();
    expect(currentMembership()).toBeUndefined();
    expect(currentUser()).toBeUndefined();
  });

  it("ignores an attempt to write to one", () => {
    expect(() => setTenantContext({ user: USER })).not.toThrow();
    expect(currentUser()).toBeUndefined();
  });
});

describe("inside a request", () => {
  it("starts empty", () => {
    runWithTenantContext(() => {
      expect(tenantContext()).toEqual({});
    });
  });

  it("holds what the guard wrote", () => {
    runWithTenantContext(() => {
      setTenantContext({ user: USER, membership: { tenant: TENANT, roles: ["owner"] } });

      expect(currentUser()).toEqual(USER);
      expect(currentTenant()).toEqual(TENANT);
      expect(currentMembership()).toEqual({ tenant: TENANT, roles: ["owner"] });
    });
  });

  it("merges two writes rather than replacing", () => {
    // The guard writes the person first, and the membership only if the route needs one.
    runWithTenantContext(() => {
      setTenantContext({ user: USER });
      setTenantContext({ membership: { tenant: TENANT, roles: ["viewer"] } });

      expect(currentUser()).toEqual(USER);
      expect(currentTenant()).toEqual(TENANT);
    });
  });

  it("returns what the work returned", () => {
    expect(runWithTenantContext(() => 42)).toBe(42);
  });
});

describe("across asynchrony", () => {
  it("survives an await", async () => {
    // The property the whole design rests on. Without it, a service reading `currentTenant()`
    // after its first query would read nothing.
    await runWithTenantContext(async () => {
      setTenantContext({ membership: { tenant: TENANT, roles: ["owner"] } });

      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(currentTenant()).toEqual(TENANT);
    });
  });

  it("survives arbitrary call depth", async () => {
    async function third(): Promise<Organization | undefined> {
      await Promise.resolve();
      return currentTenant();
    }
    const second = (): Promise<Organization | undefined> => third();
    const first = (): Promise<Organization | undefined> => second();

    await runWithTenantContext(async () => {
      setTenantContext({ membership: { tenant: TENANT, roles: ["owner"] } });

      expect(await first()).toEqual(TENANT);
    });
  });

  it("keeps two overlapping requests apart", async () => {
    // Two requests are in flight at once on one process constantly. A store that leaked
    // between them would be one tenant's data answered into another's request, which is the
    // single worst failure this module could have.
    const request = async (tenant: Organization): Promise<string | undefined> =>
      runWithTenantContext(async () => {
        setTenantContext({ membership: { tenant, roles: ["owner"] } });
        await new Promise((resolve) => setTimeout(resolve, tenant === TENANT ? 5 : 1));
        return currentTenant()?.slug;
      });

    expect(await Promise.all([request(TENANT), request(OTHER)])).toEqual(["acme", "globex"]);
  });

  it("does not leak out of the request that opened it", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ membership: { tenant: TENANT, roles: ["owner"] } });
      await Promise.resolve();
    });

    expect(currentTenant()).toBeUndefined();
  });
});
