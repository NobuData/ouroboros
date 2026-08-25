import { Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";

import type { Organization } from "../db/schema";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { RegistryReadController } from "./registry-read.controller";
import type { RegistryReadService } from "./registry-read.service";

/**
 * The route's declarations ([#588](https://github.com/NobuData/ouroboros/issues/588)) — which
 * is what a controller spec in this service is about.
 *
 * Three of them are the ticket: **any member may read it**, so no `@Roles()`; **the workspace is
 * the session's**, so it comes from the guard and never from anything a caller wrote; and the
 * path is `registry` **exactly**, so this cannot shadow the four `registry/…` surfaces already
 * mounted whatever order `app.module.ts` lists the modules in.
 *
 * The guard honouring the metadata is `roles.guard.spec.ts`; the whole pipeline answering a real
 * request is `registry-read.integration-spec.ts`.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

describe("the registry read controller", () => {
  let service: jest.Mocked<Pick<RegistryReadService, "read">>;
  let controller: RegistryReadController;

  beforeEach(() => {
    service = { read: jest.fn().mockResolvedValue({ aliases: [] }) };
    controller = new RegistryReadController(service as unknown as RegistryReadService);
  });

  it("reads the workspace the guard established", async () => {
    await controller.read(WORKSPACE);

    expect(service.read).toHaveBeenCalledWith(WORKSPACE.id);
  });

  it("answers the payload the service composed, unchanged", async () => {
    const composed = { aliases: [] };
    service.read.mockResolvedValue(composed);

    await expect(controller.read(WORKSPACE)).resolves.toBe(composed);
  });

  it("requires no particular role — a viewer may look at which models a workspace allows", () => {
    const roles = new Reflector().get<string[] | undefined>(
      REQUIRED_ROLES,
      RegistryReadController.prototype.read,
    );

    expect(roles).toBeUndefined();
  });

  it("requires a workspace, because nothing here says otherwise", () => {
    // No `@TenantOptional()`, so a session acting in no workspace is a `400
    // organization_required` before the handler runs.
    const optional = new Reflector().get<boolean | undefined>(
      TENANT_OPTIONAL,
      RegistryReadController.prototype.read,
    );

    expect(optional).toBeUndefined();
  });

  it("mounts on the registry path exactly, so it shadows nothing under it", () => {
    // `param-schema`, `prices`, `aliases` and `import` are all `registry/…`; a `@Get()` here
    // matches `/api/v1/registry` and nothing else, which is what makes this module's position
    // in `app.module.ts` free rather than load-bearing.
    const path = Reflect.getMetadata(PATH_METADATA, RegistryReadController) as string;
    const route = Reflect.getMetadata(PATH_METADATA, RegistryReadController.prototype.read) as
      string | undefined;

    expect(path).toBe("registry");
    expect(route === undefined || route === "/").toBe(true);
  });

  it("takes the workspace from the guard and never from a query", () => {
    const source = RegistryReadController.prototype.read.toString();

    expect(source).not.toContain("orgId");
    expect(source).not.toContain("organizationId");
  });
});
