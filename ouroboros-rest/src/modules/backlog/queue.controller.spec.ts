import { Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";

import { document } from "../../openapi/specification";
import type { Organization } from "../db/schema";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { BacklogController } from "./backlog.controller";
import { BacklogDetailController } from "./detail.controller";
import { BacklogModule } from "./backlog.module";
import { BacklogQueueController } from "./queue.controller";
import type { BacklogQueueService } from "./queue.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules are in
 * `queue.service.spec.ts` and the statements in `queue.repository.spec.ts`.
 *
 * What lives here is what no other unit test can see: the workspace a handler queues into comes
 * from the guard rather than from the request, **queueing is `member+`** — the BA-C.3 policy the
 * ticket names — and this route is a literal segment under a prefix that also has a bare
 * parameter, so it cannot be shadowed however the module's list is sorted.
 */

const TENANT: Organization = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

const ISSUE = "5eed0018-0000-4000-8000-000000000485";

describe("the backlog queue controller", () => {
  let queue: jest.Mocked<BacklogQueueService>;
  let controller: BacklogQueueController;
  let reflector: Reflector;

  beforeEach(() => {
    queue = {
      queueSelection: jest.fn().mockResolvedValue({ items: [], estMinutes: 0 }),
    } as unknown as jest.Mocked<BacklogQueueService>;

    controller = new BacklogQueueController(queue);
    reflector = new Reflector();
  });

  it("hands the service the workspace the guard established, and the body as sent", async () => {
    const body = { issueIds: [ISSUE], workflow: "standard-fix" };

    await controller.queueSelection(TENANT, body);

    expect(queue.queueSelection).toHaveBeenCalledWith("acme-robotics-id", body);
  });

  it("requires a workspace, by saying nothing", () => {
    expect(reflector.get<boolean>(TENANT_OPTIONAL, BacklogQueueController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.queueSelection)).toBeUndefined();
  });

  it("names `member+`, because queueing is work rather than looking", () => {
    // The BA-C.3 policy the ticket names. A `viewer` may read the backlog and may not commit
    // the workspace's loop to a list of issues.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.queueSelection)).toEqual([
      ...CONTRIBUTORS,
    ]);
  });

  it("is not `admin+` like re-estimating the whole backlog", () => {
    // That one fans out over every issue in one press; this one queues exactly what a person
    // selected. The two routes sit under one prefix with different lists on purpose.
    const roles = reflector.get<string[]>(REQUIRED_ROLES, controller.queueSelection) ?? [];

    expect(roles).toContain("member");
  });

  it("is a `POST` on a literal segment under the shared prefix", () => {
    // Nest's method enum: 0 is GET and 1 is POST.
    expect(Reflect.getMetadata(PATH_METADATA, BacklogQueueController)).toBe("backlog");
    expect(Reflect.getMetadata(PATH_METADATA, controller.queueSelection)).toBe("queue");
    expect(Reflect.getMetadata(METHOD_METADATA, controller.queueSelection)).toBe(1);
  });

  it("cannot be shadowed by the bare parameter beside it, whatever the order", () => {
    // `GET /backlog/{id}` is a different method, so the registration-order rule M.2 recorded
    // does not reach this route. Asserted rather than assumed, because the list is sortable.
    expect(Reflect.getMetadata(METHOD_METADATA, BacklogDetailController.prototype.detailOf)).toBe(
      0,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.queueSelection)).toBe(1);
  });

  it("is a fourth controller rather than a route on any of the other three", () => {
    const controllers = Reflect.getMetadata("controllers", BacklogModule) as unknown[];

    expect(controllers).toContain(BacklogQueueController);
    expect(BacklogController.prototype).not.toHaveProperty("queueSelection");
    expect(BacklogQueueController.prototype).not.toHaveProperty("detailOf");
    expect(BacklogQueueController.prototype).not.toHaveProperty("list");
  });

  it("is published, and answers a created body", () => {
    const published = document().paths["/api/v1/backlog/queue"];

    expect(Object.keys(published ?? {})).toEqual(["post"]);
    expect(Object.keys(published?.post?.responses ?? {})).toContain("201");
  });
});
