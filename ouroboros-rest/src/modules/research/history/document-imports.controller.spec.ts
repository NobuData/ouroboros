import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { DocumentImportsController } from "./document-imports.controller";
import type { DocumentImportsService } from "./document-imports.service";

/**
 * The routes (CL.5, #618): every member reads, **only an owner imports or removes**, and the
 * workspace is the session's.
 */

const TENANT = { id: "org-acme" } as Organization;
const PRINCIPAL = { user: { id: "user-ken" } } as Principal;
const ID = "5eed009a-0000-4000-8000-000000000001";

const handler = (name: keyof DocumentImportsController): object =>
  Object.getOwnPropertyDescriptor(DocumentImportsController.prototype, name)!.value as object;

describe("the document imports controller", () => {
  it("serves /research/document-imports", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DocumentImportsController)).toBe(
      "research/document-imports",
    );
    expect(
      (["list", "create", "get", "remove"] as const).map((name): unknown[] => [
        Reflect.getMetadata(METHOD_METADATA, handler(name)) as unknown,
        Reflect.getMetadata(PATH_METADATA, handler(name)) as unknown,
      ]),
    ).toEqual([
      [RequestMethod.GET, "/"],
      [RequestMethod.POST, "/"],
      [RequestMethod.GET, ":importId"],
      [RequestMethod.DELETE, ":importId"],
    ]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler("remove"))).toBe(HttpStatus.NO_CONTENT);
  });

  it("gates importing and removing on owner — not admin — and leaves reads to every member", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler("create"))).toEqual(["owner"]);
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler("remove"))).toEqual(["owner"]);
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler("list"))).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler("get"))).toBeUndefined();
  });

  it("hands the session's workspace and user to the service", async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      create: jest.fn().mockResolvedValue({ id: ID }),
      get: jest.fn().mockResolvedValue({ id: ID }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new DocumentImportsController(service as unknown as DocumentImportsService);
    const body = {
      collection: "support",
      name: "churn-2026-q2",
      format: "csv" as const,
      content: "text\nA document.\n",
    };

    expect(await controller.list(TENANT)).toEqual({ items: [] });
    expect(await controller.create(TENANT, PRINCIPAL, body)).toEqual({ id: ID });
    expect(await controller.get(TENANT, { importId: ID })).toEqual({ id: ID });
    await controller.remove(TENANT, { importId: ID });

    expect(service.list).toHaveBeenCalledWith("org-acme");
    expect(service.create).toHaveBeenCalledWith("org-acme", "user-ken", body);
    expect(service.get).toHaveBeenCalledWith("org-acme", ID);
    expect(service.remove).toHaveBeenCalledWith("org-acme", ID);
  });
});
