import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { AuthController } from "../auth/auth.controller";
import type { Tenant } from "../db/schema";
import { CurrentMember, CurrentTenant, TENANT_OPTIONAL, TenantOptional } from "./tenant.decorators";
import { runWithTenantContext, setTenantContext } from "./tenant.context";
import { TenantsController } from "./tenants.controller";

/**
 * The three decorators, and the list of routes that opt out of having a tenant.
 *
 * The list is the part worth a test. A route becoming tenant-optional is a scoping change,
 * and it should have to be made here — in a file that names it — rather than by a decorator
 * appearing in a diff nobody read.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const reflector = new Reflector();

/**
 * Is this handler — or its controller — marked tenant-optional?
 *
 * @param target - The controller class.
 * @param handler - The method on it.
 * @returns What the guard would decide.
 */
function isOptional(target: new (...args: never[]) => object, handler: unknown): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(TENANT_OPTIONAL, [
      handler as () => unknown,
      target,
    ]) === true
  );
}

/**
 * Call a param decorator's factory the way Nest does.
 *
 * `createParamDecorator` stores its factory in route-argument metadata; reaching it is what
 * lets a spec exercise the decorator itself rather than a copy of its body.
 *
 * @param decorator - The decorator to apply.
 * @returns Its factory, ready to be called with a data argument and a context.
 */
function factoryOf(
  decorator: (...args: never[]) => ParameterDecorator,
): (data: unknown, context: ExecutionContext) => unknown {
  class Host {
    handler(_value: unknown): void {}
  }

  decorator()(Host.prototype, "handler", 0);

  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Host, "handler") as Record<
    string,
    { factory: (data: unknown, context: ExecutionContext) => unknown }
  >;

  return Object.values(metadata)[0].factory;
}

/** A context object; the decorators here read the ambient store, not the request. */
const CONTEXT = {} as ExecutionContext;

describe("@CurrentTenant()", () => {
  const currentTenant = factoryOf(CurrentTenant);

  it("answers with the tenant the guard established", () => {
    runWithTenantContext(() => {
      setTenantContext({ membership: { tenant: TENANT, role: "owner" } });

      expect(currentTenant(undefined, CONTEXT)).toEqual(TENANT);
    });
  });

  it("throws on a route with no tenant, rather than handing back undefined", () => {
    // A handler given `undefined` typed as a `Tenant` is how a query ends up filtered by
    // nothing at all. This is a programming mistake and it fails loudly.
    expect(() => currentTenant(undefined, CONTEXT)).toThrow(/no tenant context/);
  });
});

describe("@CurrentMember()", () => {
  const currentMember = factoryOf(CurrentMember);

  it("answers with the tenant and the role together", () => {
    runWithTenantContext(() => {
      setTenantContext({ membership: { tenant: TENANT, role: "admin" } });

      expect(currentMember(undefined, CONTEXT)).toEqual({ tenant: TENANT, role: "admin" });
    });
  });

  it("throws on a route with no tenant", () => {
    expect(() => currentMember(undefined, CONTEXT)).toThrow(/no tenant context/);
  });
});

describe("the routes that need no tenant", () => {
  it.each([
    ["listing your workspaces", TenantsController, TenantsController.prototype.list],
    ["creating one", TenantsController, TenantsController.prototype.create],
  ])("%s is tenant-optional", (_description, target, handler) => {
    expect(isOptional(target as never, handler)).toBe(true);
  });

  it("is a list of two, and both of them are about the person", () => {
    // Which workspaces are mine, and let me have one. A third entry would need the same
    // justification.
    //
    // It was three until [#711](https://github.com/NobuData/ouroboros/issues/711): reading
    // the session was the clearest case of all — its whole answer was the list of
    // workspaces a tenant would have had to be resolved *from* — and the route was deleted,
    // not the exemption. `GET /api/auth/get-session` is BetterAuth's and never reaches this
    // middleware at all.
    expect(isOptional(TenantsController as never, TenantsController.prototype.read)).toBe(false);
  });

  it("leaves signing out to its own exemption, not this one", () => {
    // `POST /api/v1/auth/logout` is `@AllowAnonymous()` rather than `@TenantOptional()`:
    // it needs no session, so the question of which workspace it acts in never arises.
    expect(isOptional(AuthController as never, AuthController.prototype.logout)).toBe(false);
  });
});

describe("the decorator itself", () => {
  it("marks a single handler without marking its neighbours", () => {
    @Controller()
    class Mixed {
      @TenantOptional()
      @Get("open")
      open(): void {}

      @Get("scoped")
      scoped(): void {}
    }

    expect(isOptional(Mixed, Mixed.prototype.open)).toBe(true);
    expect(isOptional(Mixed, Mixed.prototype.scoped)).toBe(false);
  });

  it("uses a namespaced key, because Reflector metadata is one flat space", () => {
    expect(TENANT_OPTIONAL).toBe("ouroboros:tenancy:optional");
  });
});
