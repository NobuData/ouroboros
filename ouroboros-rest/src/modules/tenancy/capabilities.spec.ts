import { Controller, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { FIXTURE_USER } from "../auth/principal.fixture";
import { servicePrincipalFor } from "../auth/service.principal.fixture";
import type { OrganizationRole } from "../db/schema";
import type { DomainError } from "../errors/error.envelope";
import {
  APPROVING_ROLES,
  CAPABILITY_REQUIRED,
  CapabilityGuard,
  defaultCanApproveLoops,
  effectiveCanApproveLoops,
  RequiresCapability,
} from "./capabilities";
import type { CapabilityRepository } from "./capability.repository";
import { membershipIn } from "./organization.fixture";
import { runWithTenantContext, setTenantContext } from "./tenant.context";

/**
 * `can_approve_loops` (#485): the role defaults, the explicit override, and the guard every
 * approval route runs.
 */

@Controller()
class Approvals {
  @RequiresCapability("can_approve_loops")
  @Post()
  approve(): void {}

  @Post()
  steer(): void {}
}

/** An execution context for one handler. */
function contextFor(handler: unknown): ExecutionContext {
  return { getHandler: () => handler, getClass: () => Approvals } as unknown as ExecutionContext;
}

/** A store answering with one explicit setting. */
function store(explicit: boolean | null): jest.Mocked<CapabilityRepository> {
  return {
    explicitFor: jest.fn().mockResolvedValue(explicit),
  } as unknown as jest.Mocked<CapabilityRepository>;
}

/** Run the guard as a member holding `roles`. */
function asMember(
  roles: OrganizationRole[],
  guard: CapabilityGuard,
  handler: unknown = Approvals.prototype.approve,
): Promise<boolean> {
  return runWithTenantContext(() => {
    setTenantContext({ user: FIXTURE_USER, membership: membershipIn(roles) });
    return guard.canActivate(contextFor(handler));
  });
}

describe("the role defaults", () => {
  it("lets owners and admins approve, and nobody else, until told otherwise", () => {
    expect([...APPROVING_ROLES]).toEqual(["owner", "admin"]);
    expect(defaultCanApproveLoops(["owner"])).toBe(true);
    expect(defaultCanApproveLoops(["admin"])).toBe(true);
    expect(defaultCanApproveLoops(["member"])).toBe(false);
    expect(defaultCanApproveLoops(["viewer"])).toBe(false);
    expect(defaultCanApproveLoops(["viewer", "admin"])).toBe(true);
    expect(defaultCanApproveLoops([])).toBe(false);
  });

  it("gives way to an explicit setting either way", () => {
    expect(effectiveCanApproveLoops(["admin"], false)).toBe(false);
    expect(effectiveCanApproveLoops(["viewer"], true)).toBe(true);
    expect(effectiveCanApproveLoops(["admin"], null)).toBe(true);
    expect(effectiveCanApproveLoops(["member"], null)).toBe(false);
  });
});

describe("the capability guard", () => {
  it("does nothing on a route that requires no capability", async () => {
    const repository = store(false);
    const guard = new CapabilityGuard(new Reflector(), repository);

    await expect(asMember(["viewer"], guard, Approvals.prototype.steer)).resolves.toBe(true);
    expect(repository.explicitFor).not.toHaveBeenCalled();
  });

  it("admits an admin by default", async () => {
    await expect(
      asMember(["admin"], new CapabilityGuard(new Reflector(), store(null))),
    ).resolves.toBe(true);
  });

  it("refuses an admin whose capability was unticked, naming it", async () => {
    const guard = new CapabilityGuard(new Reflector(), store(false));
    const refusal = await asMember(["admin"], guard).catch((error: DomainError) => error);

    expect((refusal as DomainError).getStatus()).toBe(403);
    expect((refusal as DomainError).envelope()).toMatchObject({
      code: CAPABILITY_REQUIRED,
      details: { capability: "can_approve_loops" },
    });
  });

  it("refuses a member by default, and admits one who was ticked", async () => {
    await expect(
      asMember(["member"], new CapabilityGuard(new Reflector(), store(null))),
    ).rejects.toMatchObject({
      code: CAPABILITY_REQUIRED,
    });
    await expect(
      asMember(["member"], new CapabilityGuard(new Reflector(), store(true))),
    ).resolves.toBe(true);
  });

  it("asks about the caller in the caller's workspace", async () => {
    const repository = store(null);

    await asMember(["owner"], new CapabilityGuard(new Reflector(), repository));

    expect(repository.explicitFor).toHaveBeenCalledWith(
      membershipIn(["owner"]).tenant.id,
      FIXTURE_USER.id,
    );
  });

  it("refuses a service account, which holds no person's approval power", async () => {
    const guard = new CapabilityGuard(new Reflector(), store(true));

    await expect(
      runWithTenantContext(() => {
        setTenantContext({ membership: membershipIn([]), service: servicePrincipalFor() });
        return guard.canActivate(contextFor(Approvals.prototype.approve));
      }),
    ).rejects.toMatchObject({ code: CAPABILITY_REQUIRED });
  });

  it("refuses a request with no membership rather than guessing", async () => {
    const guard = new CapabilityGuard(new Reflector(), store(true));

    await expect(
      runWithTenantContext(() => guard.canActivate(contextFor(Approvals.prototype.approve))),
    ).rejects.toMatchObject({ code: CAPABILITY_REQUIRED });
  });
});
