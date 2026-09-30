import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { FactsController } from "./facts.controller";
import type { FactsService } from "./facts.service";
import type { FactSweepService } from "./facts.sweep";

/**
 * The facts controller (#411), held to its decorations and its delegation — the rules live in
 * `facts.service.spec.ts`. The decorations are the ticket's role policy: **members read, members
 * and above decide**, the session's person is every transition's actor, and the on-demand sweep is
 * an administrator's.
 */

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

const PRINCIPAL = { user: { id: "user-ken" } } as unknown as Principal;

const FACT = { factId: "5eed0044-0000-4000-8000-000000000003" };

describe("the facts controller", () => {
  let service: jest.Mocked<FactsService>;
  let sweep: jest.Mocked<FactSweepService>;
  let controller: FactsController;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({}),
      needsYou: jest.fn().mockResolvedValue({}),
      proposeManual: jest.fn().mockResolvedValue({}),
      confirm: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      reconfirm: jest.fn().mockResolvedValue({}),
      expire: jest.fn().mockResolvedValue({}),
      relearn: jest.fn().mockResolvedValue({}),
      addAnchor: jest.fn().mockResolvedValue({}),
      removeAnchor: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<FactsService>;
    sweep = {
      sweepWorkspace: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<FactSweepService>;
    controller = new FactsController(service, sweep);
  });

  describe("delegation", () => {
    it("hands every call the session's workspace, and every decision the session's person", async () => {
      await controller.list(TENANT, { status: "proposed" });
      await controller.needsYou(TENANT);
      await controller.read(TENANT, FACT);
      await controller.propose(TENANT, PRINCIPAL, { text: "x" });
      await controller.confirm(TENANT, FACT, PRINCIPAL, { reason: "checked" });
      await controller.reject(TENANT, FACT, PRINCIPAL, {});
      await controller.reconfirm(TENANT, FACT, PRINCIPAL, {});
      await controller.expire(TENANT, FACT, PRINCIPAL, { reason: "Zephyr 4.1 migration" });
      await controller.relearn(TENANT, FACT, PRINCIPAL, { text: "new" });
      await controller.addAnchor(TENANT, FACT, { kind: "dependency", value: "west" });
      await controller.removeAnchor(TENANT, { ...FACT, anchorId: FACT.factId });
      await controller.runSweep(TENANT);

      const id = TENANT.id;
      expect(service.list).toHaveBeenCalledWith(id, "proposed");
      expect(service.needsYou).toHaveBeenCalledWith(id);
      expect(service.get).toHaveBeenCalledWith(id, FACT.factId);
      expect(service.proposeManual).toHaveBeenCalledWith(id, { text: "x" }, "user-ken");
      expect(service.confirm).toHaveBeenCalledWith(id, FACT.factId, "user-ken", "checked");
      expect(service.reject).toHaveBeenCalledWith(id, FACT.factId, "user-ken", undefined);
      expect(service.reconfirm).toHaveBeenCalledWith(id, FACT.factId, "user-ken", undefined);
      expect(service.expire).toHaveBeenCalledWith(
        id,
        FACT.factId,
        "user-ken",
        "Zephyr 4.1 migration",
      );
      expect(service.relearn).toHaveBeenCalledWith(id, FACT.factId, "user-ken", "new");
      expect(service.addAnchor).toHaveBeenCalledWith(id, FACT.factId, {
        kind: "dependency",
        value: "west",
      });
      expect(service.removeAnchor).toHaveBeenCalledWith(id, FACT.factId, FACT.factId);
      expect(sweep.sweepWorkspace).toHaveBeenCalledWith(id);
    });
  });

  describe("the role policy", () => {
    it.each([
      ["the list", () => controller.list],
      ["the needs-you feed", () => controller.needsYou],
      ["the detail", () => controller.read],
    ])("leaves %s open to every member", (_name, handler) => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toBeUndefined();
    });

    it.each([
      ["proposing", () => controller.propose],
      ["Confirm", () => controller.confirm],
      ["Reject", () => controller.reject],
      ["Re-confirm", () => controller.reconfirm],
      ["Expire", () => controller.expire],
      ["Re-learn", () => controller.relearn],
      ["adding an anchor", () => controller.addAnchor],
      ["removing an anchor", () => controller.removeAnchor],
    ])("requires a member or above for %s", (_name, handler) => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toEqual([...CONTRIBUTORS]);
    });

    it("keeps viewers out of every decision", () => {
      expect(CONTRIBUTORS).not.toContain("viewer");
    });

    it("requires an administrator to run the sweep on demand", () => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, controller.runSweep)).toEqual([
        ...ADMINISTRATORS,
      ]);
    });
  });

  describe("the route table", () => {
    it("declares `needs-you` and `sweep` before `:factId`, so neither is read as a fact", () => {
      const handlers = Object.getOwnPropertyNames(FactsController.prototype);

      expect(Reflect.getMetadata(PATH_METADATA, FactsController.prototype.needsYou)).toBe(
        "needs-you",
      );
      expect(Reflect.getMetadata(PATH_METADATA, FactsController.prototype.runSweep)).toBe("sweep");
      expect(handlers.indexOf("needsYou")).toBeLessThan(handlers.indexOf("read"));
      expect(handlers.indexOf("runSweep")).toBeLessThan(handlers.indexOf("read"));
    });

    it.each([
      ["read", ":factId"],
      ["confirm", ":factId/confirm"],
      ["reject", ":factId/reject"],
      ["reconfirm", ":factId/reconfirm"],
      ["expire", ":factId/expire"],
      ["relearn", ":factId/relearn"],
      ["addAnchor", ":factId/anchors"],
      ["removeAnchor", ":factId/anchors/:anchorId"],
    ] as const)("routes %s at %s", (handler, path) => {
      expect(Reflect.getMetadata(PATH_METADATA, FactsController.prototype[handler])).toBe(path);
    });
  });
});
