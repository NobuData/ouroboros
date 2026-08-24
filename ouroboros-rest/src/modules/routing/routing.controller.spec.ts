import { Reflector } from "@nestjs/core";

import { principalFor } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { RoutingManagementService } from "./management.service";
import type { RoutingSpendResource } from "./resources";
import { RoutingController } from "./routing.controller";
import type { RoutePolicyDto } from "./routing.dto";
import type { RoutingStatsService } from "./stats.service";

/**
 * What a controller spec in this service is about — the routes' declarations, per
 * `domains.controller.spec.ts`'s argument — and here that is two things this ticket is
 * measured on.
 *
 * **The role gate**, which is the acceptance criterion *"owner/admin write and member read
 * enforced server-side on every route, verified per endpoint"*. The guard honouring the
 * metadata is `roles.guard.spec.ts`'s; the whole pipeline refusing a member is
 * `management.integration-spec.ts`'s. What is held here is that every handler still carries
 * the right ask, and that a handler added later without one fails a test rather than a review.
 *
 * **The workspace and the actor**, which come from the guard and the session and never from a
 * path or a body. A route save attributed to whoever the client said would make
 * `route_revisions` worth nothing.
 */

/** The session every write below is attributed to. */
const PRINCIPAL = principalFor();

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

/** What the service answers with. Its shape is `resources.spec.ts`'s business, not this file's. */
const SAVED = { revisionId: "a1000000-0000-4000-8000-000000000001", routes: [] };

/** What the stats service answers with. Its arithmetic is `stats.spec.ts`'s business. */
const SPEND = { providers: [], localTokenShare: null } as unknown as RoutingSpendResource;

/** A route as a body sends it, without the task kind — the single-route `PUT`'s body. */
const POLICY: RoutePolicyDto = {
  hops: [{ alias: "coder-max", note: "Primary" }],
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCentsPerRun: 250,
};

describe("the routing controller", () => {
  let service: jest.Mocked<RoutingManagementService>;
  let stats: jest.Mocked<RoutingStatsService>;
  let controller: RoutingController;

  beforeEach(() => {
    service = {
      matrix: jest.fn().mockResolvedValue({ taskKinds: [], rules: [] }),
      aliases: jest.fn().mockResolvedValue({ aliases: [] }),
      save: jest.fn().mockResolvedValue(SAVED),
      addRule: jest.fn().mockResolvedValue({ id: "rule" }),
      changeRule: jest.fn().mockResolvedValue({ id: "rule" }),
      removeRule: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RoutingManagementService>;

    stats = {
      spend: jest.fn().mockResolvedValue(SPEND),
    } as unknown as jest.Mocked<RoutingStatsService>;

    controller = new RoutingController(service, stats);
  });

  describe("the reads", () => {
    it("scopes the matrix to the workspace the guard established", async () => {
      await controller.matrix(WORKSPACE);

      expect(service.matrix).toHaveBeenCalledWith(WORKSPACE.id);
    });

    it("scopes the alias list the same way", async () => {
      await controller.aliases(WORKSPACE);

      expect(service.aliases).toHaveBeenCalledWith(WORKSPACE.id);
    });

    it("scopes the spend card to the workspace, and answers what the stats service measured", async () => {
      // The money in this payload is one workspace's, and the id it is aggregated under comes
      // from the guard rather than from anything a client sent.
      await expect(controller.spend(WORKSPACE)).resolves.toBe(SPEND);

      expect(stats.spend).toHaveBeenCalledWith(WORKSPACE.id);
    });
  });

  describe("saving routes", () => {
    it("passes the batch through under the session's workspace and person", async () => {
      const batch = { routes: [{ ...POLICY, taskKind: "implement" }] };

      await expect(controller.save(WORKSPACE, PRINCIPAL, batch)).resolves.toEqual(SAVED);

      expect(service.save).toHaveBeenCalledWith(WORKSPACE.id, PRINCIPAL.user.id, batch.routes);
    });

    it("makes the single-route PUT a batch of one, with the kind from the path", async () => {
      // One implementation rather than two, so the two cannot come to disagree about
      // validation, atomicity, or what gets recorded.
      await controller.saveOne(WORKSPACE, PRINCIPAL, { taskKind: "docs" }, POLICY);

      expect(service.save).toHaveBeenCalledWith(WORKSPACE.id, PRINCIPAL.user.id, [
        { ...POLICY, taskKind: "docs" },
      ]);
    });

    it("takes the actor from the session rather than from anything a client sent", async () => {
      await controller.save(WORKSPACE, PRINCIPAL, {
        routes: [{ ...POLICY, taskKind: "implement" }],
      });

      const [, actor] = service.save.mock.calls[0];

      expect(actor).toBe(PRINCIPAL.user.id);
    });
  });

  describe("the rules", () => {
    it("adds under the session's workspace", async () => {
      const rule = { when: { effort_gte: "l" }, then: { route_local: {} } };

      await controller.addRule(WORKSPACE, rule);

      expect(service.addRule).toHaveBeenCalledWith(WORKSPACE.id, rule);
    });

    it("changes one by id", async () => {
      await controller.changeRule(
        WORKSPACE,
        { id: "f0000000-0000-4000-8000-000000000001" },
        {
          enabled: false,
        },
      );

      expect(service.changeRule).toHaveBeenCalledWith(
        WORKSPACE.id,
        "f0000000-0000-4000-8000-000000000001",
        { enabled: false },
      );
    });

    it("removes one by id", async () => {
      await controller.removeRule(WORKSPACE, { id: "f0000000-0000-4000-8000-000000000001" });

      expect(service.removeRule).toHaveBeenCalledWith(
        WORKSPACE.id,
        "f0000000-0000-4000-8000-000000000001",
      );
    });
  });

  describe("who may do what", () => {
    const reflector = new Reflector();

    it.each([
      ["save", (c: RoutingController) => c.save],
      ["saveOne", (c: RoutingController) => c.saveOne],
      ["addRule", (c: RoutingController) => c.addRule],
      ["changeRule", (c: RoutingController) => c.changeRule],
      ["removeRule", (c: RoutingController) => c.removeRule],
    ])("asks administrators of %s", (_name, handler) => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler(controller))).toEqual([
        ...ADMINISTRATORS,
      ]);
    });

    it.each([
      ["matrix", (c: RoutingController) => c.matrix],
      ["aliases", (c: RoutingController) => c.aliases],
      ["spend", (c: RoutingController) => c.spend],
    ])("asks no role of %s, so a viewer may look", (_name, handler) => {
      // Under the roles guard's own rule a bare route is every member's — a viewer is a role
      // that exists to be able to look at which model answers which kind of work.
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler(controller))).toBeUndefined();
    });

    it("gates every handler that writes, counted rather than listed", () => {
      // The list above is a list somebody has to remember to extend. This is the check that
      // fails when they do not: every method whose name is not a read must carry the metadata.
      const reads = new Set(["matrix", "aliases", "spend"]);
      const handlers = Object.getOwnPropertyNames(RoutingController.prototype).filter(
        (name) => name !== "constructor",
      );

      for (const name of handlers.filter((handler) => !reads.has(handler))) {
        const handler = (controller as unknown as Record<string, () => unknown>)[name];

        expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...ADMINISTRATORS]);
      }
    });
  });
});
