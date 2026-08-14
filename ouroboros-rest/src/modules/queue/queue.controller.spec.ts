import { Reflector } from "@nestjs/core";

import { document } from "../../openapi/specification";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { QueueController } from "./queue.controller";
import type { QueueService } from "./queue.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in
 * `queue.service.spec.ts`, the statements in `queue.repository.spec.ts`, and the whole
 * pipeline in the integration suite. The one criterion that lives *here* is the ticket's
 * scope boundary: this surface reads, and the published contract says so.
 */

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

describe("the queue controller", () => {
  let service: jest.Mocked<QueueService>;
  let controller: QueueController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        totalEstMinutes: 0,
        limit: 25,
        offset: 0,
      }),
    } as unknown as jest.Mocked<QueueService>;

    controller = new QueueController(service);
    reflector = new Reflector();
  });

  it("hands the listing the workspace and the query, untouched", async () => {
    await controller.list(TENANT, { repo: undefined, limit: 10 });

    expect(service.list).toHaveBeenCalledWith("acme-robotics-id", {
      repo: undefined,
      limit: 10,
    });
  });

  it("requires a workspace, by saying nothing", () => {
    // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before the
    // handler runs, which is what "under the tenant context" means.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, QueueController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.list)).toBeUndefined();
  });

  it("names no roles, because reading the queue is every member's", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });

  it("offers no writes", () => {
    // The ticket's scope boundary: reorder, remove and enqueue are the issues screen's
    // (mockup 03). A POST here would be a second opinion about who manages the queue.
    expect(controller).not.toHaveProperty("create");
    expect(controller).not.toHaveProperty("update");
    expect(controller).not.toHaveProperty("remove");
    expect(controller).not.toHaveProperty("reorder");
  });

  it("publishes the read alone, and says where the writes went", () => {
    // The acceptance criterion on the contract itself: the one operation is a GET, and its
    // description names the issues screen so the omission reads as a decision rather than
    // an oversight.
    const path = document().paths["/api/v1/queue"];

    expect(Object.keys(path)).toEqual(["get"]);
    expect(path.get?.description).toContain("issues screen");
    expect(path.get?.description).toContain("mockup 03");
  });
});
