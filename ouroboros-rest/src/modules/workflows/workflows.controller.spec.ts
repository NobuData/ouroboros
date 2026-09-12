import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { WorkflowsController } from "./workflows.controller";
import type { WorkflowsService } from "./workflows.service";

/**
 * The thinnest layer, held to its decorations and its delegation — the rules live in
 * `workflows.service.spec.ts`, the statements in `workflows.repository.spec.ts`, and the whole
 * pipeline in the integration suite.
 *
 * The decorations are the half no unit test of the service can see, and they are the ticket's
 * role policy: **every write names `ADMINISTRATORS` and no read names anything**. A `@Roles()`
 * deleted from a handler leaves every other spec in this module green, which is exactly why it
 * is asserted here and again, against a real session, in the integration suite.
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

    controller = new WorkflowsController(service);
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
  });

  describe("the tenant context", () => {
    it("requires a workspace, by saying nothing", () => {
      // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before any
      // handler runs, which is what "under tenant context" means.
      expect(reflector.get<boolean>(TENANT_OPTIONAL, WorkflowsController)).toBeUndefined();

      for (const handler of [
        controller.list,
        controller.create,
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
      ["publishing", () => controller.publish],
    ])("requires an administrator for %s", (_name, handler) => {
      // `CONTRIBUTORS` would be the wrong list: a `member` is somebody who works here, and
      // publishing changes what every future run of this workspace does.
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler())).toEqual([...ADMINISTRATORS]);
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
