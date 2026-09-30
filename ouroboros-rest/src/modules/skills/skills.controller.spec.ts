import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { SkillsController } from "./skills.controller";
import type { SkillsService } from "./skills.service";

/**
 * The skills controller (#410), held to its decorations and its delegation — the rules live in
 * `skills.service.spec.ts`.
 *
 * The decorations are the ticket's role policy: **member reads, admin and above write**. The
 * owner-only `required` flag is narrower than a route can say, so the controller's part is to
 * hand the service the caller's roles, and this suite checks it does.
 */

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

const SLUG = { slug: "hil-safety" };

describe("the skills controller", () => {
  let service: jest.Mocked<SkillsService>;
  let controller: SkillsController;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ skills: [], active: 0 }),
      create: jest.fn().mockResolvedValue({}),
      stats: jest.fn().mockResolvedValue({}),
      read: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue(undefined),
      saveDraft: jest.fn().mockResolvedValue({}),
      publish: jest.fn().mockResolvedValue({}),
      versions: jest.fn().mockResolvedValue({}),
      previewScope: jest.fn().mockResolvedValue({}),
      moveScope: jest.fn().mockResolvedValue({}),
      readCode: jest.fn().mockResolvedValue({}),
      saveCode: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<SkillsService>;
    controller = new SkillsController(service);
  });

  describe("delegation", () => {
    it("hands the list the workspace", async () => {
      await controller.list(TENANT);

      expect(service.list).toHaveBeenCalledWith("acme-robotics-id");
    });

    it("hands the create the workspace and the body", async () => {
      await controller.create(TENANT, { text: "---\n---\n" });

      expect(service.create).toHaveBeenCalledWith("acme-robotics-id", { text: "---\n---\n" });
    });

    it("hands the stats the window the query named, or none", async () => {
      await controller.stats(TENANT, { days: 7 });
      await controller.stats(TENANT, {});

      expect(service.stats).toHaveBeenNthCalledWith(1, "acme-robotics-id", 7);
      expect(service.stats).toHaveBeenNthCalledWith(2, "acme-robotics-id", undefined);
    });

    it("hands the detail the slug and the version", async () => {
      await controller.read(TENANT, SLUG, { version: 3 });

      expect(service.read).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", 3);
    });

    it("hands the patch the caller's roles, so `required` can be held to an owner", async () => {
      const member = { tenant: TENANT, roles: ["admin"] } as const;

      await controller.update(TENANT, member, SLUG, { enabled: false });

      expect(service.update).toHaveBeenCalledWith(
        "acme-robotics-id",
        "hil-safety",
        { enabled: false },
        ["admin"],
      );
    });

    it("hands the draft save the If-Match header verbatim, and the text", async () => {
      await controller.saveDraft(TENANT, SLUG, 'W/"token"', { text: "…" });
      await controller.saveDraft(TENANT, SLUG, undefined, { text: "…" });

      expect(service.saveDraft).toHaveBeenNthCalledWith(
        1,
        "acme-robotics-id",
        "hil-safety",
        'W/"token"',
        "…",
      );
      expect(service.saveDraft).toHaveBeenNthCalledWith(
        2,
        "acme-robotics-id",
        "hil-safety",
        undefined,
        "…",
      );
    });

    it("hands the publish the session's person", async () => {
      await controller.publish(TENANT, SLUG, { user: { id: "user-1" } } as never, {
        changeNote: "Note.",
      });

      expect(service.publish).toHaveBeenCalledWith(
        "acme-robotics-id",
        "hil-safety",
        { changeNote: "Note." },
        "user-1",
      );
    });

    it("hands the history the window", async () => {
      await controller.versions(TENANT, SLUG, { limit: 5, offset: 0 });

      expect(service.versions).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", {
        limit: 5,
        offset: 0,
      });
    });

    it("hands the scope preview and the move their bodies", async () => {
      await controller.previewScope(TENANT, SLUG, { scope: "org" });
      await controller.moveScope(TENANT, SLUG, { scope: "org", previewToken: "t".repeat(64) });

      expect(service.previewScope).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", {
        scope: "org",
      });
      expect(service.moveScope).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", {
        scope: "org",
        previewToken: "t".repeat(64),
      });
    });

    it("hands the delete the slug", async () => {
      await controller.delete(TENANT, SLUG);

      expect(service.delete).toHaveBeenCalledWith("acme-robotics-id", "hil-safety");
    });

    it("hands the code view's read and save the slug, the version and the header", async () => {
      await controller.readCode(TENANT, SLUG, { version: 2 });
      await controller.saveCode(TENANT, SLUG, "token", { text: "…" });

      expect(service.readCode).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", 2);
      expect(service.saveCode).toHaveBeenCalledWith("acme-robotics-id", "hil-safety", "token", "…");
    });
  });

  describe("the tenant context", () => {
    it("requires a workspace everywhere", () => {
      expect(reflector.get<boolean>(TENANT_OPTIONAL, SkillsController)).toBeUndefined();

      for (const name of Object.getOwnPropertyNames(SkillsController.prototype)) {
        if (name === "constructor") continue;

        const handler = (SkillsController.prototype as unknown as Record<string, () => unknown>)[
          name
        ];

        expect(reflector.get<boolean>(TENANT_OPTIONAL, handler)).toBeUndefined();
      }
    });
  });

  describe("the role policy", () => {
    it.each([
      ["the list", () => controller.list],
      ["the stats", () => controller.stats],
      ["the detail", () => controller.read],
      ["the history", () => controller.versions],
      ["a skill's file", () => controller.readCode],
      // A preview writes nothing.
      ["a scope preview", () => controller.previewScope],
    ])("leaves %s open to every member", (_name, handler) => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toBeUndefined();
    });

    it.each([
      ["creating", () => controller.create],
      ["the switch, the lock and the draft flag", () => controller.update],
      ["deleting", () => controller.delete],
      ["saving a draft", () => controller.saveDraft],
      ["publishing", () => controller.publish],
      ["moving scope", () => controller.moveScope],
      ["saving from the code view", () => controller.saveCode],
    ])("requires an administrator for %s", (_name, handler) => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toEqual([...ADMINISTRATORS]);
    });
  });

  describe("the route table", () => {
    it("declares `stats` before `:slug`, so it is never read as a skill", () => {
      const handlers = Object.getOwnPropertyNames(SkillsController.prototype);

      expect(Reflect.getMetadata(PATH_METADATA, SkillsController.prototype.stats)).toBe("stats");
      expect(handlers.indexOf("stats")).toBeLessThan(handlers.indexOf("read"));
    });

    it.each([
      ["read", ":slug"],
      ["update", ":slug"],
      ["delete", ":slug"],
      ["saveDraft", ":slug/draft"],
      ["publish", ":slug/publish"],
      ["versions", ":slug/versions"],
      ["previewScope", ":slug/scope/preview"],
      ["moveScope", ":slug/scope"],
      ["readCode", ":slug/code"],
      ["saveCode", ":slug/code"],
    ] as const)("serves %s at `%s`", (handler, path) => {
      expect(Reflect.getMetadata(PATH_METADATA, SkillsController.prototype[handler])).toBe(path);
    });
  });
});
