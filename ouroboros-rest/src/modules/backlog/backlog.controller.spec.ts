import { HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA } from "@nestjs/common/constants";

import { document } from "../../openapi/specification";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { BacklogController } from "./backlog.controller";
import type { SyncStatusService } from "./sync-status.service";
import type { SyncTriggerService } from "./sync-trigger.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in the two
 * service suites and the composition in `sync.resources.spec.ts`. What lives *here* is the
 * ticket's access criterion, which no other test can see: **member+ role enforced**.
 *
 * A `@Roles()` that is deleted from a controller leaves every unit spec in this module green,
 * because none of them goes through the router that reads the metadata — so the decoration is
 * asserted as metadata, exactly as `roles.integration-spec.ts` argues for the tenancy API.
 */

const TENANT: Organization = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

describe("the backlog controller", () => {
  let status: jest.Mocked<SyncStatusService>;
  let trigger: jest.Mocked<SyncTriggerService>;
  let controller: BacklogController;
  let reflector: Reflector;

  beforeEach(() => {
    status = {
      status: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<SyncStatusService>;
    trigger = {
      trigger: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<SyncTriggerService>;

    controller = new BacklogController(status, trigger);
    reflector = new Reflector();
  });

  it("hands the status the workspace the guard established, and nothing from the request", async () => {
    await controller.syncStatus(TENANT);

    expect(status.status).toHaveBeenCalledWith("acme-robotics-id");
  });

  it("hands the trigger the same workspace", async () => {
    await controller.sync(TENANT);

    expect(trigger.trigger).toHaveBeenCalledWith("acme-robotics-id");
  });

  it("requires a workspace, by saying nothing", () => {
    // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before either
    // handler runs, which is what "under the tenant context" means.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, BacklogController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.syncStatus)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.sync)).toBeUndefined();
  });

  it("names no roles on the read, because looking is every member's", () => {
    // Under the roles guard's own rule a bare route is any of the four, `viewer` included —
    // which is the right default for a status somebody is reading.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.syncStatus)).toBeUndefined();
  });

  it("requires member or better on the trigger", () => {
    // The ticket's *member+ role enforced*. A `viewer` clicking a freshness tag would be a
    // viewer spending an hourly GitHub budget somebody else's poll depends on.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.sync)).toEqual([...CONTRIBUTORS]);
  });

  it("does not require an administrator, which would be the wrong list", () => {
    // Deliberately wider than `ADMINISTRATORS`: a re-sync is work rather than administration,
    // and mockup 03 is a screen every contributor uses.
    const roles = reflector.get<string[]>(REQUIRED_ROLES, controller.sync);

    expect(roles).toContain("member");
    expect([...ADMINISTRATORS].every((role) => roles.includes(role))).toBe(true);
  });

  it("answers the trigger 202, because the cycle outlives the response", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.sync)).toBe(HttpStatus.ACCEPTED);
  });

  it("mounts the two routes the ticket published, under the backlog prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BacklogController)).toBe("backlog");
    expect(Reflect.getMetadata(PATH_METADATA, controller.syncStatus)).toBe("sync-status");
    expect(Reflect.getMetadata(PATH_METADATA, controller.sync)).toBe("sync");
    // 0 is Nest's `RequestMethod.GET` and 1 its `POST`; the read must not be a write.
    expect(Reflect.getMetadata(METHOD_METADATA, controller.syncStatus)).toBe(0);
    expect(Reflect.getMetadata(METHOD_METADATA, controller.sync)).toBe(1);
  });

  it("offers no listing — `GET /api/v1/backlog` is M.1's", () => {
    // The scope boundary. A listing here would be a second opinion about what the backlog is.
    expect(controller).not.toHaveProperty("list");
    expect(document().paths["/api/v1/backlog"]).toBeUndefined();
  });

  it("publishes the read and the trigger, and says what each one costs", () => {
    const status = document().paths["/api/v1/backlog/sync-status"];
    const sync = document().paths["/api/v1/backlog/sync"];

    expect(Object.keys(status)).toEqual(["get"]);
    expect(Object.keys(sync)).toEqual(["post"]);
    expect(sync.post?.description).toContain("member");
    expect(Object.keys(sync.post?.responses ?? {})).toContain("409");
  });
});
