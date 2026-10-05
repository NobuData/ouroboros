import { Reflector } from "@nestjs/core";

import { FIXTURE_USER } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { PolicyController } from "./policy.controller";
import type { PolicyPublishService } from "./policy-publish.service";

/**
 * The org policy document's routes (BQ.2, #481): the read is every member's, the preview and the
 * publish are owner/admin, and both carry the signed-in person and their roles — the service
 * decides which of those two may publish a loosening.
 */

const ADMIN: ActiveMembership = { tenant: { id: "org-481" } as Organization, roles: ["admin"] };

describe("the policy controller", () => {
  let service: jest.Mocked<PolicyPublishService>;
  let controller: PolicyController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue({ version: 7 }),
      preview: jest.fn().mockResolvedValue({ classification: "tightening" }),
      publish: jest.fn().mockResolvedValue({ version: 8 }),
    } as unknown as jest.Mocked<PolicyPublishService>;
    controller = new PolicyController(service);
  });

  it("scopes the read to the session's workspace", async () => {
    await expect(controller.read(ADMIN)).resolves.toEqual({ version: 7 });
    expect(service.read).toHaveBeenCalledWith("org-481");
  });

  it("previews and publishes as the signed-in person, with their roles", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: ADMIN });

      await controller.preview(ADMIN, { document: { a: 1 } });
      await controller.publish(ADMIN, { document: { a: 1 }, baseVersion: 7, changeNote: "Why." });
      await controller.publish(ADMIN, { document: { a: 1 }, baseVersion: null });
    });

    const actor = { id: FIXTURE_USER.id, roles: ["admin"] };

    expect(service.preview).toHaveBeenCalledWith("org-481", actor, { a: 1 });
    expect(service.publish).toHaveBeenNthCalledWith(1, "org-481", actor, {
      document: { a: 1 },
      baseVersion: 7,
      changeNote: "Why.",
    });
    expect(service.publish).toHaveBeenNthCalledWith(2, "org-481", actor, {
      document: { a: 1 },
      baseVersion: null,
      changeNote: null,
    });
  });

  it("refuses a publish nobody can be named for", () => {
    expect(() => controller.publish(ADMIN, { document: {}, baseVersion: null })).toThrow(
      /no signed-in person/,
    );
  });

  it("asks administrators of the preview and the publish, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.publish)).toEqual([
      ...ADMINISTRATORS,
    ]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.preview)).toEqual([
      ...ADMINISTRATORS,
    ]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
