import { Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";

import { document } from "../../openapi/specification";
import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { BacklogController } from "./backlog.controller";
import { BacklogListingController } from "./listing.controller";
import type { BacklogListingService } from "./listing.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules are in
 * `listing.service.spec.ts` and the statements in `listing.repository.spec.ts`.
 *
 * What lives here is what no other test can see: the workspace a handler acts in comes from the
 * guard rather than from the request, the route is a `GET` under the shared prefix that shadows
 * none of its three neighbours, and **the listing names no roles** — reading a backlog is
 * looking, which is what a `viewer` is for. A `@Roles()` added here would be invisible to every
 * unit spec in this module, because none of them goes through the router that reads the
 * metadata.
 */

const TENANT: Organization = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

describe("the backlog listing controller", () => {
  let listing: jest.Mocked<BacklogListingService>;
  let controller: BacklogListingController;
  let reflector: Reflector;

  beforeEach(() => {
    listing = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as jest.Mocked<BacklogListingService>;

    controller = new BacklogListingController(listing);
    reflector = new Reflector();
  });

  it("hands the service the workspace the guard established, and nothing from the request", async () => {
    await controller.list(TENANT, { state: "open" });

    expect(listing.list).toHaveBeenCalledWith("acme-robotics-id", { state: "open" });
  });

  it("passes the query string through as the DTO validated it", async () => {
    await controller.list(TENANT, { labels: ["bug"], sort: "number", limit: 10 });

    expect(listing.list).toHaveBeenCalledWith("acme-robotics-id", {
      labels: ["bug"],
      sort: "number",
      limit: 10,
    });
  });

  it("requires a workspace, by saying nothing", () => {
    expect(reflector.get<boolean>(TENANT_OPTIONAL, BacklogListingController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.list)).toBeUndefined();
  });

  it("names no roles, because reading a backlog is every member's", () => {
    // The contrast is the two routes beside it: `POST /backlog/sync` spends the workspace's
    // GitHub budget and `POST /backlog/estimate-all` its engine quota. A listing spends nothing.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });

  it("is a `GET` on the prefix itself, shadowing none of its neighbours", () => {
    // `sync-status`, `sync` and `estimate-all` are literal segments and `{id}/estimate` is three;
    // this path has no segment at all, so only a request that named nothing reaches it.
    expect(Reflect.getMetadata(PATH_METADATA, BacklogListingController)).toBe("backlog");
    expect(Reflect.getMetadata(PATH_METADATA, controller.list)).toBe("/");
    expect(Reflect.getMetadata(METHOD_METADATA, controller.list)).toBe(0);
  });

  it("is a second controller rather than a route on the sync one", () => {
    // `backlog.module.ts` asked for this: one controller is about the sync and one is about the
    // backlog, and only the second grows filters.
    expect(BacklogController.prototype).not.toHaveProperty("list");
    expect(BacklogListingController.prototype).not.toHaveProperty("sync");
  });

  it("is published, with the filter bar as its parameters", () => {
    const listed = document().paths["/api/v1/backlog"];
    const names = (listed?.get?.parameters ?? []).map(
      (parameter) => (parameter as { name?: string; $ref?: string }).name ?? "",
    );

    expect(Object.keys(listed ?? {})).toEqual(["get"]);
    expect(names).toEqual(expect.arrayContaining(["repo", "labels", "state", "sort", "q"]));
  });
});
