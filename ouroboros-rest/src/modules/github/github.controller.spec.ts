import { Reflector } from "@nestjs/core";

import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { FIXTURE_MASK, FIXTURE_TOKEN, FIXTURE_WORKSPACE } from "./github.fixture";
import { GithubTokenController } from "./github.controller";
import type { GithubCredentialsService } from "./github.credentials.service";
import type { GithubTokenResource } from "./github.resources";

/**
 * The routes' declarations, per `domains.controller.spec.ts`'s argument — and here that
 * includes the acceptance criterion itself: **only owner and admin may set, rotate or clear.**
 *
 * The read carries the same gate, which is a deliberate departure from
 * `settings.controller.ts`, and the assertion says so: a viewer looking at the auto-merge
 * switch learns a policy, and a viewer looking at this learns that a credential exists, when
 * it was last rotated and its last four characters. That is reconnaissance rather than
 * transparency.
 *
 * The guard honouring the metadata is `roles.guard.spec.ts`; the whole pipeline refusing a
 * member is `github.integration-spec.ts`. What is held here is that the handlers still carry
 * the right ask, and that *who* is recorded comes from the session rather than the body.
 */

const WORKSPACE = { id: FIXTURE_WORKSPACE } as Organization;

const CONFIGURED: GithubTokenResource = {
  configured: true,
  masked: FIXTURE_MASK,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

const CLEARED: GithubTokenResource = {
  configured: false,
  masked: null,
  createdAt: null,
  updatedAt: null,
};

describe("the GitHub token controller", () => {
  let service: jest.Mocked<GithubCredentialsService>;
  let controller: GithubTokenController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(CONFIGURED),
      set: jest.fn().mockResolvedValue(CONFIGURED),
      clear: jest.fn().mockResolvedValue(CLEARED),
    } as unknown as jest.Mocked<GithubCredentialsService>;

    controller = new GithubTokenController(service);
  });

  it("scopes the read to the workspace the guard established", async () => {
    await expect(controller.read(WORKSPACE)).resolves.toEqual(CONFIGURED);

    expect(service.read).toHaveBeenCalledWith(FIXTURE_WORKSPACE);
  });

  it("attributes a write to the session rather than to anything in the body", async () => {
    await expect(
      controller.set(WORKSPACE, principalFor(), { token: FIXTURE_TOKEN }),
    ).resolves.toEqual(CONFIGURED);

    // A body field naming the actor would let a client attribute its own writes to somebody
    // else — which is the one thing an audit trail cannot survive.
    expect(service.set).toHaveBeenCalledWith(
      { organizationId: FIXTURE_WORKSPACE, actorId: FIXTURE_USER.id, at: expect.any(Date) as Date },
      FIXTURE_TOKEN,
    );
  });

  it("attributes a clear the same way", async () => {
    await expect(controller.clear(WORKSPACE, principalFor())).resolves.toEqual(CLEARED);

    expect(service.clear).toHaveBeenCalledWith({
      organizationId: FIXTURE_WORKSPACE,
      actorId: FIXTURE_USER.id,
      at: expect.any(Date) as Date,
    });
  });

  it("asks administrators of every route on the surface, the read included", () => {
    const reflector = new Reflector();

    for (const handler of [controller.read, controller.set, controller.clear]) {
      // Declared on the class rather than three times on the methods, so a fourth route
      // cannot arrive without the gate.
      expect(
        reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [handler, GithubTokenController]),
      ).toEqual([...ADMINISTRATORS]);
    }
  });

  it("has no route that could answer with a token", () => {
    // Structural: `provider-connections` has a reveal because a person has to copy an API key
    // into another tool. Nothing copies this token anywhere, so an endpoint that returned it
    // would exist purely to be the way it leaks.
    const routes = Object.getOwnPropertyNames(GithubTokenController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(routes.sort()).toEqual(["clear", "read", "set"]);
  });
});
