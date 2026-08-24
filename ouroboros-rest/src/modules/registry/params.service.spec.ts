import { NotFoundError } from "../errors/error.envelope";
import {
  FAKE_PARAM_SCHEMA,
  FakeModelProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { SOURCES_ANNOTATION } from "../providers/provider.params";
import { ParamSchemaService } from "./params.service";
import type { RegistryRepository } from "./registry.repository";

/**
 * What the service composes, and the two absences it answers rather than refuses.
 *
 * The precedence rule itself is `params.merge.spec.ts`'s — stated in literals, with no
 * repository in sight. What is left here is the composition: which reads happen, that every one
 * of them carries the workspace, that a missing connection is a `404` and that a *kind with no
 * adapter* is a rendered explanation instead of a `501`.
 */

const ORG = "acme-robotics-id";
const CONNECTION = "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01";
const MODEL = "fake/small";

/** The repository, answered rather than connected. */
type Repository = jest.Mocked<Pick<RegistryRepository, keyof RegistryRepository>>;

describe("the param schema service", () => {
  let repository: Repository;
  let adapters: ModelProviderRegistry;
  let service: ParamSchemaService;

  beforeEach(() => {
    repository = {
      resolveAlias: jest.fn(),
      listAliases: jest.fn(),
      aliasesForConnection: jest.fn(),
      findConnection: jest.fn().mockResolvedValue({ id: CONNECTION, kind: "custom" }),
      discoveredModelMeta: jest.fn().mockResolvedValue(undefined),
      catalogModelMeta: jest.fn().mockResolvedValue(undefined),
    };

    // The fake registers under `custom`, which is V015's kind for *an endpoint this product has
    // no adapter opinion about* — so a test using it exercises a kind the registry really
    // accepts rather than a `fake` nobody could store.
    adapters = new ModelProviderRegistry([new FakeModelProviderAdapter()]);
    service = new ParamSchemaService(repository as unknown as RegistryRepository, adapters);
  });

  describe("schemaFor", () => {
    it("answers the bound adapter's schema, merged", async () => {
      const merged = await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(Object.keys(merged.params.properties)).toEqual(
        Object.keys(FAKE_PARAM_SCHEMA.properties),
      );
      expect(merged.reason).toBeNull();
    });

    it("carries the workspace into every read", async () => {
      // The value comes from the tenant context and never from anything a caller wrote: a
      // connection resolved out of the wrong workspace would answer a schema shaped by another
      // workspace's discovery.
      await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(repository.findConnection).toHaveBeenCalledWith(ORG, CONNECTION);
      expect(repository.discoveredModelMeta).toHaveBeenCalledWith(ORG, CONNECTION, MODEL);
      expect(repository.catalogModelMeta).toHaveBeenCalledWith(ORG, "custom", MODEL);
    });

    it("asks the catalog with the connection's kind, which is half its lookup key", async () => {
      repository.findConnection.mockResolvedValue({ id: CONNECTION, kind: "ollama" });
      adapters = new ModelProviderRegistry([new FakeModelProviderAdapter({ kind: "ollama" })]);
      service = new ParamSchemaService(repository as unknown as RegistryRepository, adapters);

      await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(repository.catalogModelMeta).toHaveBeenCalledWith(ORG, "ollama", MODEL);
    });

    it("narrows a bound from what the provider reported", async () => {
      repository.discoveredModelMeta.mockResolvedValue({ context_tokens: 32_768 });

      const merged = await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(merged.params.properties.token_budget.maximum).toBe(32_768);
      expect(merged.params.properties.token_budget[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "discovery",
      ]);
    });

    it("fills an absent bound from the catalog, labelled as catalogued", async () => {
      repository.catalogModelMeta.mockResolvedValue({ max_output_tokens: 8192 });

      const merged = await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(merged.params.properties.max_output.maximum).toBe(8192);
      expect(merged.params.properties.max_output[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "catalog",
      ]);
    });

    it("builds the schema from the adapter alone when discovery has not run", async () => {
      // An ordinary state rather than an error: a schema built from the adapter alone is a
      // smaller answer, not a wrong one.
      const merged = await service.schemaFor(ORG, CONNECTION, MODEL);

      expect(merged.sources).not.toContain("discovery");
      expect(Object.keys(merged.params.properties).length).toBeGreaterThan(0);
    });

    describe("an unbound alias", () => {
      it("is answered without reading anything", async () => {
        // With no connection there is nothing to look up, and looking anyway would be a
        // statement that a null connection might still have a row.
        const merged = await service.schemaFor(ORG, null, "gpt-5.2-preview");

        expect(merged.reason).toBe("alias_unbound");
        expect(repository.findConnection).not.toHaveBeenCalled();
        expect(repository.discoveredModelMeta).not.toHaveBeenCalled();
        expect(repository.catalogModelMeta).not.toHaveBeenCalled();
      });

      it("still offers the registry's restrictions", async () => {
        const merged = await service.schemaFor(ORG, null, "gpt-5.2-preview");

        expect(Object.keys(merged.restrictions.properties)).toEqual([
          "review_vote_only",
          "batch_ok",
        ]);
      });
    });

    describe("a connection this workspace does not have", () => {
      it("is a 404 rather than an unbound answer", async () => {
        // A client that asked about a connection that is not there has a stale list, and
        // telling it the alias is unbound would send it to fix the wrong thing.
        repository.findConnection.mockResolvedValue(undefined);

        await expect(service.schemaFor(ORG, CONNECTION, MODEL)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it("carries the published code and the id it was asked about", async () => {
        repository.findConnection.mockResolvedValue(undefined);

        const error = await service
          .schemaFor(ORG, CONNECTION, MODEL)
          .catch((thrown: NotFoundError) => thrown);

        expect((error as NotFoundError).code).toBe("provider_connection_not_found");
        expect((error as NotFoundError).details).toEqual({ connectionId: CONNECTION });
      });
    });

    describe("a kind this build has no adapter for", () => {
      beforeEach(() => {
        // An empty registry is the honest way to arrange it: `custom` is a kind V015 accepts
        // and nothing in a build without the fake can reach.
        service = new ParamSchemaService(
          repository as unknown as RegistryRepository,
          new ModelProviderRegistry([]),
        );
      });

      it("renders a form that explains itself rather than answering 501", async () => {
        // Mockup 21's table has a row per alias and every one of them needs an inspector. A
        // status code here would take the panel down for a row that legitimately exists.
        const merged = await service.schemaFor(ORG, CONNECTION, MODEL);

        expect(merged.reason).toBe("provider_unsupported");
        expect(merged.params.description).toContain("no adapter");
      });

      it("looks up no metadata it could not use", async () => {
        await service.schemaFor(ORG, CONNECTION, MODEL);

        expect(repository.discoveredModelMeta).not.toHaveBeenCalled();
        expect(repository.catalogModelMeta).not.toHaveBeenCalled();
      });
    });
  });

  describe("assertWriteValid", () => {
    it("accepts params the model supports", async () => {
      await expect(
        service.assertWriteValid(ORG, CONNECTION, MODEL, { params: { thinking: "max" } }),
      ).resolves.toBeUndefined();
    });

    it("refuses a param the model does not have, naming the field", async () => {
      // The fake's schema has no context clamp, so this is the ticket's headline refusal on a
      // model whose schema the suite controls.
      const error = await service
        .assertWriteValid(ORG, CONNECTION, MODEL, { params: { context_clamp: 32_768 } })
        .catch((thrown: { code: string; details: object }) => thrown);

      expect((error as { code: string }).code).toBe("model_alias_params_invalid");
      expect(Object.keys((error as { details: object }).details)).toEqual(["params.context_clamp"]);
    });

    it("checks against the schema for the binding the write will leave behind", async () => {
      // A rebind changes what the params have to be legal for, and checking against the old
      // binding would let a write land params the new model has no notion of. The service reads
      // the schema itself rather than taking one from the caller, which is what makes that true.
      await service.assertWriteValid(ORG, CONNECTION, MODEL, {});

      expect(repository.findConnection).toHaveBeenCalledWith(ORG, CONNECTION);
    });

    it("refuses every param on an alias that will be unbound", async () => {
      await expect(
        service.assertWriteValid(ORG, null, "gpt-5.2-preview", { params: { thinking: "max" } }),
      ).rejects.toMatchObject({ code: "model_alias_params_invalid" });
    });

    it("accepts a restriction on an alias that will be unbound", async () => {
      await expect(
        service.assertWriteValid(ORG, null, "gpt-5.2-preview", {
          restrictions: { review_vote_only: true },
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts a write that tunes nothing", async () => {
      await expect(service.assertWriteValid(ORG, CONNECTION, MODEL, {})).resolves.toBeUndefined();
    });
  });
});
