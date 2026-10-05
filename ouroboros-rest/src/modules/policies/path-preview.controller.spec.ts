import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { DbModule } from "../db/db.module";
import { DetectionModule } from "../detection/detection.module";
import { RepoMapRepository } from "../repo-map/repo-map.repository";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { PathPreviewController } from "./path-preview.controller";
import { PathPreviewModule } from "./path-preview.module";
import { PathPreviewService } from "./path-preview.service";

/**
 * The match preview's route and wiring (BS.4, #494): owner/admin, scoped to the session's
 * workspace, and a module of its own so `PoliciesModule` still imports no plane.
 */

const ADMIN: ActiveMembership = { tenant: { id: "org-494" } as Organization, roles: ["admin"] };

describe("the path preview controller", () => {
  it("previews in the session's workspace", async () => {
    const preview = jest.fn().mockResolvedValue({ repositories: [] });
    const controller = new PathPreviewController({ preview } as unknown as PathPreviewService);

    await expect(controller.preview(ADMIN, { globs: ["boot/**"] })).resolves.toEqual({
      repositories: [],
    });
    expect(preview).toHaveBeenCalledWith("org-494", ["boot/**"]);
  });

  it("asks administrators", () => {
    expect(
      new Reflector().get<string[]>(REQUIRED_ROLES, PathPreviewController.prototype.preview),
    ).toEqual([...ADMINISTRATORS]);
  });
});

describe("the path preview module", () => {
  it("declares the route, the preview and the enabled-repositories statement", () => {
    expect(Reflect.getMetadata("controllers", PathPreviewModule)).toEqual([PathPreviewController]);
    expect(Reflect.getMetadata("providers", PathPreviewModule)).toEqual([
      PathPreviewService,
      RepoMapRepository,
    ]);
    expect(Reflect.getMetadata("imports", PathPreviewModule)).toEqual([DbModule, DetectionModule]);
  });
});
