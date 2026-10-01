import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { CalibrationController } from "./calibration.controller";
import type { CalibrationService } from "./calibration.service";

/** The route: every member's, the session's workspace, `30d` when no window is asked for. */

const TENANT = { id: "org-calibration" } as Organization;

describe("the calibration controller", () => {
  let service: jest.Mocked<CalibrationService>;
  let controller: CalibrationController;

  beforeEach(() => {
    service = {
      report: jest.fn().mockResolvedValue({ window: "30d" }),
    } as unknown as jest.Mocked<CalibrationService>;
    controller = new CalibrationController(service);
  });

  it("reports the window asked for, in the session's workspace", async () => {
    await controller.read(TENANT, { window: "90d" });

    expect(service.report).toHaveBeenCalledWith("org-calibration", "90d");
  });

  it("opens on 30d", async () => {
    await controller.read(TENANT, {});

    expect(service.report).toHaveBeenCalledWith("org-calibration", "30d");
  });

  it("is open to every member — no role is required", () => {
    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
