import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ProviderHealthController } from "./provider-health.controller";
import type { ProviderHealthService } from "./provider-health.service";
import type { ProviderHealthStripResource } from "./resources";

/**
 * The route's declarations — and the two that carry this half of the ticket: the workspace
 * comes from the guard rather than from anything a caller wrote, and there is exactly one
 * handler, which reads.
 *
 * The absent second handler is the interesting assertion. The obvious next endpoint is
 * *check now*, and it is exactly the one that must not exist: it would let anybody with a
 * session make this service issue outbound requests at whatever rate they can click — a small
 * denial of service against a vendor's rate limit, signed with the workspace's own credential.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

const STRIP: ProviderHealthStripResource = {
  providers: [
    {
      id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
      kind: "ollama",
      displayName: "Ollama",
      status: "active",
      check: "reachability",
      checkedAt: "2026-08-23T10:00:00.000Z",
      host: "workstation",
      latencyMs: null,
      models: 3,
      detail: null,
      errorClass: null,
      meta: "workstation · 3 models",
    },
  ],
};

describe("the provider health controller", () => {
  let service: jest.Mocked<ProviderHealthService>;
  let controller: ProviderHealthController;

  beforeEach(() => {
    service = {
      strip: jest.fn().mockResolvedValue(STRIP),
    } as unknown as jest.Mocked<ProviderHealthService>;
    controller = new ProviderHealthController(service);
  });

  it("scopes the strip to the workspace the guard established", async () => {
    await expect(controller.list(WORKSPACE)).resolves.toEqual(STRIP);

    expect(service.strip).toHaveBeenCalledWith(WORKSPACE.id);
  });

  it("is every member's, viewers included", () => {
    // No `@Roles()`: under the roles guard's own rule a bare route is any of the four, and
    // *is Ollama up* is the kind of thing a viewer exists to be able to look at.
    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });

  it("lives under routing rather than squatting on mockup 07's collection root", () => {
    // `/api/v1/providers` is that roadmap's CRUD surface (decision M2). A health strip that
    // had taken the collection root would be the thing 07 had to negotiate with.
    expect(Reflect.getMetadata(PATH_METADATA, ProviderHealthController)).toBe("routing/providers");
  });

  it("declares one handler, and it reads", () => {
    const handlers = Object.getOwnPropertyNames(ProviderHealthController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(handlers).toEqual(["list"]);
  });
});
