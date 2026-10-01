import { Reflector } from "@nestjs/core";

import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { InsightsPageController } from "./page.controller";
import type { InsightsPageService } from "./page.service";

/** The route: every member's, the session's workspace, `30d` when no range is asked for. */

const TENANT = { id: "org-insights" } as Organization;

describe("the insights page controller", () => {
  let service: jest.Mocked<InsightsPageService>;
  let controller: InsightsPageController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue({ range: "30d" }),
    } as unknown as jest.Mocked<InsightsPageService>;
    controller = new InsightsPageController(service);
  });

  it("reads the range and repository asked for, in the session's workspace", async () => {
    await controller.read(TENANT, { range: "90d", repo: "acme-robotics/helios-firmware" });

    expect(service.read).toHaveBeenCalledWith("org-insights", {
      range: "90d",
      repo: "acme-robotics/helios-firmware",
    });
  });

  it("opens on 30d, for the whole workspace", async () => {
    await controller.read(TENANT, {});

    expect(service.read).toHaveBeenCalledWith("org-insights", { range: "30d", repo: undefined });
  });

  it("is open to every member — no role is required", () => {
    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
