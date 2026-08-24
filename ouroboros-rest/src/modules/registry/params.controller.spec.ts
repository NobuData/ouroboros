import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { NO_METADATA, mergeParamSchema } from "./params.merge";
import { ParamSchemaController } from "./params.controller";
import type { ParamSchemaService } from "./params.service";

/**
 * What a controller spec in this service is about — the route's declarations — and the two that
 * are this half of the ticket: **no `@Roles()`**, because a param schema describes a model
 * rather than a workspace's data, and the workspace coming from the guard rather than from
 * anything a caller wrote.
 *
 * The guard honouring the metadata is `roles.guard.spec.ts`; the whole pipeline answering a
 * real request is `registry.integration-spec.ts`.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;
const CONNECTION = "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01";

describe("the param schema controller", () => {
  let service: jest.Mocked<ParamSchemaService>;
  let controller: ParamSchemaController;

  beforeEach(() => {
    service = {
      schemaFor: jest.fn().mockResolvedValue(mergeParamSchema(null, NO_METADATA, NO_METADATA)),
      assertWriteValid: jest.fn(),
    } as unknown as jest.Mocked<ParamSchemaService>;

    controller = new ParamSchemaController(service);
  });

  it("asks about the model in the workspace the guard established", async () => {
    await controller.schema(WORKSPACE, { connection: CONNECTION, model: "claude-fable-5" });

    expect(service.schemaFor).toHaveBeenCalledWith(WORKSPACE.id, CONNECTION, "claude-fable-5");
  });

  it("treats an absent connection as a question about an unbound alias", async () => {
    // Not a mistake and not a default: an alias created ahead of its key has a model and no
    // provider, and *what can this be tuned with* is still a well-formed question about it.
    await controller.schema(WORKSPACE, { model: "gpt-5.2-preview" });

    expect(service.schemaFor).toHaveBeenCalledWith(WORKSPACE.id, null, "gpt-5.2-preview");
  });

  it("echoes what was asked, so a stale response is recognisable as one", async () => {
    const body = await controller.schema(WORKSPACE, {
      connection: CONNECTION,
      model: "claude-fable-5",
    });

    expect(body.modelId).toBe("claude-fable-5");
    expect(body.connectionId).toBe(CONNECTION);
  });

  it("reports a null connection for the unbound question", async () => {
    const body = await controller.schema(WORKSPACE, { model: "gpt-5.2-preview" });

    expect(body.connectionId).toBeNull();
  });

  it("serves both sections, with the fields each renders as", async () => {
    const body = await controller.schema(WORKSPACE, { model: "gpt-5.2-preview" });

    expect(body.params.fields).toEqual([]);
    expect(body.restrictions.fields.map((field) => field.name)).toEqual([
      "review_vote_only",
      "batch_ok",
    ]);
  });

  it("passes the reason through as a code rather than a sentence", async () => {
    const body = await controller.schema(WORKSPACE, { model: "gpt-5.2-preview" });

    expect(body.reason).toBe("alias_unbound");
  });

  it("requires no particular role, because it is a description of a model", () => {
    // A viewer is a role that exists to be able to look at the form somebody else will fill in.
    // What the schema *validates* is role-gated where that happens, on the alias writes.
    const roles = new Reflector().get<string[] | undefined>(
      REQUIRED_ROLES,
      ParamSchemaController.prototype.schema,
    );

    expect(roles).toBeUndefined();
  });

  it("takes the workspace from the guard and never from the query", () => {
    // No `{orgId}` in the path and no workspace in the query string — the tenant guard resolves
    // and membership-checks the active organization, and this handler reads what it
    // established.
    const source = ParamSchemaController.prototype.schema.toString();

    expect(source).not.toContain("orgId");
    expect(source).not.toContain("organizationId");
  });
});
