import type { Transaction } from "kysely";

import type { DatabaseService } from "../db/db.service";
import { THINKING_LEVELS, type Database } from "../db/schema";
import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import { UNPRICED, type ResolvedPrice } from "../pricing/price";
import type { PricingService } from "../pricing/pricing.service";
import { MODEL_PARAM_DIALECT, type ModelParamSchema } from "../providers/provider.params";
import type { AliasesRepository } from "./aliases.repository";
import type { AliasConnectionRow, AliasRow, ModelOptionRow } from "./aliases.rows";
import { ALIAS_FIELD, IMPORT_ERRORS, IMPORT_MESSAGES, MODEL_ID_FIELD } from "./import.errors";
import type { ImportRepository } from "./import.repository";
import { NO_MODELS_DISCOVERED } from "./import.resources";
import { ImportService } from "./import.service";
import type { ImportAliasRow } from "./import.rows";
import type { ModelParamAnswer, ParamSchemaService } from "./params.service";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * The wizard's decisions, against repositories that answer what the test says
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * What the statements do against a real database — the transaction, V015's unique key, the
 * revision records — is `import.integration-spec.ts`'s. This is about *which* rule fires and
 * *in what order*: that a skip happens before validation, that a refusal describes every item
 * rather than the first, and that nothing is written when anything is wrong.
 */

const ORG = "org-acme";
const ACTOR = "user-ken";
const ANTHROPIC = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const OLLAMA = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";
const NEW_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REVISION = "a1000000-0000-0000-0000-000000000001";

const TRX = { transaction: "sentinel" } as unknown as Transaction<Database>;

const ANTHROPIC_ROW: AliasConnectionRow = {
  id: ANTHROPIC,
  kind: "anthropic",
  display_name: "Anthropic Claude",
};

/** The seeded Anthropic connection's four models — three of which the seed already aliases. */
const MODELS: ModelOptionRow[] = [
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-opus-5",
  "claude-sonnet-5",
].map((model_id) => ({
  model_id,
  display: model_id,
  discovered_at: new Date("2026-08-24T09:56:00.000Z"),
  meta: { context_tokens: 1000000, tier: "priority" },
}));

const BOUND: ImportAliasRow[] = [
  { id: "alias-1", alias: "coder-max", model_id: "claude-fable-5" },
  { id: "alias-2", alias: "coder-std", model_id: "claude-sonnet-5" },
  { id: "alias-3", alias: "sizer", model_id: "claude-haiku-4-5" },
];

const ROW: AliasRow = {
  id: NEW_ID,
  organization_id: ORG,
  alias: "opus-5",
  provider_connection_id: ANTHROPIC,
  model_id: "claude-opus-5",
  enabled: true,
  params: {},
  restrictions: {},
  notes: null,
  updated_by: ACTOR,
  created_at: new Date("2026-08-25T10:00:00.000Z"),
  updated_at: new Date("2026-08-25T10:00:00.000Z"),
  connection_kind: "anthropic",
  connection_display_name: "Anthropic Claude",
};

/** An empty document half — `restrictions` here, and the whole schema where nothing is offered. */
const NOTHING_OFFERED: ModelParamSchema = {
  $schema: MODEL_PARAM_DIALECT,
  type: "object",
  title: "Model parameters",
  description: "This provider publishes no per-call parameters this product can set.",
  properties: {},
  additionalProperties: false,
};

/** CH.2's answer for a model that offers a thinking control — the seeded Anthropic shape. */
const ANSWER: ModelParamAnswer = {
  schema: {
    params: {
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Model parameters",
      properties: { thinking: { type: "string", title: "Thinking", enum: [...THINKING_LEVELS] } },
      additionalProperties: false,
    },
    restrictions: NOTHING_OFFERED,
    reason: null,
    sources: ["adapter"],
  },
  capabilities: {
    params: ["thinking"],
    thinking: true,
    contextTokens: 1000000,
    maxOutputTokens: 64000,
    reason: null,
  },
};

/** CH.2's answer for a model with nothing to tune — what refuses every param. */
const OFFERS_NOTHING: ModelParamAnswer = {
  schema: {
    params: NOTHING_OFFERED,
    restrictions: NOTHING_OFFERED,
    reason: "provider_has_no_parameters",
    sources: ["registry"],
  },
  capabilities: {
    params: [],
    thinking: false,
    contextTokens: null,
    maxOutputTokens: null,
    reason: "provider_has_no_parameters",
  },
};

const FREE_PRICE: ResolvedPrice = {
  billingMode: "free",
  inputCentsPer1m: null,
  outputCentsPer1m: null,
  provenance: { source: "bundled", catalogVersion: "2026-08-15", effectiveAt: new Date(0) },
};

type Aliases = jest.Mocked<Pick<AliasesRepository, keyof AliasesRepository>>;
type Imports = jest.Mocked<Pick<ImportRepository, keyof ImportRepository>>;

describe("the import service", () => {
  let aliases: Aliases;
  let imports: Imports;
  let params: jest.Mocked<Pick<ParamSchemaService, "forModels">>;
  let prices: jest.Mocked<Pick<PricingService, "resolveMany">>;
  let database: { transaction: jest.Mock };
  let service: ImportService;

  beforeEach(() => {
    aliases = {
      list: jest.fn().mockResolvedValue([ROW]),
      find: jest.fn(),
      findByName: jest.fn(),
      references: jest.fn().mockResolvedValue([]),
      guardedReferences: jest.fn(),
      connection: jest
        .fn()
        .mockImplementation((_org: string, id: string) =>
          Promise.resolve(id === ANTHROPIC ? ANTHROPIC_ROW : undefined),
        ),
      discovery: jest.fn(),
      modelOptions: jest.fn().mockResolvedValue(MODELS),
      namesStartingWith: jest.fn(),
      insert: jest.fn().mockResolvedValue(NEW_ID),
      update: jest.fn(),
      delete: jest.fn(),
      recordRevision: jest.fn().mockResolvedValue(REVISION),
    };
    imports = {
      aliasesOn: jest.fn().mockResolvedValue(BOUND),
      aliasNames: jest.fn().mockResolvedValue(BOUND.map((row) => row.alias)),
    };
    params = {
      forModels: jest
        .fn()
        .mockImplementation((_org: string, _connection: string, modelIds: string[]) =>
          Promise.resolve(new Map(modelIds.map((modelId) => [modelId, ANSWER]))),
        ),
    };
    prices = { resolveMany: jest.fn().mockResolvedValue(MODELS.map(() => undefined)) };
    database = {
      transaction: jest.fn((work: (trx: Transaction<Database>) => Promise<unknown>) => work(TRX)),
    };
    service = new ImportService(
      imports as unknown as ImportRepository,
      aliases as unknown as AliasesRepository,
      params as unknown as ParamSchemaService,
      prices as unknown as PricingService,
      database as unknown as DatabaseService,
    );
  });

  /**
   * Run a call expected to refuse, and hand back what it refused with.
   *
   * @param call - The call.
   * @returns The error.
   */
  async function refused(call: () => Promise<unknown>): Promise<{
    code: string;
    details: { items?: Record<string, Record<string, string[]>> };
  }> {
    try {
      await call();
    } catch (error) {
      return error as { code: string; details: { items?: never } };
    }
    throw new Error("expected the call to be refused, and it was not");
  }

  describe("candidates", () => {
    it("refuses a connection this workspace does not have", async () => {
      await expect(service.candidates(ORG, OLLAMA)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.candidates(ORG, OLLAMA)).rejects.toMatchObject({
        code: REGISTRY_ERRORS.connectionNotFound,
      });
    });

    it("marks the three already-aliased models and suggests names for the rest", async () => {
      // The ticket's first acceptance criterion, against the seed's own shape.
      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates.map((row) => [row.modelId, row.alias?.alias ?? null])).toEqual([
        ["claude-fable-5", "coder-max"],
        ["claude-haiku-4-5", "sizer"],
        ["claude-opus-5", null],
        ["claude-sonnet-5", "coder-std"],
      ]);
      expect(candidates.filter((row) => row.selected).map((row) => row.suggestedName)).toEqual([
        "opus-5",
      ]);
    });

    it("suggests short names by dropping the prefix every model shares", async () => {
      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates.map((row) => row.suggestedName)).toEqual([
        "fable-5",
        "haiku-4-5",
        "opus-5",
        "sonnet-5",
      ]);
    });

    it("suffixes a suggestion the workspace has already taken", async () => {
      imports.aliasNames.mockResolvedValue([...BOUND.map((row) => row.alias), "opus-5"]);

      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates[2].suggestedName).toBe("opus-5-2");
    });

    it("asks CH.2 and CH.3 once each, about every model at once", async () => {
      // The N+1 this whole path is shaped to avoid: a forty-model connection is a handful of
      // statements, not eighty.
      await service.candidates(ORG, ANTHROPIC);

      expect(params.forModels).toHaveBeenCalledTimes(1);
      expect(params.forModels).toHaveBeenCalledWith(
        ORG,
        ANTHROPIC,
        MODELS.map((model) => model.model_id),
      );
      expect(prices.resolveMany).toHaveBeenCalledTimes(1);
      expect(prices.resolveMany).toHaveBeenCalledWith(
        MODELS.map((model) => ({ connectionKind: "anthropic", modelId: model.model_id })),
        ORG,
      );
    });

    it("carries the price CH.3 resolved for each row, in the order it asked", async () => {
      prices.resolveMany.mockResolvedValue([undefined, undefined, FREE_PRICE, undefined]);

      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates[2].price.display).toBe("$0");
      // And an uncovered model is an em dash, never a zero.
      expect(candidates[0].price.display).toBe(UNPRICED);
    });

    it("carries CH.2's headline on every row", async () => {
      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates[0].capabilities).toEqual(ANSWER.capabilities);
    });

    it("answers an honest empty when discovery has reported nothing", async () => {
      aliases.modelOptions.mockResolvedValue([]);

      const { candidates, empty } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates).toEqual([]);
      expect(empty?.code).toBe(NO_MODELS_DISCOVERED);
      expect(empty?.message).toContain("Anthropic Claude");
      // And nothing was asked of the services that had nothing to answer about.
      expect(params.forModels).not.toHaveBeenCalled();
      expect(prices.resolveMany).not.toHaveBeenCalled();
    });

    it("leaves `empty` null whenever there is anything to show", async () => {
      expect((await service.candidates(ORG, ANTHROPIC)).empty).toBeNull();
    });

    it("marks a model with the alphabetically first of the aliases naming it", async () => {
      imports.aliasesOn.mockResolvedValue([
        { id: "alias-a", alias: "aardvark", model_id: "claude-opus-5" },
        { id: "alias-z", alias: "zebra", model_id: "claude-opus-5" },
      ]);

      const { candidates } = await service.candidates(ORG, ANTHROPIC);

      expect(candidates[2].alias?.alias).toBe("aardvark");
    });
  });

  describe("create", () => {
    const OPUS = { modelId: "claude-opus-5", alias: "opus-5" };

    it("refuses a connection this workspace does not have, before anything else", async () => {
      await expect(
        service.create(ORG, ACTOR, { connectionId: OLLAMA, items: [OPUS] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("creates every item, enabled and bound, in one transaction", async () => {
      const result = await service.create(ORG, ACTOR, {
        connectionId: ANTHROPIC,
        items: [
          OPUS,
          { modelId: "claude-opus-5", alias: "opus-thinking", params: { thinking: "max" } },
        ],
      });

      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(aliases.insert).toHaveBeenCalledTimes(2);
      // Enabled — the deliberate opposite of duplicate's off-default, because every row here
      // is bound to a connection the operator just chose.
      expect(aliases.insert).toHaveBeenNthCalledWith(1, TRX, ORG, ACTOR, {
        alias: "opus-5",
        connectionId: ANTHROPIC,
        modelId: "claude-opus-5",
        enabled: true,
        params: {},
        restrictions: {},
        notes: null,
      });
      expect(aliases.insert).toHaveBeenNthCalledWith(
        2,
        TRX,
        ORG,
        ACTOR,
        expect.objectContaining({ alias: "opus-thinking", params: { thinking: "max" } }),
      );
      expect(result.created).toHaveLength(2);
      expect(result.skipped).toEqual([]);
    });

    it("records one `created` revision per alias, in the same transaction", async () => {
      await service.create(ORG, ACTOR, { connectionId: ANTHROPIC, items: [OPUS] });

      expect(aliases.recordRevision).toHaveBeenCalledTimes(1);
      expect(aliases.recordRevision).toHaveBeenCalledWith(
        TRX,
        expect.objectContaining({
          organizationId: ORG,
          aliasId: NEW_ID,
          alias: "opus-5",
          actor: ACTOR,
          action: "created",
        }),
      );
      // Every column moved, because a create moves every column.
      const [, record] = aliases.recordRevision.mock.calls[0];
      expect(record.diff.alias).toEqual({ from: null, to: "opus-5" });
      expect(record.diff.enabled).toEqual({ from: null, to: true });
    });

    it("answers each created alias re-read after the commit, with its revision", async () => {
      const result = await service.create(ORG, ACTOR, { connectionId: ANTHROPIC, items: [OPUS] });

      // Two reads for the whole batch, not two per alias.
      expect(aliases.list).toHaveBeenCalledTimes(1);
      expect(aliases.references).toHaveBeenCalledWith(ORG, [NEW_ID]);
      expect(result.created[0]).toEqual({
        alias: expect.objectContaining({
          id: NEW_ID,
          alias: "opus-5",
          enabled: true,
        }) as object,
        revisionId: REVISION,
      });
    });

    it("skips a model that already has an alias, and says which one", async () => {
      const result = await service.create(ORG, ACTOR, {
        connectionId: ANTHROPIC,
        items: [{ modelId: "claude-fable-5", alias: "fable-5" }, OPUS],
      });

      expect(result.skipped).toEqual([
        {
          modelId: "claude-fable-5",
          requestedAlias: "fable-5",
          alias: { id: "alias-1", alias: "coder-max" },
        },
      ]);
      expect(aliases.insert).toHaveBeenCalledTimes(1);
    });

    it("skips a whole re-run without writing or refusing anything", async () => {
      // The idempotency criterion. Every item's model is already aliased, so nothing is
      // created, nothing is refused, and the report says what that meant.
      const result = await service.create(ORG, ACTOR, {
        connectionId: ANTHROPIC,
        items: [
          { modelId: "claude-fable-5", alias: "fable-5" },
          { modelId: "claude-sonnet-5", alias: "sonnet-5" },
        ],
      });

      expect(result.created).toEqual([]);
      expect(result.skipped).toHaveLength(2);
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it("skips before it validates, so a re-run's stale name is never checked", async () => {
      // The interaction that makes idempotency real: the second run sends the names the first
      // run created, and checking them would refuse a batch whose only fault is repetition.
      imports.aliasNames.mockResolvedValue([...BOUND.map((row) => row.alias), "coder-max"]);

      const result = await service.create(ORG, ACTOR, {
        connectionId: ANTHROPIC,
        items: [{ modelId: "claude-fable-5", alias: "coder-max" }],
      });

      expect(result.skipped).toHaveLength(1);
      expect(result.created).toEqual([]);
    });

    describe("the refusal", () => {
      it("refuses a model discovery has not reported, and creates nothing", async () => {
        // Decision R7 — the one place import is stricter than CH.1's create, which warns.
        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [{ modelId: "claude-3-5-sonnet", alias: "sonnet-legacy" }],
          }),
        );

        expect(error.code).toBe(IMPORT_ERRORS.invalid);
        expect(error.details.items).toEqual({
          "0": { [MODEL_ID_FIELD]: [IMPORT_MESSAGES.notDiscovered] },
        });
        expect(database.transaction).not.toHaveBeenCalled();
        expect(aliases.insert).not.toHaveBeenCalled();
      });

      it("refuses a name the workspace already has", async () => {
        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [{ modelId: "claude-opus-5", alias: "coder-max" }],
          }),
        );

        expect(error.details.items).toEqual({
          "0": { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameTaken] },
        });
      });

      it("refuses a name the batch asks for twice, on both rows", async () => {
        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [OPUS, { modelId: "claude-opus-5", alias: "opus-5" }],
          }),
        );

        expect(error.details.items).toEqual({
          "0": { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameRepeated] },
          "1": { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameRepeated] },
        });
      });

      it("folds CH.2's per-field param errors into the item that carried them", async () => {
        // A model with nothing to tune, so `thinking` is a param it does not accept.
        params.forModels.mockResolvedValue(new Map([["claude-opus-5", OFFERS_NOTHING]]));

        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [{ modelId: "claude-opus-5", alias: "opus-5", params: { thinking: "max" } }],
          }),
        );

        expect(error.code).toBe(IMPORT_ERRORS.invalid);
        expect(Object.keys(error.details.items ?? {})).toEqual(["0"]);
        expect(Object.keys(error.details.items?.["0"] ?? {})).toEqual(["params.thinking"]);
      });

      it("describes every bad item, not the first one it met", async () => {
        // An operator whose wizard has three problems should learn all three now rather than
        // one per submission.
        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [
              { modelId: "claude-3-5-sonnet", alias: "sonnet-legacy" },
              OPUS,
              { modelId: "claude-opus-5", alias: "coder-max" },
            ],
          }),
        );

        expect(Object.keys(error.details.items ?? {})).toEqual(["0", "2"]);
      });

      it("keys the complaints by request position, so a repeated model still maps back", async () => {
        const error = await refused(() =>
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [
              { modelId: "claude-3-5-sonnet", alias: "one" },
              { modelId: "claude-3-5-sonnet", alias: "two" },
            ],
          }),
        );

        expect(Object.keys(error.details.items ?? {})).toEqual(["0", "1"]);
      });

      it("answers the lost name race as the same refusal, never as a driver error", async () => {
        // The race the pre-check cannot close: another import took the name between the check
        // and the insert. V015's unique key refuses it, the whole batch rolls back, and the
        // client gets the code it already knows how to render.
        database.transaction.mockRejectedValue(
          Object.assign(new Error("duplicate key"), {
            code: "23505",
            constraint: "model_aliases_organization_alias_key",
          }),
        );

        const error = await refused(() =>
          service.create(ORG, ACTOR, { connectionId: ANTHROPIC, items: [OPUS] }),
        );

        expect(error.code).toBe(IMPORT_ERRORS.invalid);
        // Its own sentence: the key names the constraint and not which insert met it, so
        // telling somebody every name in their batch is taken would be a wrong statement.
        expect(error.details.items).toEqual({
          "0": { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameRaced] },
        });
      });

      it("lets any other failure out untouched", async () => {
        const failure = new Error("the connection dropped");

        database.transaction.mockRejectedValue(failure);

        await expect(
          service.create(ORG, ACTOR, { connectionId: ANTHROPIC, items: [OPUS] }),
        ).rejects.toBe(failure);
      });

      it("is an InvalidRequestError, so the filter answers 422", async () => {
        await expect(
          service.create(ORG, ACTOR, {
            connectionId: ANTHROPIC,
            items: [{ modelId: "claude-opus-5", alias: "coder-max" }],
          }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      });
    });
  });
});
