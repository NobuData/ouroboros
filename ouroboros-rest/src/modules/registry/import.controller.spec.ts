import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { AliasConnectionResource } from "./aliases.resources";
import { ImportController } from "./import.controller";
import type { ImportCandidateListResource, ImportResultResource } from "./import.resources";
import type { ImportService } from "./import.service";

const WORKSPACE_ID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const WORKSPACE = { id: WORKSPACE_ID } as Organization;
const PRINCIPAL = principalFor(FIXTURE_USER, WORKSPACE_ID);
const CONNECTION_ID = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";
const CONNECTION: AliasConnectionResource = {
  id: CONNECTION_ID,
  kind: "anthropic",
  displayName: "Anthropic Claude",
};

const CANDIDATES: ImportCandidateListResource = {
  connection: CONNECTION,
  candidates: [],
  empty: null,
};

const RESULT: ImportResultResource = { connection: CONNECTION, created: [], skipped: [] };

describe("the import controller", () => {
  let service: jest.Mocked<ImportService>;
  let controller: ImportController;

  beforeEach(() => {
    service = {
      candidates: jest.fn().mockResolvedValue(CANDIDATES),
      create: jest.fn().mockResolvedValue(RESULT),
    } as unknown as jest.Mocked<ImportService>;
    controller = new ImportController(service);
  });

  describe("the workspace is the session's", () => {
    it("scopes the candidates read to what the guard established", async () => {
      await expect(
        controller.candidates(WORKSPACE, { connectionId: CONNECTION_ID }),
      ).resolves.toEqual(CANDIDATES);
      expect(service.candidates).toHaveBeenCalledWith(WORKSPACE_ID, CONNECTION_ID);
    });

    it("scopes the batch, and attributes it to the session rather than to the body", async () => {
      // *Who imported this* is a fact about the request; a body field would let a client
      // attribute its own writes to somebody else.
      const body = { connectionId: CONNECTION_ID, items: [] };

      await expect(controller.create(WORKSPACE, PRINCIPAL, body)).resolves.toEqual(RESULT);
      expect(service.create).toHaveBeenCalledWith(WORKSPACE_ID, FIXTURE_USER.id, body);
    });
  });

  describe("administrators only, both halves", () => {
    const reflector = new Reflector();

    it("gates the controller rather than the handlers", () => {
      // Applied to the class, so a handler added here is gated on the day it is written
      // rather than on the day somebody notices the missing decorator.
      expect(reflector.get<string[]>(REQUIRED_ROLES, ImportController)).toEqual(ADMINISTRATORS);
    });

    it.each(["candidates", "create"] as const)("leaves no override on %s", (handler) => {
      // Including the read: the candidates list is the first half of a write, not a view of
      // the registry, and there is nothing in it a member could act on.
      expect(
        reflector.get<string[] | undefined>(REQUIRED_ROLES, controller[handler]),
      ).toBeUndefined();
    });
  });

  describe("status codes", () => {
    it("answers the batch with 200, because it creates a list rather than a resource", () => {
      // A `201` means *a resource was created and here it is*. This creates N, and on a re-run
      // creates none while still succeeding — so the answer is the report, at `200`.
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.create)).toBe(HttpStatus.OK);
    });
  });
});
