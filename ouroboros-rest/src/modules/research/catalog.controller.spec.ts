import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../auth/principal";
import { HUMAN_ONLY } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ResearchCatalogController } from "./catalog.controller";
import type { ResearchCatalogService } from "./catalog.service";

/**
 * The catalog routes (CN.2, #628; CN.3, #629): two member-open GETs under `/research`, both read
 * for the session's workspace, and the enable flow's administrator-only save.
 */

const TENANT = { id: "org-acme" } as Organization;

const handler = (name: string): object =>
  Object.getOwnPropertyDescriptor(ResearchCatalogController.prototype, name)!.value as object;

describe("the research catalog controller", () => {
  it("serves GET /research/kinds and GET /research/tools", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResearchCatalogController)).toBe("research");
    expect(Reflect.getMetadata(PATH_METADATA, handler("kinds"))).toBe("kinds");
    expect(Reflect.getMetadata(METHOD_METADATA, handler("kinds"))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler("tools"))).toBe("tools");
    expect(Reflect.getMetadata(METHOD_METADATA, handler("tools"))).toBe(RequestMethod.GET);
  });

  it("serves PUT /research/tools/:slug to administrators, and only to people", () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler("enable"))).toBe("tools/:slug");
    expect(Reflect.getMetadata(METHOD_METADATA, handler("enable"))).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler("enable"))).toEqual(["owner", "admin"]);
    expect(Reflect.getMetadata(HUMAN_ONLY, handler("enable"))).toBe(true);
  });

  it("is open to every member for the reads, people and service accounts alike", () => {
    for (const name of ["kinds", "tools"]) {
      expect(Reflect.getMetadata(REQUIRED_ROLES, handler(name))).toBeUndefined();
      expect(Reflect.getMetadata(HUMAN_ONLY, handler(name))).toBeUndefined();
    }
  });

  it("reads the kinds and the tools of the session's workspace", async () => {
    const kinds = jest.fn().mockResolvedValue({ kinds: [] });
    const tools = jest.fn().mockResolvedValue({ tools: [], connectedCount: 0 });
    const controller = new ResearchCatalogController({
      kinds,
      tools,
    } as unknown as ResearchCatalogService);

    expect(await controller.kinds(TENANT)).toEqual({ kinds: [] });
    expect(kinds).toHaveBeenCalledWith("org-acme");

    expect(await controller.tools(TENANT)).toEqual({ tools: [], connectedCount: 0 });
    expect(tools).toHaveBeenCalledWith("org-acme");
  });

  it("saves a tool's settings for the session's workspace, as the person saving", async () => {
    const enable = jest.fn().mockResolvedValue({ slug: "web" });
    const controller = new ResearchCatalogController({
      enable,
    } as unknown as ResearchCatalogService);

    expect(
      await controller.enable(
        TENANT,
        { user: { id: "user-1" } } as Principal,
        { slug: "web" },
        { config: { provider: "searxng" } },
      ),
    ).toEqual({ slug: "web" });
    expect(enable).toHaveBeenCalledWith("org-acme", "web", { provider: "searxng" }, "user-1");
  });
});
