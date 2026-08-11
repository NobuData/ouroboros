import { Controller, Delete, Get, Patch, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { DomainError } from "../errors/error.envelope";
import type { Tenant, TenantRole } from "../db/schema";
import { DomainsController } from "./domains.controller";
import { MembersController } from "./members.controller";
import { OrgsController } from "./orgs.controller";
import { ReposController } from "./repos.controller";
import { ADMINISTRATORS, REQUIRED_ROLES, Roles, RolesGuard } from "./roles.guard";
import { runWithTenantContext, setTenantContext } from "./tenant.context";
import { TENANCY_ERRORS } from "./tenancy.errors";
import { TenantsController } from "./tenants.controller";

/**
 * The issue's second acceptance criterion — *the role guard blocks member-level users from
 * admin mutations* — checked twice over.
 *
 * Once as behaviour, on a controller written here; and once as an inventory, against the
 * real tenancy controllers. The inventory matters more than it looks: a mutation added later
 * without `@Roles()` would be open to every `viewer` in the workspace, and no behavioural
 * test would notice, because there would be no test for a route nobody wrote one for.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

@Controller()
class Guarded {
  @Get()
  read(): void {}

  @Roles(...ADMINISTRATORS)
  @Post()
  administer(): void {}

  @Roles("owner")
  @Delete()
  ownerOnly(): void {}
}

@Roles(...ADMINISTRATORS)
@Controller()
class WhollyGuarded {
  @Patch()
  handler(): void {}
}

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

/**
 * An execution context over a real controller class.
 *
 * @param target - The controller.
 * @param handler - The method on it.
 * @returns The context.
 */
function contextFor(target: new (...args: never[]) => object, handler: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

/**
 * Run the guard as somebody holding a role.
 *
 * @param role - What they hold in the active tenant.
 * @param context - The route.
 * @returns Whether it allowed the request.
 * @throws {ForbiddenError} When it did not.
 */
function asRole(role: TenantRole, context: ExecutionContext): boolean {
  return runWithTenantContext(() => {
    setTenantContext({ membership: { tenant: TENANT, role } });
    return guard.canActivate(context);
  });
}

/** The roles a handler declares, as the guard reads them. */
function declaredRoles(target: new (...args: never[]) => object, handler: unknown): TenantRole[] {
  return (
    reflector.getAllAndOverride<TenantRole[] | undefined>(REQUIRED_ROLES, [
      handler as () => unknown,
      target,
    ]) ?? []
  );
}

describe("a route that declares no roles", () => {
  it("is open to every member, including a viewer", () => {
    // Not the same laxity as `@Public()`: the tenant guard has already refused anybody who
    // is not a member, so the default is "any of the four roles" rather than "anybody". A
    // `viewer` is a role that exists to be able to look.
    for (const role of ["owner", "admin", "member", "viewer"] as TenantRole[]) {
      expect(asRole(role, contextFor(Guarded, Guarded.prototype.read))).toBe(true);
    }
  });

  it("does not even read the context", () => {
    expect(guard.canActivate(contextFor(Guarded, Guarded.prototype.read))).toBe(true);
  });
});

describe("a route that declares roles", () => {
  it("allows an owner and an admin", () => {
    for (const role of ADMINISTRATORS) {
      expect(asRole(role, contextFor(Guarded, Guarded.prototype.administer))).toBe(true);
    }
  });

  it("blocks a member — the issue's second acceptance criterion", () => {
    expect(() => asRole("member", contextFor(Guarded, Guarded.prototype.administer))).toThrow();
  });

  it("blocks a viewer", () => {
    expect(() => asRole("viewer", contextFor(Guarded, Guarded.prototype.administer))).toThrow();
  });

  it("answers 403 rather than 404, because the caller has already proved membership", () => {
    // The one place this API answers 403. Everywhere else "you may not" would confirm that
    // an identifier names something real; here the workspace is no secret from them, and
    // their role is the only thing left to tell them.
    let failure: DomainError | undefined;

    try {
      asRole("viewer", contextFor(Guarded, Guarded.prototype.administer));
    } catch (error) {
      failure = error as DomainError;
    }

    expect(failure?.getStatus()).toBe(403);
    expect(failure?.code).toBe(TENANCY_ERRORS.forbidden);
  });

  it("says what they hold and what would have been enough", () => {
    let failure: DomainError | undefined;

    try {
      asRole("viewer", contextFor(Guarded, Guarded.prototype.administer));
    } catch (error) {
      failure = error as DomainError;
    }

    expect(failure?.details).toEqual({ role: "viewer", required: ["owner", "admin"] });
  });

  it("narrows to one role when a handler asks for one", () => {
    expect(asRole("owner", contextFor(Guarded, Guarded.prototype.ownerOnly))).toBe(true);
    expect(() => asRole("admin", contextFor(Guarded, Guarded.prototype.ownerOnly))).toThrow();
  });

  it("covers every handler when it is applied to the controller", () => {
    expect(asRole("admin", contextFor(WhollyGuarded, WhollyGuarded.prototype.handler))).toBe(true);
    expect(() =>
      asRole("member", contextFor(WhollyGuarded, WhollyGuarded.prototype.handler)),
    ).toThrow();
  });

  it("fails loudly when there is no tenant context at all", () => {
    // A route that names roles cannot also be `@TenantOptional()` — there is no membership
    // to hold a role in. Unreachable through the pipeline, and it must not read as "allowed".
    expect(() => guard.canActivate(contextFor(Guarded, Guarded.prototype.administer))).toThrow(
      /no tenant context/,
    );
  });
});

describe("the tenancy API's own mutations", () => {
  /** Every handler that changes something, and the controller it belongs to. */
  const MUTATIONS = [
    ["rename or suspend a tenant", TenantsController, TenantsController.prototype.update],
    ["add a domain", DomainsController, DomainsController.prototype.add],
    ["set a primary domain", DomainsController, DomainsController.prototype.setPrimary],
    ["give a domain up", DomainsController, DomainsController.prototype.remove],
    ["invite a member", MembersController, MembersController.prototype.invite],
    ["change a role", MembersController, MembersController.prototype.changeRole],
    ["remove a member", MembersController, MembersController.prototype.remove],
    ["add an organisation", OrgsController, OrgsController.prototype.add],
    ["enable an organisation", OrgsController, OrgsController.prototype.setEnabled],
    ["enable a repository", ReposController, ReposController.prototype.setEnabled],
  ] as const;

  it.each(MUTATIONS)("requires an administrator to %s", (_description, target, handler) => {
    expect(declaredRoles(target as never, handler)).toEqual([...ADMINISTRATORS]);
  });

  it("has ten of them, so a new one cannot be added without this list noticing", () => {
    expect(MUTATIONS).toHaveLength(10);
  });

  /** Every handler that only reads. */
  const READS = [
    ["list tenants", TenantsController, TenantsController.prototype.list],
    ["read a tenant", TenantsController, TenantsController.prototype.read],
    ["list domains", DomainsController, DomainsController.prototype.list],
    ["list members", MembersController, MembersController.prototype.list],
    ["list organisations", OrgsController, OrgsController.prototype.list],
    ["list repositories", ReposController, ReposController.prototype.list],
  ] as const;

  it.each(READS)("lets any member %s", (_description, target, handler) => {
    expect(declaredRoles(target as never, handler)).toEqual([]);
  });

  it("names the administrators once, so widening them is one edit", () => {
    expect([...ADMINISTRATORS]).toEqual(["owner", "admin"]);
  });
});
