import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { document } from "../../openapi/specification";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { EstimationController } from "./estimation.controller";
import type { EstimationTriggerService } from "./estimation.trigger.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in
 * `estimation.trigger.service.spec.ts`. What lives *here* is the ticket's access criterion,
 * which no other unit test can see: **member+ for single, admin+ for all**.
 *
 * A `@Roles()` deleted from a controller leaves every unit spec in this module green, because
 * none of them goes through the router that reads the metadata — so the decoration is asserted
 * as metadata, exactly as `roles.integration-spec.ts` argues for the tenancy API, and again
 * over the wire in `estimation.integration-spec.ts`.
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

describe("the estimation controller", () => {
  let trigger: jest.Mocked<EstimationTriggerService>;
  let controller: EstimationController;
  let reflector: Reflector;

  beforeEach(() => {
    trigger = {
      estimate: jest.fn().mockResolvedValue({}),
      estimateAll: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EstimationTriggerService>;

    controller = new EstimationController(trigger);
    reflector = new Reflector();
  });

  it("hands the single press the workspace the guard established, and the path's id", async () => {
    await controller.estimate(TENANT, { id: ISSUE });

    expect(trigger.estimate).toHaveBeenCalledWith("acme-robotics-id", ISSUE);
  });

  it("hands the fan-out the workspace and nothing else", async () => {
    await controller.estimateAll(TENANT);

    expect(trigger.estimateAll).toHaveBeenCalledWith("acme-robotics-id");
  });

  it("requires a workspace, by saying nothing", () => {
    // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before either
    // handler runs, which is what "under the tenant context" means.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, EstimationController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.estimate)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.estimateAll)).toBeUndefined();
  });

  it("requires member or better to re-estimate one issue", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.estimate)).toEqual([...CONTRIBUTORS]);
  });

  it("requires an administrator to re-estimate everything", () => {
    // The ticket's own split, and the reason is what the work costs: a fan-out spends the
    // workspace's engine quota in one press, and real money once a model is behind it.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.estimateAll)).toEqual([
      ...ADMINISTRATORS,
    ]);
  });

  it("gates the two differently, which is the whole point of having two", () => {
    const single = reflector.get<string[]>(REQUIRED_ROLES, controller.estimate);
    const all = reflector.get<string[]>(REQUIRED_ROLES, controller.estimateAll);

    expect(single).toContain("member");
    expect(all).not.toContain("member");
  });

  it("answers both 202, because the work outlives the response", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.estimate)).toBe(HttpStatus.ACCEPTED);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.estimateAll)).toBe(
      HttpStatus.ACCEPTED,
    );
  });

  it("mounts both under the backlog prefix, as posts", () => {
    expect(Reflect.getMetadata(PATH_METADATA, EstimationController)).toBe("backlog");
    expect(Reflect.getMetadata(PATH_METADATA, controller.estimateAll)).toBe("estimate-all");
    expect(Reflect.getMetadata(PATH_METADATA, controller.estimate)).toBe(":id/estimate");
    // 1 is Nest's `RequestMethod.POST`; neither of these reads.
    expect(Reflect.getMetadata(METHOD_METADATA, controller.estimateAll)).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, controller.estimate)).toBe(1);
  });

  it("declares the literal path before the parameterised one", () => {
    // They cannot actually collide — two segments against three — but `app.module.ts` records
    // the rule that a literal segment is registered ahead of a parameterised one, and a reader
    // should not have to re-derive that these two are the exception rather than an oversight.
    const declared = Object.getOwnPropertyNames(EstimationController.prototype);

    expect(declared.indexOf("estimateAll")).toBeLessThan(declared.indexOf("estimate"));
  });

  it("publishes both operations, and says what each one costs", () => {
    const all = document().paths["/api/v1/backlog/estimate-all"];
    const single = document().paths["/api/v1/backlog/{id}/estimate"];

    expect(Object.keys(all)).toEqual(["post"]);
    expect(Object.keys(single)).toEqual(["post"]);
    expect(all.post?.description).toContain("admin");
    expect(single.post?.description).toContain("member");
    // The three refusals a client has to branch on.
    expect(Object.keys(single.post?.responses ?? {})).toEqual(
      expect.arrayContaining(["404", "409", "429"]),
    );
    expect(Object.keys(all.post?.responses ?? {})).toEqual(
      expect.arrayContaining(["403", "409", "429"]),
    );
  });

  it("offers no read — the issue detail is M.2's, and M.2 landed it", () => {
    // The scope boundary, which held: `GET /api/v1/backlog/{id}` is
    // [#111](https://github.com/NobuData/ouroboros/issues/111)'s and it is served by
    // `backlog/detail.controller.ts`, not by anything here. A read on *this* controller would be
    // a second opinion about what an issue is.
    //
    // Asserted as *somebody else serves it* rather than as *nobody does*, which is what this
    // check said while the path was unbuilt. The two are the same boundary read before and after
    // the ticket beside it shipped.
    expect(controller).not.toHaveProperty("read");
    expect(EstimationController.prototype).not.toHaveProperty("detailOf");
    expect(Object.keys(document().paths["/api/v1/backlog/{id}"] ?? {})).toEqual(["get"]);
  });
});
