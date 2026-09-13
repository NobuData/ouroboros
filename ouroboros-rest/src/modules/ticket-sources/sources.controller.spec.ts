import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { SourcesController } from "./sources.controller";
import type { SourcesService } from "./sources.service";

/**
 * The source-management controller ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * every handler scopes to the workspace the guard established, the reads are every member's,
 * every write is an administrator's, and the catalog is declared before the `:id` read.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;
const SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

describe("the sources controller", () => {
  let service: jest.Mocked<SourcesService>;
  let controller: SourcesController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      catalog: jest.fn().mockReturnValue({ kinds: [] }),
      read: jest.fn().mockResolvedValue({ id: SOURCE_ID }),
      add: jest.fn().mockResolvedValue({ id: SOURCE_ID }),
      update: jest.fn().mockResolvedValue({ id: SOURCE_ID }),
      setCredentials: jest.fn().mockResolvedValue({ id: SOURCE_ID }),
      test: jest.fn().mockResolvedValue({ sourceId: SOURCE_ID }),
      syncNow: jest.fn().mockResolvedValue({ sourceId: SOURCE_ID, running: true }),
      status: jest.fn().mockResolvedValue({ sourceId: SOURCE_ID, running: false }),
    } as unknown as jest.Mocked<SourcesService>;

    controller = new SourcesController(service);
  });

  describe("scoping", () => {
    it("scopes every workspace read to what the guard established", async () => {
      await controller.list(WORKSPACE, { limit: 10 });
      await controller.read(WORKSPACE, { id: SOURCE_ID });
      await controller.status(WORKSPACE, { id: SOURCE_ID });

      expect(service.list).toHaveBeenCalledWith(WORKSPACE.id, { limit: 10 });
      expect(service.read).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID);
      expect(service.status).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID);
    });

    it("answers the catalog from the service, which scopes it to nothing", () => {
      expect(controller.catalog()).toStrictEqual({ kinds: [] });
    });

    it("scopes every write", async () => {
      const body = { kind: "github" as const, displayName: "x", config: {} };

      await controller.add(WORKSPACE, body);
      await controller.update(WORKSPACE, { id: SOURCE_ID }, { status: "paused" });
      await controller.setCredentials(WORKSPACE, { id: SOURCE_ID }, { secret: "s" });
      await controller.test(WORKSPACE, { id: SOURCE_ID });
      await controller.sync(WORKSPACE, { id: SOURCE_ID });

      expect(service.add).toHaveBeenCalledWith(WORKSPACE.id, body);
      expect(service.update).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID, { status: "paused" });
      expect(service.setCredentials).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID, { secret: "s" });
      expect(service.test).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID);
      expect(service.syncNow).toHaveBeenCalledWith(WORKSPACE.id, SOURCE_ID);
    });
  });

  describe("roles", () => {
    it("asks administrators of every write — test and sync included", () => {
      const reflector = new Reflector();

      for (const handler of [
        controller.add,
        controller.update,
        controller.setCredentials,
        controller.test,
        controller.sync,
      ]) {
        expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...ADMINISTRATORS]);
      }
    });

    it("asks nothing of the four reads, so a viewer may look", () => {
      const reflector = new Reflector();

      for (const handler of [
        controller.list,
        controller.catalog,
        controller.read,
        controller.status,
      ]) {
        expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toBeUndefined();
      }
    });
  });

  describe("status codes", () => {
    it("answers a credential write and a test 200, because nothing is created", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.setCredentials)).toBe(
        HttpStatus.OK,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.test)).toBe(HttpStatus.OK);
    });

    it("answers a sync 202, because the sync outlives the response", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.sync)).toBe(HttpStatus.ACCEPTED);
    });

    it("leaves an add at Nest's default 201", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.add)).toBeUndefined();
    });
  });

  describe("the route table", () => {
    it("declares the nine operations the issue lists, and no tenth", () => {
      const handlers = Object.getOwnPropertyNames(SourcesController.prototype).filter(
        (name) => name !== "constructor",
      );

      expect(handlers.sort()).toEqual([
        "add",
        "catalog",
        "list",
        "read",
        "setCredentials",
        "status",
        "sync",
        "test",
        "update",
      ]);
    });

    it("declares the catalog before the `:id` read, so `catalog` is never read as a source id", () => {
      // Express matches in registration order and `SourceParams` refuses a non-uuid, so a
      // `catalog` declared after `read` would answer `422 validation_failed` to every caller.
      // Nest registers a controller's handlers in declaration order, which is the property
      // held here.
      const handlers = Object.getOwnPropertyNames(SourcesController.prototype);

      expect(handlers.indexOf("catalog")).toBeLessThan(handlers.indexOf("read"));
      expect(Reflect.getMetadata(PATH_METADATA, controller.catalog)).toBe("catalog");
      expect(Reflect.getMetadata(PATH_METADATA, controller.read)).toBe(":id");
    });
  });
});
