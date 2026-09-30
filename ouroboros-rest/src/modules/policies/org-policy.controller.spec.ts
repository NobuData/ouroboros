import { Reflector } from "@nestjs/core";

import { FIXTURE_USER } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { OrgPolicyController } from "./org-policy.controller";
import type { OrgPolicyService } from "./org-policy.service";

/**
 * The routes' declarations: the read is every member's, the flip is `owner`/`admin` — on a
 * direct API call exactly as in the UI — and the flip is made in the signed-in person's name.
 */

const MEMBER: ActiveMembership = {
  tenant: { id: "org-dry" } as Organization,
  roles: ["owner"],
};

const RESOURCE = {
  dryRun: false,
  explicit: true,
  reason: null,
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: FIXTURE_USER.id,
};

describe("the org policy controller", () => {
  let service: jest.Mocked<OrgPolicyService>;
  let controller: OrgPolicyController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RESOURCE),
      setDryRun: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<OrgPolicyService>;
    controller = new OrgPolicyController(service);
  });

  it("scopes the read to the session's workspace", async () => {
    await expect(controller.read(MEMBER)).resolves.toEqual(RESOURCE);
    expect(service.read).toHaveBeenCalledWith("org-dry");
  });

  it("flips in the signed-in person's name", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: MEMBER });

      await expect(controller.update(MEMBER, { dryRun: false })).resolves.toEqual(RESOURCE);
    });

    expect(service.setDryRun).toHaveBeenCalledWith("org-dry", FIXTURE_USER.id, false);
  });

  it("refuses a flip nobody can be named for", () => {
    expect(() => controller.update(MEMBER, { dryRun: false })).toThrow(/no signed-in person/);
  });

  it("asks administrators of the flip, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
