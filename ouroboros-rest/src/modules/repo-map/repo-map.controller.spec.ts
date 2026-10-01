/**
 * The repo-map routes: the regenerate (#415), an administrator's, answering the generator's
 * report; and the status (#422), every member's, answering where each repository's map stands.
 */

import { PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { RepoMapController } from "./repo-map.controller";
import type { RepoMapReport, RepoMapStatusList } from "./repo-map.resources";
import type { RepoMapService } from "./repo-map.service";

describe("POST /knowledge/repo-map/regenerate", () => {
  it("is an administrator's — a regenerate may publish a skill version", () => {
    expect(Reflect.getMetadata(PATH_METADATA, RepoMapController)).toBe("knowledge/repo-map");
    expect(Reflect.getMetadata(REQUIRED_ROLES, RepoMapController.prototype.regenerate)).toEqual([
      "owner",
      "admin",
    ]);
  });

  it("regenerates for the tenant, attributed to the session's person", async () => {
    const report = { outcome: "unchanged" } as RepoMapReport;
    const regenerate = jest.fn().mockResolvedValue(report);
    const controller = new RepoMapController({ regenerate } as unknown as RepoMapService);

    await expect(
      controller.regenerate({ id: "org" } as Organization, { user: { id: "ken" } } as Principal, {
        repo: "acme/helios",
      }),
    ).resolves.toBe(report);
    expect(regenerate).toHaveBeenCalledWith("org", "acme/helios", "ken");
  });
});

describe("GET /knowledge/repo-map", () => {
  it("is every member's — it reads, and a member is who needs telling pending from failed", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, RepoMapController.prototype.status)).toBeUndefined();
  });

  it("answers the tenant's statuses", async () => {
    const list: RepoMapStatusList = { items: [] };
    const status = jest.fn().mockResolvedValue(list);
    const controller = new RepoMapController({ status } as unknown as RepoMapService);

    await expect(controller.status({ id: "org" } as Organization)).resolves.toBe(list);
    expect(status).toHaveBeenCalledWith("org");
  });
});
