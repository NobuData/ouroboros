import { Controller, Get, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { OrganizationRole, WorkspaceLifecycleState } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { FIXTURE_ORGANIZATION, membershipIn } from "../tenancy/organization.fixture";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import { LIFECYCLE_ERRORS } from "./lifecycle.errors";
import { statesOf } from "./lifecycle.fixture";
import { LifecycleExempt, WorkspaceFreezeGuard } from "./lifecycle.freeze.guard";

@Controller()
class Surfaces {
  @Get()
  dashboard(): void {}

  @LifecycleExempt()
  @Post()
  restore(): void {}
}

/** An execution context for one handler of {@link Surfaces}. */
function contextFor(handler: unknown): ExecutionContext {
  return { getHandler: () => handler, getClass: () => Surfaces } as unknown as ExecutionContext;
}

/** Run the guard in a workspace in `state`, as somebody holding `roles`. */
function asMember(
  state: WorkspaceLifecycleState,
  roles: readonly OrganizationRole[],
  handler: unknown,
): Promise<boolean> {
  const guard = new WorkspaceFreezeGuard(
    new Reflector(),
    statesOf(new Map([[FIXTURE_ORGANIZATION.id, state]])),
  );

  return runWithTenantContext(() => {
    setTenantContext({ membership: membershipIn(roles) });
    return guard.canActivate(contextFor(handler));
  });
}

/** The envelope a refusal carries. */
async function refusal(work: Promise<unknown>): Promise<ReturnType<DomainError["envelope"]>> {
  try {
    await work;
  } catch (error) {
    return (error as DomainError).envelope();
  }

  throw new Error("expected a refusal");
}

describe("the pending-deletion freeze (#489)", () => {
  const surfaces = Surfaces.prototype;

  it("lets every request through while active or paused", async () => {
    await expect(asMember("active", ["viewer"], surfaces.dashboard)).resolves.toBe(true);
    await expect(asMember("paused", ["viewer"], surfaces.dashboard)).resolves.toBe(true);
  });

  it("freezes every surface for a non-owner, exempt routes included", async () => {
    for (const handler of [surfaces.dashboard, surfaces.restore]) {
      expect(await refusal(asMember("pending_delete", ["admin"], handler))).toMatchObject({
        code: LIFECYCLE_ERRORS.workspacePendingDelete,
        details: { restorable: false, purgeAfter: "2026-11-02T00:00:00.000Z" },
      });
    }
  });

  it("freezes an owner too, except on the recovery screen's routes", async () => {
    expect(await refusal(asMember("pending_delete", ["owner"], surfaces.dashboard))).toMatchObject({
      code: LIFECYCLE_ERRORS.workspacePendingDelete,
      details: { restorable: true },
    });
    await expect(asMember("pending_delete", ["owner"], surfaces.restore)).resolves.toBe(true);
  });

  it("leaves a request acting in no workspace alone", async () => {
    const guard = new WorkspaceFreezeGuard(new Reflector(), statesOf());

    await expect(
      runWithTenantContext(() => guard.canActivate(contextFor(surfaces.dashboard))),
    ).resolves.toBe(true);
  });
});
