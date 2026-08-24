import type { Transaction } from "kysely";

import type { DatabaseService } from "../db/db.service";
import type { AliasRevisionDiff, Database } from "../db/schema";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import { ALIAS_ERRORS, PROVIDERS_FIX_PATH } from "./aliases.errors";
import type { AliasesRepository } from "./aliases.repository";
import { ALIAS_WARNINGS } from "./aliases.resources";
import type { AliasConnectionRow, AliasReferenceRow, AliasRow } from "./aliases.rows";
import { AliasesService } from "./aliases.service";
import type { ParamSchemaService } from "./params.service";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * The lifecycle's decisions, each against a repository that answers what the test says.
 *
 * What the statements do against a real database — the lock, the cascade, the unique key —
 * is `aliases.integration-spec.ts`'s. This is about *when* each guard fires, *what* each
 * write records, and that a refusal writes nothing.
 */
const ORG = "org-acme";
const ACTOR = "user-ken";
const ALIAS_ID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const NEW_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REVISION = "a1000000-0000-0000-0000-000000000001";
const ANTHROPIC = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const BEDROCK = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";

const TRX = { transaction: "sentinel" } as unknown as Transaction<Database>;

const ANTHROPIC_ROW: AliasConnectionRow = {
  id: ANTHROPIC,
  kind: "anthropic",
  display_name: "Anthropic Claude",
};

const BEDROCK_ROW: AliasConnectionRow = {
  id: BEDROCK,
  kind: "anthropic",
  display_name: "Anthropic — Bedrock",
};

const ROW: AliasRow = {
  id: ALIAS_ID,
  organization_id: ORG,
  alias: "coder-max",
  provider_connection_id: ANTHROPIC,
  model_id: "claude-fable-5",
  enabled: true,
  params: { thinking: "max" },
  restrictions: {},
  notes: null,
  updated_by: ACTOR,
  created_at: new Date("2026-06-12T16:20:00.000Z"),
  updated_at: new Date("2026-08-23T09:59:41.882Z"),
  connection_kind: "anthropic",
  connection_display_name: "Anthropic Claude",
};

const UNBOUND: AliasRow = {
  ...ROW,
  id: NEW_ID,
  alias: "gpt5-experiments",
  provider_connection_id: null,
  model_id: "gpt-5.2-preview",
  enabled: false,
  params: {},
  connection_kind: null,
  connection_display_name: null,
};

const REFERENCES: AliasReferenceRow[] = [
  {
    alias_id: ALIAS_ID,
    kind: "route",
    ref_id: "5eed0012-0000-4000-8000-000000000007",
    ref_label: "implement-primary",
    blocking: true,
  },
  {
    alias_id: ALIAS_ID,
    kind: "escalation",
    ref_id: "5eed0013-0000-4000-8000-000000000001",
    ref_label: "escalation:effort≥L",
    blocking: true,
  },
];

type Repository = jest.Mocked<Pick<AliasesRepository, keyof AliasesRepository>>;

describe("the aliases service", () => {
  let repository: Repository;
  let params: jest.Mocked<Pick<ParamSchemaService, "assertWriteValid">>;
  let database: { transaction: jest.Mock };
  let service: AliasesService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([ROW, UNBOUND]),
      find: jest.fn().mockResolvedValue(ROW),
      findByName: jest.fn().mockResolvedValue(undefined),
      references: jest.fn().mockResolvedValue([]),
      guardedReferences: jest.fn().mockResolvedValue([]),
      connection: jest
        .fn()
        .mockImplementation((_org: string, id: string) =>
          Promise.resolve(
            id === ANTHROPIC ? ANTHROPIC_ROW : id === BEDROCK ? BEDROCK_ROW : undefined,
          ),
        ),
      discovery: jest.fn().mockResolvedValue({ discovered: true, catalogued: true }),
      modelOptions: jest.fn().mockResolvedValue([]),
      namesStartingWith: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue(NEW_ID),
      update: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
      recordRevision: jest.fn().mockResolvedValue(REVISION),
    };
    params = { assertWriteValid: jest.fn().mockResolvedValue(undefined) };
    database = {
      transaction: jest.fn((work: (trx: Transaction<Database>) => Promise<unknown>) => work(TRX)),
    };
    service = new AliasesService(
      repository as unknown as AliasesRepository,
      params as unknown as ParamSchemaService,
      database as unknown as DatabaseService,
    );
  });

  /**
   * Run a call expected to refuse, and hand back what it refused with.
   *
   * @param call - The call.
   * @returns The error.
   */
  async function refused(call: () => Promise<unknown>): Promise<{ code: string; details: object }> {
    try {
      await call();
    } catch (error) {
      return error as { code: string; details: object };
    }
    throw new Error("expected the call to be refused, and it was not");
  }

  describe("list", () => {
    it("hands every alias its own references, in one read of the view", async () => {
      repository.references.mockResolvedValue(REFERENCES);

      const list = await service.list(ORG);

      expect(repository.references).toHaveBeenCalledWith(ORG, [ALIAS_ID, NEW_ID]);
      expect(list.aliases[0].references).toHaveLength(2);
      expect(list.aliases[1].references).toEqual([]);
    });
  });

  describe("create", () => {
    it("stores a bound alias switched on, validated against its binding, and records it", async () => {
      repository.find.mockResolvedValue({ ...ROW, id: NEW_ID });

      const change = await service.create(ORG, ACTOR, {
        alias: "coder-max",
        connectionId: ANTHROPIC,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
      });

      expect(params.assertWriteValid).toHaveBeenCalledWith(ORG, ANTHROPIC, "claude-fable-5", {
        params: { thinking: "max" },
        restrictions: {},
      });
      expect(repository.insert).toHaveBeenCalledWith(
        TRX,
        ORG,
        ACTOR,
        expect.objectContaining({ alias: "coder-max", enabled: true, connectionId: ANTHROPIC }),
      );
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          aliasId: NEW_ID,
          alias: "coder-max",
          actor: ACTOR,
          action: "created",
          diff: expect.objectContaining({
            alias: { from: null, to: "coder-max" },
          }) as AliasRevisionDiff,
        }),
      );
      expect(change.revisionId).toBe(REVISION);
      expect(change.warnings).toEqual([]);
      expect(change.nextResolution).toBeNull();
    });

    it("honours an explicit switch-off on a bound alias", async () => {
      await service.create(ORG, ACTOR, {
        alias: "coder-max",
        connectionId: ANTHROPIC,
        modelId: "claude-fable-5",
        enabled: false,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        TRX,
        ORG,
        ACTOR,
        expect.objectContaining({ enabled: false }),
      );
    });

    it("surfaces the discovery warning rather than swallowing it", async () => {
      repository.discovery.mockResolvedValue({ discovered: false, catalogued: true });

      const change = await service.create(ORG, ACTOR, {
        alias: "coder-max",
        connectionId: ANTHROPIC,
        modelId: "claude-fable-5",
      });

      expect(change.warnings).toEqual([
        expect.objectContaining({ code: ALIAS_WARNINGS.modelNotDiscovered, fix: null }),
      ]);
      expect(change.warnings[0].message).toContain("lists other models");
    });

    it("tells a gap from a mismatch in the discovery warning", async () => {
      repository.discovery.mockResolvedValue({ discovered: false, catalogued: false });

      const change = await service.create(ORG, ACTOR, {
        alias: "coder-max",
        connectionId: ANTHROPIC,
        modelId: "claude-fable-5",
      });

      expect(change.warnings[0].message).toContain("Nothing has been discovered");
    });

    it("stores an unbound alias switched off whatever the body said, with the pointer", async () => {
      repository.find.mockResolvedValue(UNBOUND);

      const change = await service.create(ORG, ACTOR, {
        alias: "gpt5-experiments",
        modelId: "gpt-5.2-preview",
        enabled: true,
      });

      expect(params.assertWriteValid).toHaveBeenCalledWith(ORG, null, "gpt-5.2-preview", {
        params: {},
        restrictions: {},
      });
      expect(repository.insert).toHaveBeenCalledWith(
        TRX,
        ORG,
        ACTOR,
        expect.objectContaining({ connectionId: null, enabled: false }),
      );
      expect(repository.discovery).not.toHaveBeenCalled();
      expect(change.warnings).toEqual([
        expect.objectContaining({ code: ALIAS_WARNINGS.unbound, fix: PROVIDERS_FIX_PATH }),
      ]);
    });

    it("refuses a connection this workspace does not have, before writing", async () => {
      const error = await refused(() =>
        service.create(ORG, ACTOR, { alias: "x", connectionId: "nope", modelId: "m" }),
      );

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe(REGISTRY_ERRORS.connectionNotFound);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("refuses a taken name before writing", async () => {
      repository.findByName.mockResolvedValue(ROW);

      const error = await refused(() =>
        service.create(ORG, ACTOR, { alias: "coder-max", connectionId: ANTHROPIC, modelId: "m" }),
      );

      expect(error.code).toBe(ALIAS_ERRORS.nameTaken);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("maps the race two creates can lose to the same designed 422", async () => {
      repository.insert.mockRejectedValue({
        code: "23505",
        constraint: "model_aliases_organization_alias_key",
      });

      const error = await refused(() =>
        service.create(ORG, ACTOR, { alias: "coder-max", connectionId: ANTHROPIC, modelId: "m" }),
      );

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect(error.code).toBe(ALIAS_ERRORS.nameTaken);
    });

    it("lets any other driver failure through untouched", async () => {
      repository.insert.mockRejectedValue(new Error("connection reset"));

      await expect(
        service.create(ORG, ACTOR, { alias: "coder-max", connectionId: ANTHROPIC, modelId: "m" }),
      ).rejects.toThrow("connection reset");
    });

    it("lets a params refusal through before anything is written", async () => {
      params.assertWriteValid.mockRejectedValue(
        new InvalidRequestError(REGISTRY_ERRORS.aliasParamsInvalid, "no", {}),
      );

      const error = await refused(() =>
        service.create(ORG, ACTOR, { alias: "x", connectionId: ANTHROPIC, modelId: "m" }),
      );

      expect(error.code).toBe(REGISTRY_ERRORS.aliasParamsInvalid);
      expect(database.transaction).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("refuses an alias this workspace does not have", async () => {
      repository.find.mockResolvedValue(undefined);

      const error = await refused(() => service.update(ORG, ACTOR, ALIAS_ID, { notes: "x" }));

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe(ALIAS_ERRORS.notFound);
    });

    it("edits params and notes, validated against the current binding, as one revision", async () => {
      const change = await service.update(ORG, ACTOR, ALIAS_ID, {
        params: { thinking: "std" },
        notes: "prod key",
      });

      expect(params.assertWriteValid).toHaveBeenCalledWith(ORG, ANTHROPIC, "claude-fable-5", {
        params: { thinking: "std" },
        restrictions: {},
      });
      expect(repository.update).toHaveBeenCalledWith(
        TRX,
        ORG,
        ALIAS_ID,
        ACTOR,
        expect.objectContaining({ params: { thinking: "std" }, notes: "prod key" }),
      );
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          action: "edited",
          diff: {
            params: { from: { thinking: "max" }, to: { thinking: "std" } },
            notes: { from: null, to: "prod key" },
          },
        }),
      );
      expect(change.revisionId).toBe(REVISION);
    });

    it("writes nothing and records nothing for a patch that changes nothing", async () => {
      const change = await service.update(ORG, ACTOR, ALIAS_ID, {
        params: { thinking: "max" },
        enabled: true,
      });

      expect(database.transaction).not.toHaveBeenCalled();
      expect(change.revisionId).toBeNull();
      expect(change.alias.alias).toBe("coder-max");
    });

    it("rebinds in one row, validates the stored params against the new model, and says where the next resolution goes", async () => {
      repository.references.mockResolvedValue(REFERENCES);

      const change = await service.update(ORG, ACTOR, ALIAS_ID, { connectionId: BEDROCK });

      // The stored params, re-checked against the binding *after* the write.
      expect(params.assertWriteValid).toHaveBeenCalledWith(ORG, BEDROCK, "claude-fable-5", {
        params: { thinking: "max" },
        restrictions: {},
      });
      expect(repository.update).toHaveBeenCalledWith(
        TRX,
        ORG,
        ALIAS_ID,
        ACTOR,
        expect.objectContaining({ connectionId: BEDROCK, enabled: true }),
      );
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          action: "rebound",
          diff: { provider_connection_id: { from: ANTHROPIC, to: BEDROCK } },
        }),
      );
      expect(change.nextResolution).toEqual({
        connection: { id: BEDROCK, kind: "anthropic", displayName: "Anthropic — Bedrock" },
        modelId: "claude-fable-5",
      });
      // Referrers untouched by design: nothing here reaches a hop, a rule or a workflow.
      expect(repository.delete).not.toHaveBeenCalled();
      expect(change.droppedHops).toEqual([]);
    });

    it("asks discovery again on a rebind, and not on an edit", async () => {
      repository.discovery.mockResolvedValue({ discovered: false, catalogued: false });

      const edited = await service.update(ORG, ACTOR, ALIAS_ID, { notes: "x" });
      expect(repository.discovery).not.toHaveBeenCalled();
      expect(edited.warnings).toEqual([]);

      const rebound = await service.update(ORG, ACTOR, ALIAS_ID, { modelId: "claude-sonnet-5" });
      expect(repository.discovery).toHaveBeenCalledWith(ANTHROPIC, "claude-sonnet-5");
      expect(rebound.warnings[0].code).toBe(ALIAS_WARNINGS.modelNotDiscovered);
    });

    it("refuses enabling an unbound alias with the pointer, and writes nothing", async () => {
      repository.find.mockResolvedValue(UNBOUND);

      const error = await refused(() => service.update(ORG, ACTOR, NEW_ID, { enabled: true }));

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect(error.code).toBe(ALIAS_ERRORS.unbound);
      expect(error.details).toEqual({ alias: "gpt5-experiments", fix: PROVIDERS_FIX_PATH });
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("switches an enabled alias off when it is unbound, and says so", async () => {
      const change = await service.update(ORG, ACTOR, ALIAS_ID, { connectionId: null });

      expect(repository.update).toHaveBeenCalledWith(
        TRX,
        ORG,
        ALIAS_ID,
        ACTOR,
        expect.objectContaining({ connectionId: null, enabled: false }),
      );
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({ action: "rebound" }),
      );
      expect(change.warnings[0].code).toBe(ALIAS_WARNINGS.unbound);
      expect(change.nextResolution).toEqual({ connection: null, modelId: "claude-fable-5" });
    });

    it("refuses unbinding and enabling in one body", async () => {
      const error = await refused(() =>
        service.update(ORG, ACTOR, ALIAS_ID, { connectionId: null, enabled: true }),
      );

      expect(error.code).toBe(ALIAS_ERRORS.unbound);
    });

    it("refuses renaming a referenced alias, naming the referrers, and writes nothing", async () => {
      repository.references.mockResolvedValue(REFERENCES);

      const error = await refused(() =>
        service.update(ORG, ACTOR, ALIAS_ID, { alias: "coder-primary" }),
      );

      expect(error.code).toBe(ALIAS_ERRORS.renameBlocked);
      expect(error.details).toEqual({
        alias: "coder-max",
        references: [
          expect.objectContaining({ kind: "route", label: "implement-primary" }),
          expect.objectContaining({ kind: "escalation", label: "escalation:effort≥L" }),
        ],
      });
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("renames an unreferenced alias, checking the new name is free", async () => {
      const change = await service.update(ORG, ACTOR, ALIAS_ID, { alias: "coder-primary" });

      expect(repository.findByName).toHaveBeenCalledWith(ORG, "coder-primary");
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          alias: "coder-primary",
          action: "renamed",
          diff: { alias: { from: "coder-max", to: "coder-primary" } },
        }),
      );
      expect(change.revisionId).toBe(REVISION);
    });

    it("refuses a rename onto a taken name", async () => {
      repository.findByName.mockResolvedValue(UNBOUND);

      const error = await refused(() =>
        service.update(ORG, ACTOR, ALIAS_ID, { alias: "gpt5-experiments" }),
      );

      expect(error.code).toBe(ALIAS_ERRORS.nameTaken);
    });

    it("switches a referenced alias off, and names the hops it will drop", async () => {
      repository.references.mockResolvedValue(REFERENCES);

      const change = await service.update(ORG, ACTOR, ALIAS_ID, { enabled: false });

      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({ action: "disabled" }),
      );
      expect(change.droppedHops).toEqual([
        expect.objectContaining({ kind: "route", label: "implement-primary" }),
        expect.objectContaining({ kind: "escalation", label: "escalation:effort≥L" }),
      ]);
    });

    it("switches a bound alias back on, with no drama", async () => {
      repository.find.mockResolvedValue({ ...ROW, enabled: false });

      const change = await service.update(ORG, ACTOR, ALIAS_ID, { enabled: true });

      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({ action: "enabled" }),
      );
      expect(change.droppedHops).toEqual([]);
    });

    it("answers 404 when the row vanished between the read and the write", async () => {
      repository.update.mockResolvedValue(false);

      const error = await refused(() => service.update(ORG, ACTOR, ALIAS_ID, { notes: "x" }));

      expect(error.code).toBe(ALIAS_ERRORS.notFound);
    });
  });

  describe("duplicate", () => {
    it("copies binding, params, restrictions and notes to -copy, switched off, and records the source", async () => {
      repository.find
        .mockResolvedValueOnce({ ...ROW, notes: "prod key", restrictions: { batch_ok: true } })
        .mockResolvedValueOnce({ ...ROW, id: NEW_ID, alias: "coder-max-copy", enabled: false });

      const change = await service.duplicate(ORG, ACTOR, ALIAS_ID);

      expect(repository.namesStartingWith).toHaveBeenCalledWith(ORG, "coder-max-copy");
      expect(repository.insert).toHaveBeenCalledWith(TRX, ORG, ACTOR, {
        alias: "coder-max-copy",
        connectionId: ANTHROPIC,
        modelId: "claude-fable-5",
        enabled: false,
        params: { thinking: "max" },
        restrictions: { batch_ok: true },
        notes: "prod key",
      });
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          aliasId: NEW_ID,
          alias: "coder-max-copy",
          action: "duplicated",
          diff: expect.objectContaining({
            duplicate_of: { from: null, to: "coder-max" },
          }) as AliasRevisionDiff,
        }),
      );
      expect(change.alias.alias).toBe("coder-max-copy");
      expect(change.warnings).toEqual([]);
    });

    it("suffixes a second copy rather than colliding", async () => {
      repository.namesStartingWith.mockResolvedValue(["coder-max-copy"]);

      await service.duplicate(ORG, ACTOR, ALIAS_ID);

      expect(repository.insert).toHaveBeenCalledWith(
        TRX,
        ORG,
        ACTOR,
        expect.objectContaining({ alias: "coder-max-copy-2" }),
      );
    });

    it("refuses a copy whose name would not fit, before writing", async () => {
      repository.find.mockResolvedValue({ ...ROW, alias: "a".repeat(62) });

      const error = await refused(() => service.duplicate(ORG, ACTOR, ALIAS_ID));

      expect(error.code).toBe(ALIAS_ERRORS.copyNameTooLong);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("warns when the copy is unbound, as the source was", async () => {
      repository.find.mockResolvedValue(UNBOUND);

      const change = await service.duplicate(ORG, ACTOR, NEW_ID);

      expect(change.warnings[0].code).toBe(ALIAS_WARNINGS.unbound);
    });
  });

  describe("remove", () => {
    it("refuses a referenced alias with the guarded list, and deletes nothing", async () => {
      repository.guardedReferences.mockResolvedValue(REFERENCES);

      const error = await refused(() => service.remove(ORG, ACTOR, ALIAS_ID));

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe(ALIAS_ERRORS.referenced);
      expect(repository.guardedReferences).toHaveBeenCalledWith(TRX, ORG, ALIAS_ID);
      expect(repository.recordRevision).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("records the deletion while the row still exists, then deletes it", async () => {
      const order: string[] = [];
      repository.recordRevision.mockImplementation(() => {
        order.push("revision");
        return Promise.resolve(REVISION);
      });
      repository.delete.mockImplementation(() => {
        order.push("delete");
        return Promise.resolve(true);
      });

      await service.remove(ORG, ACTOR, ALIAS_ID);

      expect(order).toEqual(["revision", "delete"]);
      expect(repository.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          aliasId: ALIAS_ID,
          alias: "coder-max",
          action: "deleted",
          diff: expect.objectContaining({
            alias: { from: "coder-max", to: null },
          }) as AliasRevisionDiff,
        }),
      );
    });

    it("answers 404 for an alias this workspace does not have, or one that vanished", async () => {
      repository.find.mockResolvedValue(undefined);
      await expect(service.remove(ORG, ACTOR, ALIAS_ID)).rejects.toMatchObject({
        code: ALIAS_ERRORS.notFound,
      });

      repository.find.mockResolvedValue(ROW);
      repository.delete.mockResolvedValue(false);
      await expect(service.remove(ORG, ACTOR, ALIAS_ID)).rejects.toMatchObject({
        code: ALIAS_ERRORS.notFound,
      });
    });
  });

  describe("modelOptions", () => {
    it("lists what discovery reported, under the connection", async () => {
      repository.modelOptions.mockResolvedValue([
        {
          model_id: "claude-fable-5",
          display: "Claude Fable 5",
          discovered_at: new Date("2026-08-23T09:55:00.000Z"),
          meta: {},
        },
      ]);

      const options = await service.modelOptions(ORG, ANTHROPIC);

      expect(options.connection).toEqual({
        id: ANTHROPIC,
        kind: "anthropic",
        displayName: "Anthropic Claude",
      });
      expect(options.models).toEqual([expect.objectContaining({ modelId: "claude-fable-5" })]);
    });

    it("refuses a connection this workspace does not have", async () => {
      const error = await refused(() => service.modelOptions(ORG, "nope"));

      expect(error.code).toBe(REGISTRY_ERRORS.connectionNotFound);
      expect(repository.modelOptions).not.toHaveBeenCalled();
    });
  });
});
