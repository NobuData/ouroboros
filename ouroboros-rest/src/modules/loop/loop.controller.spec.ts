import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { LoopCapabilitiesController } from "./loop.controller";
import type { LoopCapabilitiesResource } from "./loop.capabilities";
import type { LoopCapabilitiesService } from "./loop.service";

const REPORT = { deploymentEnabled: false } as LoopCapabilitiesResource;

describe("LoopCapabilitiesController (DG.2, #1300)", () => {
  it("serves GET /loop/capabilities", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LoopCapabilitiesController)).toBe(
      "loop/capabilities",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, LoopCapabilitiesController.prototype.read)).toBe(
      RequestMethod.GET,
    );
  });

  it("is open to any member — no role is required", () => {
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, LoopCapabilitiesController.prototype.read),
    ).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_ROLES, LoopCapabilitiesController)).toBeUndefined();
  });

  it("reads the report for the session's workspace", async () => {
    const read = jest.fn().mockResolvedValue(REPORT);
    const controller = new LoopCapabilitiesController({
      read,
    } as unknown as LoopCapabilitiesService);

    await expect(controller.read({ id: "org-a" } as Organization)).resolves.toBe(REPORT);
    expect(read).toHaveBeenCalledWith("org-a");
  });
});
