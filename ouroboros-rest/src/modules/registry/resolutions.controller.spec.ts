import { Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { ResolutionSnapshotsController } from "./resolutions.controller";
import type { ResolutionSnapshotsService } from "./resolutions.service";

/**
 * The route's declarations ([#589](https://github.com/NobuData/ouroboros/issues/589)): the path,
 * that any member may read it, and that the workspace is the session's. The pipeline answering a
 * real request — seeded run #482 included — is `resolutions.integration-spec.ts`.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

describe("the resolution snapshot controller", () => {
  let service: jest.Mocked<Pick<ResolutionSnapshotsService, "latest">>;
  let controller: ResolutionSnapshotsController;

  beforeEach(() => {
    service = { latest: jest.fn().mockResolvedValue({ alias: "coder-max", snapshot: null }) };
    controller = new ResolutionSnapshotsController(
      service as unknown as ResolutionSnapshotsService,
    );
  });

  it("reads the workspace the guard established, for the alias the query named", async () => {
    await controller.latest(WORKSPACE, { alias: "coder-max" });

    expect(service.latest).toHaveBeenCalledWith(WORKSPACE.id, "coder-max");
  });

  it("answers what the service found, unchanged", async () => {
    const found = { alias: "coder-max", snapshot: null };
    service.latest.mockResolvedValue(found);

    await expect(controller.latest(WORKSPACE, { alias: "coder-max" })).resolves.toBe(found);
  });

  it("mounts at /registry/resolutions/latest", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResolutionSnapshotsController)).toBe(
      "registry/resolutions",
    );
    expect(Reflect.getMetadata(PATH_METADATA, ResolutionSnapshotsController.prototype.latest)).toBe(
      "latest",
    );
  });

  it("requires no particular role — a transcript of what routing did is reading", () => {
    expect(
      new Reflector().get<string[] | undefined>(
        REQUIRED_ROLES,
        ResolutionSnapshotsController.prototype.latest,
      ),
    ).toBeUndefined();
  });

  it("requires a workspace, because nothing here says otherwise", () => {
    expect(
      new Reflector().get<boolean | undefined>(
        TENANT_OPTIONAL,
        ResolutionSnapshotsController.prototype.latest,
      ),
    ).toBeUndefined();
  });
});
