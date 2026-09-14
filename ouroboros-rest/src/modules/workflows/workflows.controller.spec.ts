import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import type { WorkflowCatalogService } from "./catalog.service";
import type { WorkflowCodeService } from "./code.service";
import { WorkflowsController, type HeaderTarget } from "./workflows.controller";
import type { WorkflowsService } from "./workflows.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in
 * `workflows.service.spec.ts` and `code.service.spec.ts`, the statements in
 * `workflows.repository.spec.ts`, and the whole pipeline in the integration suites.
 *
 * The decorations are the half no unit test of the service can see, and they are the ticket's
 * role policy: **every write names `ADMINISTRATORS` and no read names anything** — the one write
 * without it being `PUT …/code-config`, which refuses everybody alike. A `@Roles()` deleted from
 * a handler leaves every other spec in this module green, which is exactly why it is asserted
 * here and again, against a real session, in the integration suites.
 */

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** A session, reduced to the one field the publish handler reads. */
const PRINCIPAL = { user: { id: "user-1" } } as never;

describe("the workflows controller", () => {
  let service: jest.Mocked<WorkflowsService>;
  let catalog: jest.Mocked<Pick<WorkflowCatalogService, "catalog" | "codeSymbols">>;
  let code: jest.Mocked<Pick<WorkflowCodeService, "read" | "checks" | "save" | "tree" | "config">>;
  let controller: WorkflowsController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ workflows: [] }),
      create: jest.fn().mockResolvedValue({ id: WORKFLOW }),
      read: jest.fn().mockResolvedValue({ id: WORKFLOW }),
      update: jest.fn().mockResolvedValue({ id: WORKFLOW }),
      saveDraft: jest.fn().mockResolvedValue({ etag: "token" }),
      publish: jest.fn().mockResolvedValue({ version: 15 }),
      versions: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
    } as unknown as jest.Mocked<WorkflowsService>;

    catalog = {
      catalog: jest.fn().mockResolvedValue({ nodeTypes: [] }),
      codeSymbols: jest.fn().mockResolvedValue({ scopes: [], symbols: [] }),
    };

    code = {
      read: jest.fn().mockResolvedValue({ slug: "standard-fix" }),
      checks: jest.fn().mockResolvedValue({ rows: [] }),
      save: jest.fn().mockResolvedValue({ etag: "token" }),
      tree: jest.fn().mockResolvedValue({ files: [] }),
      config: jest.fn().mockResolvedValue({ readOnly: true }),
    };

    controller = new WorkflowsController(
      service,
      catalog as unknown as WorkflowCatalogService,
      code as unknown as WorkflowCodeService,
    );
    reflector = new Reflector();
  });

  describe("delegation", () => {
    it("hands the rail the workspace", async () => {
      await controller.list(TENANT);

      expect(service.list).toHaveBeenCalledWith("acme-robotics-id");
    });

    it("hands the create the workspace and the body", async () => {
      await controller.create(TENANT, { name: "Standard Fix" });

      expect(service.create).toHaveBeenCalledWith("acme-robotics-id", { name: "Standard Fix" });
    });

    it("hands the stage catalog the workspace", async () => {
      await controller.catalog(TENANT);

      expect(catalog.catalog).toHaveBeenCalledWith("acme-robotics-id");
    });

    it("hands the code symbol table the workspace", async () => {
      await controller.codeSymbols(TENANT);

      expect(catalog.codeSymbols).toHaveBeenCalledWith("acme-robotics-id");
    });

    it("hands the detail the version the query named", async () => {
      await controller.read(TENANT, { id: WORKFLOW }, { version: 3 });

      expect(service.read).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, 3);
    });

    it("hands the detail an undefined version when the query named none", async () => {
      await controller.read(TENANT, { id: WORKFLOW }, {});

      expect(service.read).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, undefined);
    });

    it("hands the patch the body untouched", async () => {
      await controller.update(TENANT, { id: WORKFLOW }, { status: "paused" });

      expect(service.update).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, {
        status: "paused",
      });
    });

    it("hands the draft save the If-Match header verbatim", async () => {
      // Verbatim, because what an `If-Match` may say — quoted, weak, a list, `*` — is
      // `draft.etag.ts`' question and not a controller's.
      await controller.saveDraft(TENANT, { id: WORKFLOW }, 'W/"token"', { definition: {} });

      expect(service.saveDraft).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, 'W/"token"', {
        definition: {},
      });
    });

    it("hands the draft save an undefined header when there was none", async () => {
      // The service turns that into `workflow_draft_etag_required`; a controller that
      // defaulted it to `*` would have opted every client out of the guard.
      await controller.saveDraft(TENANT, { id: WORKFLOW }, undefined, { definition: {} });

      expect(service.saveDraft).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, undefined, {
        definition: {},
      });
    });

    it("hands the publish the session's person, for published_by", async () => {
      await controller.publish(TENANT, { id: WORKFLOW }, PRINCIPAL, { changeNote: "Note." });

      expect(service.publish).toHaveBeenCalledWith(
        "acme-robotics-id",
        WORKFLOW,
        { changeNote: "Note." },
        "user-1",
      );
    });

    it("hands the history the window", async () => {
      await controller.versions(TENANT, { id: WORKFLOW }, { limit: 10, offset: 20 });

      expect(service.versions).toHaveBeenCalledWith("acme-robotics-id", WORKFLOW, {
        limit: 10,
        offset: 20,
      });
    });

    it("hands the code view's explorer the workspace", async () => {
      await controller.codeTree(TENANT);

      expect(code.tree).toHaveBeenCalledWith("acme-robotics-id");
    });

    it("hands the configuration the whole workspace, whose slug the file names", async () => {
      await controller.codeConfig(TENANT);

      expect(code.config).toHaveBeenCalledWith(TENANT);
    });

    it("hands a file read the slug and the version the query named", async () => {
      await controller.readCode(TENANT, { slug: "standard-fix" }, { version: 2 });

      expect(code.read).toHaveBeenCalledWith("acme-robotics-id", "standard-fix", 2);
    });

    it("hands a file's Loop Checks the slug and the version the query named", async () => {
      await controller.readCodeChecks(TENANT, { slug: "standard-fix" }, { version: 2 });

      expect(code.checks).toHaveBeenCalledWith("acme-robotics-id", "standard-fix", 2);
    });

    it("hands a file save the If-Match header verbatim, and the text", async () => {
      await controller.saveCode(TENANT, { slug: "standard-fix" }, 'W/"token"', { text: "…" });

      expect(code.save).toHaveBeenCalledWith("acme-robotics-id", "standard-fix", 'W/"token"', "…");
    });

    it("refuses a write to ouroboros.config.ts with 405, having set Allow first", () => {
      const setHeader = jest.fn();
      const response: HeaderTarget = { setHeader };
      let refused: unknown;

      try {
        controller.saveCodeConfig(response);
      } catch (error) {
        refused = error;
      }

      expect(setHeader).toHaveBeenCalledWith("Allow", "GET");
      expect(refused).toMatchObject({ code: "workflow_code_read_only" });
      expect((refused as { getStatus(): number }).getStatus()).toBe(405);
    });
  });

  describe("the tenant context", () => {
    it("requires a workspace, by saying nothing", () => {
      // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before any
      // handler runs, which is what "under tenant context" means.
      expect(reflector.get<boolean>(TENANT_OPTIONAL, WorkflowsController)).toBeUndefined();

      for (const handler of [
        controller.list,
        controller.create,
        controller.catalog,
        controller.codeSymbols,
        controller.codeTree,
        controller.codeConfig,
        controller.saveCodeConfig,
        controller.readCode,
        controller.readCodeChecks,
        controller.saveCode,
        controller.read,
        controller.update,
        controller.saveDraft,
        controller.publish,
        controller.versions,
      ]) {
        expect(reflector.get<boolean>(TENANT_OPTIONAL, handler)).toBeUndefined();
      }
    });
  });

  describe("the role policy", () => {
    it.each([
      ["the rail", () => controller.list],
      ["the stage catalog", () => controller.catalog],
      ["the code symbol table", () => controller.codeSymbols],
      ["the code view's explorer", () => controller.codeTree],
      ["ouroboros.config.ts", () => controller.codeConfig],
      ["a workflow's file", () => controller.readCode],
      ["a workflow's Loop Checks", () => controller.readCodeChecks],
      ["the detail", () => controller.read],
      ["the history", () => controller.versions],
    ])("leaves %s open to every member, viewers included", (_name, handler) => {
      // A viewer is a role that exists to be able to look at a workflow.
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toBeUndefined();
    });

    it.each([
      ["creating", () => controller.create],
      ["renaming and pausing", () => controller.update],
      ["saving a draft", () => controller.saveDraft],
      ["saving a file from the code view", () => controller.saveCode],
      ["publishing", () => controller.publish],
    ])("requires an administrator for %s", (_name, handler) => {
      // `CONTRIBUTORS` would be the wrong list: a `member` is somebody who works here, and
      // publishing changes what every future run of this workspace does.
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toEqual([...ADMINISTRATORS]);
    });

    it("names no role for a write to ouroboros.config.ts, which every role is refused alike", () => {
      // The 405 is the file's. A member told 403 and an owner told 405 would be two answers to
      // one question.
      expect(reflector.get<string[]>(REQUIRED_ROLES, controller.saveCodeConfig)).toBeUndefined();
    });
  });

  describe("the route table", () => {
    it("serves the stage catalog at `catalog`", () => {
      expect(Reflect.getMetadata(PATH_METADATA, WorkflowsController.prototype.catalog)).toBe(
        "catalog",
      );
    });

    it("declares the catalog before the detail, so `catalog` is never read as an id", () => {
      // Nest registers handlers in declaration order and Express matches in registration order:
      // moved below `read`, `GET …/catalog` would be the detail's `422` for a non-uuid id.
      const handlers = Object.getOwnPropertyNames(WorkflowsController.prototype);

      expect(handlers.indexOf("catalog")).toBeGreaterThan(-1);
      expect(handlers.indexOf("catalog")).toBeLessThan(handlers.indexOf("read"));
    });

    it("serves the code symbol table at `code-symbols`, before the detail", () => {
      const handlers = Object.getOwnPropertyNames(WorkflowsController.prototype);

      expect(Reflect.getMetadata(PATH_METADATA, WorkflowsController.prototype.codeSymbols)).toBe(
        "code-symbols",
      );
      expect(handlers.indexOf("codeSymbols")).toBeGreaterThan(-1);
      expect(handlers.indexOf("codeSymbols")).toBeLessThan(handlers.indexOf("read"));
    });

    it.each([
      ["codeTree", "code-tree"],
      ["codeConfig", "code-config"],
      ["saveCodeConfig", "code-config"],
    ] as const)("serves %s at `%s`, before the detail", (handler, path) => {
      const handlers = Object.getOwnPropertyNames(WorkflowsController.prototype);

      expect(Reflect.getMetadata(PATH_METADATA, WorkflowsController.prototype[handler])).toBe(path);
      expect(handlers.indexOf(handler)).toBeGreaterThan(-1);
      expect(handlers.indexOf(handler)).toBeLessThan(handlers.indexOf("read"));
    });

    it("serves a workflow's file at `:slug/code`, for reading and for saving", () => {
      for (const handler of [
        WorkflowsController.prototype.readCode,
        WorkflowsController.prototype.saveCode,
      ]) {
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":slug/code");
      }
    });

    it("serves a workflow's Loop Checks at `:slug/code/checks`", () => {
      expect(Reflect.getMetadata(PATH_METADATA, WorkflowsController.prototype.readCodeChecks)).toBe(
        ":slug/code/checks",
      );
    });
  });

  describe("what it does not offer", () => {
    it("has no delete, because archiving is the soft delete", () => {
      // V029: `archived` keeps the version history readable while taking the workflow off the
      // rail. A hard delete would have to mean destroying the provenance of every run that
      // named it.
      expect(controller).not.toHaveProperty("remove");
      expect(controller).not.toHaveProperty("delete");
    });
  });
});
