import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { HUMAN_ONLY } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ResearchCatalogController } from "./catalog.controller";
import type { ResearchCatalogService } from "./catalog.service";

/**
 * The composer's catalog routes (CN.2, #628): two member-open GETs under `/research`, the kinds
 * read for the session's workspace and the tools read for nobody's.
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

  it("is open to every member, people and service accounts alike", () => {
    for (const name of ["kinds", "tools"]) {
      expect(Reflect.getMetadata(REQUIRED_ROLES, handler(name))).toBeUndefined();
      expect(Reflect.getMetadata(HUMAN_ONLY, handler(name))).toBeUndefined();
    }
  });

  it("reads the kinds of the session's workspace, and the tools of the installation", async () => {
    const kinds = jest.fn().mockResolvedValue({ kinds: [] });
    const tools = jest.fn().mockResolvedValue({ tools: [] });
    const controller = new ResearchCatalogController({
      kinds,
      tools,
    } as unknown as ResearchCatalogService);

    expect(await controller.kinds(TENANT)).toEqual({ kinds: [] });
    expect(kinds).toHaveBeenCalledWith("org-acme");

    expect(await controller.tools()).toEqual({ tools: [] });
    expect(tools).toHaveBeenCalledWith();
  });
});
