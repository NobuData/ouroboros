import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { SkillsController } from "../skills/skills.controller";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { RuleImportController } from "./rule-import.controller";
import type { RuleImportService } from "./rule-import.service";

/**
 * The rule-file import's controller ([#413](https://github.com/NobuData/ouroboros/issues/413)),
 * held to its role gate, its routes and its delegation — the rules live in
 * `rule-import.service.spec.ts`.
 */

const TENANT = { id: "acme-robotics-id" } as Organization;
const PRINCIPAL = { user: { id: "user-admin" } } as Principal;
const FINGERPRINT = "a".repeat(64);

describe("the rule-import controller", () => {
  const reflector = new Reflector();
  let service: jest.Mocked<Pick<RuleImportService, "preview" | "apply">>;
  let controller: RuleImportController;

  beforeEach(() => {
    service = {
      preview: jest.fn().mockResolvedValue({ repo: "r" }),
      apply: jest.fn().mockResolvedValue({ repo: "r" }),
    };
    controller = new RuleImportController(service as unknown as RuleImportService);
  });

  it.each([
    ["the preview", () => controller.preview],
    ["the apply", () => controller.apply],
  ])("gates %s exactly as skill creation is gated", (_name, handler) => {
    const creation = reflector.get<string[]>(REQUIRED_ROLES, SkillsController.prototype.create);

    expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toEqual(creation);
    expect(creation).toEqual([...ADMINISTRATORS]);
  });

  it.each([
    ["preview", "preview"],
    ["apply", "apply"],
  ] as const)("serves %s as POST knowledge/import/%s", (handler, path) => {
    expect(Reflect.getMetadata(PATH_METADATA, RuleImportController)).toBe("knowledge/import");
    expect(Reflect.getMetadata(PATH_METADATA, RuleImportController.prototype[handler])).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, RuleImportController.prototype[handler])).toBe(
      RequestMethod.POST,
    );
  });

  it("previews the session's workspace", async () => {
    await controller.preview(TENANT, { repo: "acme-robotics/helios-firmware" });

    expect(service.preview).toHaveBeenCalledWith(TENANT.id, "acme-robotics/helios-firmware");
  });

  it("applies as the session's person", async () => {
    await controller.apply(TENANT, PRINCIPAL, {
      repo: "acme-robotics/helios-firmware",
      fingerprint: FINGERPRINT,
    });

    expect(service.apply).toHaveBeenCalledWith(
      TENANT.id,
      "acme-robotics/helios-firmware",
      FINGERPRINT,
      "user-admin",
    );
  });
});
