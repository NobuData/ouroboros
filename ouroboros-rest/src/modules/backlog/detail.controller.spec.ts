import { Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";

import { document } from "../../openapi/specification";
import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { BacklogController } from "./backlog.controller";
import { BacklogDetailController } from "./detail.controller";
import type { BacklogDetailService } from "./detail.service";
import { BacklogModule } from "./backlog.module";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules are in
 * `detail.service.spec.ts` and the statements in `detail.repository.spec.ts`.
 *
 * What lives here is what no other unit test can see: the workspace a handler acts in comes from
 * the guard rather than from the request, **opening a panel names no roles**, and this route is a
 * bare parameter under a prefix that already has literal segments — so the order the module lists
 * its controllers in is a routing rule. `detail.integration-spec.ts` asserts the *consequence* of
 * that order over a real router; what is asserted here is the order itself, so a reader who sorts
 * the list alphabetically is told why not before the integration suite tells them.
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

describe("the backlog detail controller", () => {
  let detail: jest.Mocked<BacklogDetailService>;
  let controller: BacklogDetailController;
  let reflector: Reflector;

  beforeEach(() => {
    detail = {
      detailOf: jest.fn().mockResolvedValue({ issue: {}, estimate: null, history: [] }),
    } as unknown as jest.Mocked<BacklogDetailService>;

    controller = new BacklogDetailController(detail);
    reflector = new Reflector();
  });

  it("hands the service the workspace the guard established, and the id the path named", async () => {
    await controller.detailOf(TENANT, { id: ISSUE });

    expect(detail.detailOf).toHaveBeenCalledWith("acme-robotics-id", ISSUE);
  });

  it("requires a workspace, by saying nothing", () => {
    expect(reflector.get<boolean>(TENANT_OPTIONAL, BacklogDetailController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.detailOf)).toBeUndefined();
  });

  it("names no roles, because opening a panel is every member's", () => {
    // The panel's *buttons* are a different question — **Re-estimate** is `POST {id}/estimate`
    // and names `CONTRIBUTORS` — but reading what they would act on spends nothing.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.detailOf)).toBeUndefined();
  });

  it("is a `GET` on one parameterised segment under the shared prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BacklogDetailController)).toBe("backlog");
    expect(Reflect.getMetadata(PATH_METADATA, controller.detailOf)).toBe(":id");
    expect(Reflect.getMetadata(METHOD_METADATA, controller.detailOf)).toBe(0);
  });

  it("is registered after the controller holding the literal segments", () => {
    // Express matches in registration order. With this controller first, every
    // `GET /backlog/sync-status` would become a request for an issue whose id is the word
    // *sync-status* — a `422` on a route that exists.
    const controllers = Reflect.getMetadata("controllers", BacklogModule) as unknown[];
    const names = controllers.map((entry) => (entry as { name: string }).name);

    expect(names.indexOf("BacklogController")).toBeLessThan(
      names.indexOf("BacklogDetailController"),
    );
  });

  it("is a third controller rather than a route on either of the other two", () => {
    expect(BacklogController.prototype).not.toHaveProperty("detailOf");
    expect(BacklogDetailController.prototype).not.toHaveProperty("list");
    expect(BacklogDetailController.prototype).not.toHaveProperty("sync");
  });

  it("is published, with the id as its only path parameter", () => {
    const published = document().paths["/api/v1/backlog/{id}"];
    const names = (published?.get?.parameters ?? []).map(
      (parameter) => (parameter as { name?: string; $ref?: string }).name ?? "",
    );

    expect(Object.keys(published ?? {})).toEqual(["get"]);
    expect(names).toContain("id");
  });
});
