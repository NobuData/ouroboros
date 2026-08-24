import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { AliasesController } from "./aliases.controller";
import type { AliasChangeResource, ModelAliasResource } from "./aliases.resources";
import type { AliasesService } from "./aliases.service";

const WORKSPACE_ID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const WORKSPACE = { id: WORKSPACE_ID } as Organization;
const PRINCIPAL = principalFor(FIXTURE_USER, WORKSPACE_ID);
const ALIAS_ID = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const CONNECTION_ID = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";
const PARAMS = { id: ALIAS_ID };

const ALIAS: ModelAliasResource = {
  id: ALIAS_ID,
  alias: "coder-max",
  enabled: true,
  connection: { id: CONNECTION_ID, kind: "anthropic", displayName: "Anthropic Claude" },
  modelId: "claude-fable-5",
  params: {},
  restrictions: {},
  notes: null,
  references: [],
  updatedBy: FIXTURE_USER.id,
  createdAt: "2026-06-12T16:20:00.000Z",
  updatedAt: "2026-08-23T09:59:41.882Z",
};

const CHANGE: AliasChangeResource = {
  alias: ALIAS,
  revisionId: "a1000000-0000-0000-0000-000000000001",
  warnings: [],
  nextResolution: null,
  droppedHops: [],
};

describe("the aliases controller", () => {
  let service: jest.Mocked<AliasesService>;
  let controller: AliasesController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ aliases: [ALIAS] }),
      modelOptions: jest.fn().mockResolvedValue({ connection: ALIAS.connection, models: [] }),
      create: jest.fn().mockResolvedValue(CHANGE),
      update: jest.fn().mockResolvedValue(CHANGE),
      duplicate: jest.fn().mockResolvedValue(CHANGE),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AliasesService>;
    controller = new AliasesController(service);
  });

  describe("the workspace is the session's", () => {
    it("scopes the list to what the guard established", async () => {
      await expect(controller.list(WORKSPACE)).resolves.toEqual({ aliases: [ALIAS] });
      expect(service.list).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it("scopes the model options", async () => {
      await controller.modelOptions(WORKSPACE, { connection: CONNECTION_ID });
      expect(service.modelOptions).toHaveBeenCalledWith(WORKSPACE_ID, CONNECTION_ID);
    });

    it("scopes every write, and attributes it to the session", async () => {
      const body = { alias: "coder-max", modelId: "claude-fable-5" };

      await expect(controller.create(WORKSPACE, PRINCIPAL, body)).resolves.toEqual(CHANGE);
      expect(service.create).toHaveBeenCalledWith(WORKSPACE_ID, FIXTURE_USER.id, body);

      await controller.update(WORKSPACE, PRINCIPAL, PARAMS, { enabled: false });
      expect(service.update).toHaveBeenCalledWith(WORKSPACE_ID, FIXTURE_USER.id, ALIAS_ID, {
        enabled: false,
      });

      await controller.duplicate(WORKSPACE, PRINCIPAL, PARAMS);
      expect(service.duplicate).toHaveBeenCalledWith(WORKSPACE_ID, FIXTURE_USER.id, ALIAS_ID);

      await expect(controller.remove(WORKSPACE, PRINCIPAL, PARAMS)).resolves.toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith(WORKSPACE_ID, FIXTURE_USER.id, ALIAS_ID);
    });
  });

  describe("members read; administrators write", () => {
    const reflector = new Reflector();

    it.each(["list", "modelOptions"] as const)("leaves %s to any member", (handler) => {
      expect(
        reflector.get<string[] | undefined>(REQUIRED_ROLES, controller[handler]),
      ).toBeUndefined();
    });

    it.each(["create", "update", "duplicate", "remove"] as const)(
      "gates %s to owners and admins",
      (handler) => {
        expect(reflector.get<string[]>(REQUIRED_ROLES, controller[handler])).toEqual(
          ADMINISTRATORS,
        );
      },
    );
  });

  describe("status codes", () => {
    it("answers a delete with 204 and nothing else", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove)).toBe(
        HttpStatus.NO_CONTENT,
      );
    });

    it("leaves the two creates at Nest's 201 for a POST", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.create)).toBeUndefined();
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.duplicate)).toBeUndefined();
    });
  });
});
