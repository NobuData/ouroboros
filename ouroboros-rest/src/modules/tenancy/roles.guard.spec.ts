import { Controller, Delete, Get, Patch, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { DomainError } from "../errors/error.envelope";
import type { OrganizationRole } from "../db/schema";
import { DomainsController } from "./domains.controller";
import { GithubOrgsController } from "./github-orgs.controller";
import { membershipIn } from "./organization.fixture";
import { OrgsController } from "./orgs.controller";
import { ReposController } from "./repos.controller";
import { ADMINISTRATORS, REQUIRED_ROLES, Roles, RolesGuard } from "./roles.guard";
import { runWithTenantContext, setTenantContext } from "./tenant.context";
import { TENANCY_ERRORS } from "./tenancy.errors";

/**
 * The issue's second acceptance criterion — *the role guard blocks member-level users from
 * admin mutations* — checked twice over.
 *
 * Once as behaviour, on a controller written here; and once as an inventory, against the
 * real tenancy controllers. The inventory matters more than it looks: a mutation added later
 * without `@Roles()` would be open to every `viewer` in the workspace, and no behavioural
 * test would notice, because there would be no test for a route nobody wrote one for.
 */

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
 * Run the guard as somebody holding one role.
 *
 * @param role - What they hold in the active workspace.
 * @param context - The route.
 * @returns Whether it allowed the request.
 * @throws {ForbiddenError} When it did not.
 */
function asRole(role: OrganizationRole, context: ExecutionContext): boolean {
  return asRoles([role], context);
}

/**
 * Run the guard as somebody holding several.
 *
 * `member.role` is un-CHECK-constrained text and holds a comma-separated list where the
 * library was asked to grant two roles at once (V005), so "several" is a state the guard has
 * to answer for rather than one this suite invented.
 *
 * @param roles - What they hold. May be empty — a membership carrying only words this service
 *   does not recognise.
 * @param context - The route.
 * @returns Whether it allowed the request.
 * @throws {ForbiddenError} When it did not.
 */
function asRoles(roles: readonly OrganizationRole[], context: ExecutionContext): boolean {
  return runWithTenantContext(() => {
    setTenantContext({ membership: membershipIn(roles) });
    return guard.canActivate(context);
  });
}

/** The roles a handler declares, as the guard reads them. */
function declaredRoles(
  target: new (...args: never[]) => object,
  handler: unknown,
): OrganizationRole[] {
  return (
    reflector.getAllAndOverride<OrganizationRole[] | undefined>(REQUIRED_ROLES, [
      handler as () => unknown,
      target,
    ]) ?? []
  );
}

describe("a route that declares no roles", () => {
  it("is open to every member, including a viewer", () => {
    // Not the same laxity as `@AllowAnonymous()`: the tenant guard has already refused anybody who
    // is not a member, so the default is "any of the four roles" rather than "anybody". A
    // `viewer` is a role that exists to be able to look.
    for (const role of ["owner", "admin", "member", "viewer"] as OrganizationRole[]) {
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

  it("echoes both roles when the caller holds two, exactly as the column spells them", () => {
    // `details.role` is documented in openapi.yaml as *the role you hold*, and for every
    // membership this product creates that is one word. Where it is two, showing both is what
    // makes the field match what an administrator would read out of the database.
    let failure: DomainError | undefined;

    try {
      asRoles(["member", "viewer"], contextFor(Guarded, Guarded.prototype.administer));
    } catch (error) {
      failure = error as DomainError;
    }

    expect(failure?.details).toEqual({ role: "member,viewer", required: ["owner", "admin"] });
  });

  it("allows a membership that holds a sufficient role among others", () => {
    // The library grants an array of roles by writing them comma-separated into one column.
    // Read as a single word, `admin,member` would match nothing a route asks for — an admin
    // refused every mutation, with the database showing them as an admin.
    expect(asRoles(["admin", "member"], contextFor(Guarded, Guarded.prototype.administer))).toBe(
      true,
    );
  });

  it("blocks a membership whose every role is insufficient", () => {
    expect(() =>
      asRoles(["member", "viewer"], contextFor(Guarded, Guarded.prototype.administer)),
    ).toThrow();
  });

  it("blocks a membership holding no role this service recognises", () => {
    // `member.role` carries no check constraint, so a word nothing here knows is possible —
    // and it grants nothing, which is the only safe reading of a permission nobody defined.
    expect(() => asRoles([], contextFor(Guarded, Guarded.prototype.administer))).toThrow();
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
    ["add a domain", DomainsController, DomainsController.prototype.add],
    ["set a primary domain", DomainsController, DomainsController.prototype.setPrimary],
    ["give a domain up", DomainsController, DomainsController.prototype.remove],
    ["add a GitHub organisation", GithubOrgsController, GithubOrgsController.prototype.add],
    [
      "enable a GitHub organisation",
      GithubOrgsController,
      GithubOrgsController.prototype.setEnabled,
    ],
    ["enable a repository", ReposController, ReposController.prototype.setEnabled],
  ] as const;

  it.each(MUTATIONS)("requires an administrator to %s", (_description, target, handler) => {
    expect(declaredRoles(target as never, handler)).toEqual([...ADMINISTRATORS]);
  });

  it("has six of them, so a new one cannot be added without this list noticing", () => {
    // It was ten until [#714](https://github.com/NobuData/ouroboros/issues/714). The four that
    // left are the workspace rename and the three member operations, all of which the
    // organization plugin serves — and the plugin applies its *own* access control to them,
    // which is why deleting them here is a move rather than a hole.
    expect(MUTATIONS).toHaveLength(6);
  });

  /** Every handler that only reads. */
  const READS = [
    ["list workspaces", OrgsController, OrgsController.prototype.list],
    ["list domains", DomainsController, DomainsController.prototype.list],
    ["list GitHub organisations", GithubOrgsController, GithubOrgsController.prototype.list],
    ["read a GitHub organisation", GithubOrgsController, GithubOrgsController.prototype.read],
    ["list repositories", ReposController, ReposController.prototype.list],
    ["read a repository", ReposController, ReposController.prototype.read],
  ] as const;

  it.each(READS)("lets any member %s", (_description, target, handler) => {
    expect(declaredRoles(target as never, handler)).toEqual([]);
  });

  it("names the administrators once, so widening them is one edit", () => {
    expect([...ADMINISTRATORS]).toEqual(["owner", "admin"]);
  });
});
