import type { ModelPrice } from "../db/schema";
import { UNPRICED } from "./price";
import { PricingCache } from "./pricing.cache";
import type { PutPriceOverrideDto } from "./pricing.dto";
import { PRICING_ERRORS } from "./pricing.errors";
import type { PricingRepository } from "./pricing.repository";
import { PricingService } from "./pricing.service";

/**
 * The rules of the resolution, held where they live.
 *
 * The statements are the repository's and the role gate is the controller's; what is left here
 * is exactly what could go quietly wrong. **Folding**, because a lookup that missed on a
 * capital renders `—` for a priced model. **The cache**, because a batch that re-queries for
 * what it already knows is the criterion failed silently, and a save that leaves a stale entry
 * is a price shown after it was corrected. **Absence**, because the one thing this service must
 * never do is turn *unknown* into *free*.
 *
 * A real {@link PricingCache} rather than a mock of one: the cache's own behaviour is asserted
 * in `pricing.cache.spec.ts`, and what matters here is that the service uses it — which a mock
 * returning `undefined` would let pass while the query count went up.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A row, as the lookup would hand it back. */
function row(overrides: Partial<ModelPrice> = {}): ModelPrice {
  return {
    id: "6b1f0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    organization_id: null,
    match_provider_kind: "anthropic",
    match_model: "claude-fable-5",
    billing_mode: "token",
    input_cents_per_1m: "1000.0000",
    output_cents_per_1m: "5000.0000",
    source: "bundled",
    catalog_version: "2026-08-15+litellm.70d51a1",
    meta: {},
    effective_at: new Date("2026-08-15T01:16:59.000Z"),
    created_at: new Date("2026-08-15T01:16:59.000Z"),
    updated_at: new Date("2026-08-15T01:16:59.000Z"),
    ...overrides,
  };
}

/** A well-formed correction, as the pipe would hand it to the service. */
const CORRECTION: PutPriceOverrideDto = {
  connectionKind: "Anthropic",
  modelId: " claude-fable-5 ",
  billingMode: "token",
  inputCentsPer1m: 1200,
  outputCentsPer1m: 6000,
};

describe("the pricing service", () => {
  let repository: jest.Mocked<PricingRepository>;
  let cache: PricingCache;
  let pricing: PricingService;

  beforeEach(() => {
    repository = {
      resolve: jest.fn().mockResolvedValue(undefined),
      resolveMany: jest.fn().mockResolvedValue([]),
      listOverrides: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      upsertOverride: jest.fn(),
      deleteOverride: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PricingRepository>;
    cache = new PricingCache();

    pricing = new PricingService(repository, cache);
  });

  describe("resolving one model", () => {
    it("answers with the price the lookup found", async () => {
      repository.resolve.mockResolvedValue(row());

      const price = await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      expect(price?.billingMode).toBe("token");
      expect(price?.provenance.source).toBe("bundled");
    });

    it("answers undefined for a model the catalog does not cover", async () => {
      // Not a zeroed price, and not a `free` one. `undefined` is what the `—` cell is rendered
      // from, and it is the only honest answer to a question nothing has priced.
      repository.resolve.mockResolvedValue(undefined);

      await expect(pricing.resolve("anthropic", "gpt-5.2-preview", WORKSPACE)).resolves.toBe(
        undefined,
      );
    });

    it("folds the provider kind before looking it up", async () => {
      // `Anthropic` and `anthropic` are one kind. A lookup that missed on a capital would
      // render `—` for a model the catalog prices, which is the failure mode this whole surface
      // is built to avoid, reached by a spelling rather than by a gap.
      await pricing.resolve("Anthropic", "claude-fable-5", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledWith(WORKSPACE, "anthropic", "claude-fable-5");
    });

    it("trims the model identifier and leaves its casing alone", async () => {
      // The identifier is a name the vendor chose; folding it would be this service renaming
      // somebody else's model.
      await pricing.resolve("anthropic", "  Claude-Fable-5  ", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledWith(WORKSPACE, "anthropic", "Claude-Fable-5");
    });

    it.each([[null], [""], ["   "]])(
      "treats %p as an unbound alias rather than as a kind",
      async (connectionKind) => {
        // Mockup 21's `gpt5-experiments` names a model and no provider. A blank kind cannot
        // match any row — V012 requires at least one character — so calling it unbound says what
        // it is instead of leaving a query to discover it.
        await pricing.resolve(connectionKind, "gpt-5.2-preview", WORKSPACE);

        expect(repository.resolve).toHaveBeenCalledWith(WORKSPACE, null, "gpt-5.2-preview");
      },
    );

    it("asks the database once and remembers the answer", async () => {
      repository.resolve.mockResolvedValue(row());

      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(1);
    });

    it("remembers a miss too, rather than re-asking for the uncovered model", async () => {
      // The uncovered row is on the same page as the priced ones, and a cache that stored only
      // hits would make it the slowest cell in the table.
      repository.resolve.mockResolvedValue(undefined);

      await pricing.resolve("anthropic", "gpt-5.2-preview", WORKSPACE);
      await pricing.resolve("anthropic", "gpt-5.2-preview", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(1);
    });

    it("does not answer one workspace from another's memory", async () => {
      repository.resolve.mockResolvedValue(row());

      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);
      await pricing.resolve("anthropic", "claude-fable-5", "another-workspace");

      expect(repository.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolving a list", () => {
    /** The mockup's eight aliases, in the order its table draws them. */
    const EIGHT = [
      { connectionKind: "anthropic", modelId: "claude-fable-5" },
      { connectionKind: "anthropic", modelId: "claude-sonnet-5" },
      { connectionKind: "anthropic", modelId: "claude-haiku-4-5" },
      { connectionKind: "copilot", modelId: "gpt-5-codex" },
      { connectionKind: "cursor", modelId: "composer-2" },
      { connectionKind: "ollama", modelId: "qwen3-coder:32b" },
      { connectionKind: "openai_compatible", modelId: "llama-4-maverick" },
      { connectionKind: null, modelId: "gpt-5.2-preview" },
    ];

    it("resolves eight aliases with one call to the database", async () => {
      // The ticket's *the registry table costs one query rather than eight*.
      repository.resolveMany.mockResolvedValue(EIGHT.map(() => undefined));

      await pricing.resolveMany(EIGHT, WORKSPACE);

      expect(repository.resolveMany).toHaveBeenCalledTimes(1);
    });

    it("keeps the answers in the order they were asked for", async () => {
      repository.resolveMany.mockResolvedValue([
        row(),
        undefined,
        row({ billing_mode: "seat", input_cents_per_1m: null, output_cents_per_1m: null }),
      ]);

      const prices = await pricing.resolveMany(
        [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: null, modelId: "gpt-5.2-preview" },
          { connectionKind: "copilot", modelId: "gpt-5-codex" },
        ],
        WORKSPACE,
      );

      expect(prices.map((price) => price?.billingMode)).toEqual(["token", undefined, "seat"]);
    });

    it("asks about a repeated model once, and answers both positions", async () => {
      // A list may name one model twice — two aliases can point at the same model — and eight
      // lateral lookups for one row inside the one query is the same waste at a smaller scale.
      repository.resolveMany.mockResolvedValue([row()]);

      const prices = await pricing.resolveMany(
        [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: "Anthropic", modelId: "claude-fable-5" },
        ],
        WORKSPACE,
      );

      expect(repository.resolveMany).toHaveBeenCalledWith(WORKSPACE, [
        { connectionKind: "anthropic", modelId: "claude-fable-5" },
      ]);
      expect(prices.map((price) => price?.billingMode)).toEqual(["token", "token"]);
    });

    it("asks for nothing when every answer is already remembered", async () => {
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      await pricing.resolveMany(
        [{ connectionKind: "anthropic", modelId: "claude-fable-5" }],
        WORKSPACE,
      );

      expect(repository.resolveMany).not.toHaveBeenCalled();
    });

    it("asks only for what it does not know", async () => {
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);
      repository.resolveMany.mockResolvedValue([undefined]);

      await pricing.resolveMany(
        [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: null, modelId: "gpt-5.2-preview" },
        ],
        WORKSPACE,
      );

      expect(repository.resolveMany).toHaveBeenCalledWith(WORKSPACE, [
        { connectionKind: null, modelId: "gpt-5.2-preview" },
      ]);
    });

    it("issues nothing for an empty list", async () => {
      await expect(pricing.resolveMany([], WORKSPACE)).resolves.toEqual([]);
      expect(repository.resolveMany).not.toHaveBeenCalled();
    });
  });

  describe("pricing a list as resources", () => {
    it("renders each cell and echoes the normalised pair", async () => {
      repository.resolveMany.mockResolvedValue([row(), undefined]);

      const priced = await pricing.priceModels(
        [
          { connectionKind: "Anthropic", modelId: "claude-fable-5" },
          { connectionKind: null, modelId: "gpt-5.2-preview" },
        ],
        WORKSPACE,
      );

      expect(priced[0]).toMatchObject({ connectionKind: "anthropic", display: "$10 · $50" });
      expect(priced[1]).toMatchObject({ price: null, display: UNPRICED });
    });
  });

  describe("listing corrections", () => {
    it("pages them per the convention, with the defaults filled in", async () => {
      repository.listOverrides.mockResolvedValue({ rows: [], total: 0 });

      expect(await pricing.listOverrides(WORKSPACE, {})).toEqual({
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      });
      expect(repository.listOverrides).toHaveBeenCalledWith(WORKSPACE, { limit: 25, offset: 0 });
    });

    it("renders each correction's cell", async () => {
      repository.listOverrides.mockResolvedValue({
        rows: [
          row({
            organization_id: WORKSPACE,
            source: "override",
            catalog_version: null,
            input_cents_per_1m: "1200.0000",
            output_cents_per_1m: "6000.0000",
          }),
        ],
        total: 1,
      });

      const page = await pricing.listOverrides(WORKSPACE, {});

      expect(page.items[0].display).toBe("$12 · $60");
    });
  });

  describe("saving a correction", () => {
    beforeEach(() => {
      repository.upsertOverride.mockResolvedValue(
        row({
          organization_id: WORKSPACE,
          source: "override",
          catalog_version: null,
          input_cents_per_1m: "1200.0000",
          output_cents_per_1m: "6000.0000",
        }),
      );
    });

    it("normalises the pair the same way a lookup does", async () => {
      // Otherwise a correction written as `Anthropic` would be a second row shadowing the one
      // every read looks for — and V012 would refuse it outright, because the column is folded.
      await pricing.saveOverride(WORKSPACE, CORRECTION);

      expect(repository.upsertOverride).toHaveBeenCalledWith(
        WORKSPACE,
        "anthropic",
        "claude-fable-5",
        "token",
        { inputCentsPer1m: 1200, outputCentsPer1m: 6000 },
      );
    });

    it("sends nulls for a mode that carries no rate", async () => {
      await pricing.saveOverride(WORKSPACE, {
        connectionKind: "copilot",
        modelId: "*",
        billingMode: "seat",
      });

      expect(repository.upsertOverride).toHaveBeenCalledWith(WORKSPACE, "copilot", "*", "seat", {
        inputCentsPer1m: null,
        outputCentsPer1m: null,
      });
    });

    it("answers with the row that was stored, cell included", async () => {
      const saved = await pricing.saveOverride(WORKSPACE, CORRECTION);

      expect(saved).toMatchObject({
        connectionKind: "anthropic",
        modelId: "claude-fable-5",
        inputCentsPer1m: 1200,
        display: "$12 · $60",
      });
    });

    it("drops what this workspace had remembered, so no read can answer with the old price", async () => {
      // The ticket's *cache invalidation on an override write is immediate*. Asserted through a
      // second resolve rather than by inspecting the cache: what matters is that the next
      // question reaches the database, not that a map is empty.
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      await pricing.saveOverride(WORKSPACE, CORRECTION);
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(2);
    });

    it("drops what the workspace knew about *other* models too", async () => {
      // Because a correction may be a family row, which changes the answer for models it never
      // mentions. A per-key drop would leave exactly those stale.
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("openai_compatible", "llama-4-maverick", WORKSPACE);

      await pricing.saveOverride(WORKSPACE, {
        connectionKind: "openai_compatible",
        modelId: "*",
        billingMode: "free",
      });
      await pricing.resolve("openai_compatible", "llama-4-maverick", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(2);
    });

    it("leaves another workspace's memory alone", async () => {
      // An override is one workspace's statement about its own invoice and cannot change what
      // another one pays.
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("anthropic", "claude-fable-5", "another-workspace");

      await pricing.saveOverride(WORKSPACE, CORRECTION);
      await pricing.resolve("anthropic", "claude-fable-5", "another-workspace");

      expect(repository.resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe("withdrawing a correction", () => {
    it("removes the normalised pair", async () => {
      repository.deleteOverride.mockResolvedValue(row({ source: "override" }));

      await pricing.removeOverride(WORKSPACE, {
        connectionKind: "Anthropic",
        modelId: " claude-fable-5 ",
      });

      expect(repository.deleteOverride).toHaveBeenCalledWith(
        WORKSPACE,
        "anthropic",
        "claude-fable-5",
      );
    });

    it("refuses when there was no correction to withdraw", async () => {
      // Not a silent success: a client that believed it had removed one needs to learn that the
      // price it is now looking at was already the catalog's.
      repository.deleteOverride.mockResolvedValue(undefined);

      await expect(
        pricing.removeOverride(WORKSPACE, {
          connectionKind: "anthropic",
          modelId: "claude-fable-5",
        }),
      ).rejects.toMatchObject({ code: PRICING_ERRORS.overrideNotFound });
    });

    it("echoes the folded kind, so a client can see what was looked for", async () => {
      repository.deleteOverride.mockResolvedValue(undefined);

      await expect(
        pricing.removeOverride(WORKSPACE, {
          connectionKind: "Anthropic",
          modelId: "claude-fable-5",
        }),
      ).rejects.toMatchObject({
        details: { connectionKind: "anthropic", modelId: "claude-fable-5" },
      });
    });

    it("drops the workspace's memory after a successful withdrawal", async () => {
      repository.resolve.mockResolvedValue(row());
      repository.deleteOverride.mockResolvedValue(row({ source: "override" }));
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      await pricing.removeOverride(WORKSPACE, {
        connectionKind: "anthropic",
        modelId: "claude-fable-5",
      });
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(2);
    });

    it("drops nothing when the withdrawal was refused", async () => {
      // Nothing changed, so nothing has to be re-read. Invalidating anyway would be harmless
      // and would also make the assertion above meaningless.
      repository.resolve.mockResolvedValue(row());
      repository.deleteOverride.mockResolvedValue(undefined);
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      await expect(
        pricing.removeOverride(WORKSPACE, {
          connectionKind: "anthropic",
          modelId: "claude-fable-5",
        }),
      ).rejects.toBeDefined();
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);

      expect(repository.resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe("the catalog-import seam", () => {
    it("forgets every workspace's prices", async () => {
      // Nothing in this process calls it — the import is a Flyway migration in another
      // container — and it is a real binding rather than a comment, so #598 replaces an
      // implementation rather than writing one.
      repository.resolve.mockResolvedValue(row());
      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);
      await pricing.resolve("anthropic", "claude-fable-5", "another-workspace");

      expect(pricing.invalidateCatalog()).toBe(2);

      await pricing.resolve("anthropic", "claude-fable-5", WORKSPACE);
      expect(repository.resolve).toHaveBeenCalledTimes(3);
    });
  });
});
