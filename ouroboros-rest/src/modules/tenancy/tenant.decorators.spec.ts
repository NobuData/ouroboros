import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { AuthController } from "../auth/auth.controller";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import { DomainsController } from "./domains.controller";
import { GithubOrgsController } from "./github-orgs.controller";
import { OrgsController } from "./orgs.controller";
import { CurrentMember, CurrentTenant, TENANT_OPTIONAL, TenantOptional } from "./tenant.decorators";
import { runWithTenantContext, setTenantContext } from "./tenant.context";

/**
 * The three decorators, and the list of routes that opt out of having a tenant.
 *
 * The list is the part worth a test. A route becoming tenant-optional is a scoping change,
 * and it should have to be made here — in a file that names it — rather than by a decorator
 * appearing in a diff nobody read.
 */

const TENANT = FIXTURE_ORGANIZATION;

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
      setTenantContext({ membership: { tenant: TENANT, roles: ["owner"] } });

      expect(currentTenant(undefined, CONTEXT)).toEqual(TENANT);
    });
  });

  it("throws on a route with no tenant, rather than handing back undefined", () => {
    // A handler given `undefined` typed as a row is how a query ends up filtered by
    // nothing at all. This is a programming mistake and it fails loudly.
    expect(() => currentTenant(undefined, CONTEXT)).toThrow(/no tenant context/);
  });
});

describe("@CurrentMember()", () => {
  const currentMember = factoryOf(CurrentMember);

  it("answers with the workspace and the roles together", () => {
    runWithTenantContext(() => {
      setTenantContext({ membership: { tenant: TENANT, roles: ["admin"] } });

      expect(currentMember(undefined, CONTEXT)).toEqual({ tenant: TENANT, roles: ["admin"] });
    });
  });

  it("throws on a route with no tenant", () => {
    expect(() => currentMember(undefined, CONTEXT)).toThrow(/no tenant context/);
  });
});

describe("the routes that need no tenant", () => {
  it("listing your workspaces is tenant-optional", () => {
    // Asking somebody to name a workspace before being told which workspaces they have is
    // circular, and it is exactly the state `400 organization_required` tells them to leave.
    expect(isOptional(OrgsController as never, OrgsController.prototype.list)).toBe(true);
  });

  it("is a list of one in this module, and it is about the person", () => {
    // It was two until [#714](https://github.com/NobuData/ouroboros/issues/714): creating a
    // workspace was the other, and `POST /api/auth/organization/create` is the plugin's now —
    // so the route was deleted rather than the exemption. Before that it was three, and
    // [#711](https://github.com/NobuData/ouroboros/issues/711) deleted `GET /api/v1/auth/me`
    // the same way.
    //
    // Everything else here is scoped, including every read: a workspace in the path is what
    // the guard resolves, and a route that opted out would be one whose `404` rule applied to
    // nothing.
    expect(isOptional(DomainsController as never, DomainsController.prototype.list)).toBe(false);
    expect(isOptional(GithubOrgsController as never, GithubOrgsController.prototype.list)).toBe(
      false,
    );
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
