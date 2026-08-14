import { Reflector } from "@nestjs/core";

import { RunsController } from "./runs.controller";
import type { RunsService } from "./runs.service";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in
 * `runs.service.spec.ts`, the statements in `runs.repository.spec.ts`, and the whole
 * pipeline in the integration suite.
 */

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

describe("the runs controller", () => {
  let service: jest.Mocked<RunsService>;
  let controller: RunsController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      read: jest.fn().mockResolvedValue({ id: "run-1" }),
    } as unknown as jest.Mocked<RunsService>;

    controller = new RunsController(service);
    reflector = new Reflector();
  });

  it("hands the listing the workspace and the query, untouched", async () => {
    await controller.list(TENANT, { status: "active", repo: undefined, limit: 10 });

    expect(service.list).toHaveBeenCalledWith("acme-robotics-id", {
      status: "active",
      repo: undefined,
      limit: 10,
    });
  });

  it("hands the detail the workspace and the id", async () => {
    await controller.read(TENANT, { id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" });

    expect(service.read).toHaveBeenCalledWith(
      "acme-robotics-id",
      "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
    );
  });

  it("requires a workspace, by saying nothing", () => {
    // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before
    // either handler runs, which is what "both under the tenant context" means.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, RunsController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.list)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.read)).toBeUndefined();
  });

  it("names no roles, because reading runs is every member's", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });

  it("offers no writes", () => {
    // The read-model's writer is the ingestion bridge (#91); a POST here would be a second
    // write path to rows the engine owns.
    expect(controller).not.toHaveProperty("create");
    expect(controller).not.toHaveProperty("update");
    expect(controller).not.toHaveProperty("remove");
  });
});
