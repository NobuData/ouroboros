import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { FREE, SEAT_BASED, UNPRICED, USAGE_BASED, renderPrice, type ModelKey } from "./price";
import { PricingService } from "./pricing.service";
import type { PriceOverrideResource } from "./resources";

/**
 * The pricing service against a migrated database, and against the catalog the migrations
 * really ship ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * The unit suites run the same rules over hand-written rows, and that is exactly what makes
 * this one necessary: a hand-written row is written to the rules its author believes V012 has.
 * Four things can only be asserted here, and each of them is a claim the product makes to a
 * user reading mockup 21:
 *
 *   * **The eight aliases render what the mockup draws** — resolved through the *shipped*
 *     snapshot, so a catalog bump that moved a price fails here rather than in production.
 *   * **The precedence is real.** An override beats a bundled row through
 *     `ouroboros.model_price()`, and the four-way `order by` in that function is what decides
 *     it — not a `Map` in a spec.
 *   * **`—` and `$0` stay apart against a real lookup**, where the difference is zero rows
 *     versus one, and no `?? 0` anywhere can blur them.
 *   * **A save is visible immediately**, through the whole pipeline: the HTTP write, the cache
 *     drop, and the next resolution.
 *
 * ---------------------------------------------------------------------------
 * **This suite reaches into the injector**, which integration suites are warned off doing, and
 * for `vault.integration-spec.ts`'s reason: there is no route that resolves a price and there
 * deliberately never will be one here. Resolution is served internally to CH.5's registry table
 * (#588) and to the accounting tickets (#92, #198, #210), so the injector is the only door to
 * the half of this ticket that is not the override CRUD. The CRUD itself is exercised over a
 * socket, as everything with a route is.
 *
 * **The bundled catalog is re-imported after each truncation.** `ApiHarness.truncate()` empties
 * every table the migrations created, `model_prices` included, so without this every assertion
 * below would be about an empty catalog. It re-runs the committed repeatable migration verbatim
 * rather than inserting a fixture: the point of these assertions is that the *shipped* rows
 * render the mockup's cells, and a fixture would only prove that a fixture does.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test, for the half of it that has one. */
const PRICES = "/api/v1/registry/prices";

/** The repository root, from which `ouroboros-db` is a sibling of this module. */
const REPOSITORY_ROOT = join(__dirname, "..", "..", "..", "..");

/**
 * The committed catalog import, read once.
 *
 * One statement — `select ouroboros.import_model_price_catalog(version, effective_at, rows)` —
 * which is what makes re-running it here a single `query` rather than a second implementation
 * of Flyway.
 */
const CATALOG_SQL = readFileSync(
  join(REPOSITORY_ROOT, "ouroboros-db", "migrations", "R__model_price_catalog.sql"),
  "utf8",
);

/** The snapshot the committed catalog stamps every bundled row with. */
const CATALOG_VERSION = "2026-08-15+litellm.70d51a1";

/**
 * Mockup 21's eight aliases, as the pairs the registry resolves, and the cell each must render.
 *
 * **The shapes are the mockup's exactly; three of the amounts are not.** The mockup's
 * `$15 · $75`, `$3 · $15` and `$1 · $5` are illustrative figures drawn before the catalog was
 * pinned, and V012's header records the correction — `claude-fable-5` is `$10 · $50` and
 * `claude-sonnet-5` is `$2 · $10` in the snapshot that actually ships. Hard-coded here rather
 * than read back out of the catalog, deliberately: a snapshot bump that moves a price *should*
 * make somebody look at this table again.
 *
 * `llama-4-maverick` is the row that needs an override to render `$0`, and that is V012's
 * narrowing 3 rather than a gap: the OpenAI-compatible adapter fronts a vLLM on somebody's own
 * GPU *and* `api.openai.com`, so nothing at the level of a kind can tell them apart, and a
 * bundled `('openai_compatible', '*') → free` row would price every uncovered OpenAI model at
 * zero. Local-ness is a property of the connection, so the workspace says so once.
 */
const MOCKUP_ROWS: readonly {
  alias: string;
  key: ModelKey;
  cell: string;
  needsLocalOverride?: boolean;
}[] = [
  {
    alias: "coder-max",
    key: { connectionKind: "anthropic", modelId: "claude-fable-5" },
    cell: "$10 · $50",
  },
  {
    alias: "coder-std",
    key: { connectionKind: "anthropic", modelId: "claude-sonnet-5" },
    cell: "$2 · $10",
  },
  {
    alias: "sizer",
    key: { connectionKind: "anthropic", modelId: "claude-haiku-4-5" },
    cell: "$1 · $5",
  },
  {
    alias: "coder-fallback",
    key: { connectionKind: "copilot", modelId: "gpt-5-codex" },
    cell: SEAT_BASED,
  },
  {
    alias: "second-opinion",
    key: { connectionKind: "cursor", modelId: "composer-2" },
    cell: USAGE_BASED,
  },
  {
    alias: "local-docs",
    key: { connectionKind: "ollama", modelId: "qwen3-coder:32b" },
    cell: FREE,
  },
  {
    alias: "local-free",
    key: { connectionKind: "openai_compatible", modelId: "llama-4-maverick" },
    cell: FREE,
    needsLocalOverride: true,
  },
  {
    alias: "gpt5-experiments",
    key: { connectionKind: null, modelId: "gpt-5.2-preview" },
    cell: UNPRICED,
  },
];

describe("the pricing service, against a migrated database", () => {
  let api: ApiHarness;
  let pricing: PricingService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    pricing = api.nest.get(PricingService);
    await importCatalog();
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
    await importCatalog();
    // The process outlives the truncation and the cache does not know about it, which is a
    // property of the deployment rather than of the suite — a Flyway import in another
    // container is equally invisible. Dropped here so each test starts from the database.
    pricing.invalidateCatalog();
  });

  /** Re-apply the committed bundled catalog, exactly as the repeatable migration does. */
  async function importCatalog(): Promise<void> {
    await api.sql.query(CATALOG_SQL);
  }

  /** A workspace with an owner — the only fixture most of this suite needs. */
  async function workspace(): Promise<string> {
    return (await api.workspace(await api.signIn())).id;
  }

  /**
   * Record an override the way CG.4's registry seed does — through the table, not the API.
   *
   * Arranging through the API under test would make the arrangement part of what is being
   * asserted, and some of these rows are ones the role gate would refuse to a suite that has
   * not signed anybody in.
   *
   * @param organizationId - The workspace.
   * @param kind - The provider kind, folded.
   * @param model - The model identifier, or `*`.
   * @param mode - The billing mode.
   * @param input - Input rate in cents per 1M, or null.
   * @param output - Output rate in cents per 1M, or null.
   */
  async function recordOverride(
    organizationId: string,
    kind: string,
    model: string,
    mode: string,
    input: number | null = null,
    output: number | null = null,
  ): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.model_prices
         (organization_id, match_provider_kind, match_model, billing_mode,
          input_cents_per_1m, output_cents_per_1m, source)
       values ($1, $2, $3, $4, $5, $6, 'override')`,
      [organizationId, kind, model, mode, input, output],
    );
  }

  /** The workspace's override rows, straight from the table. */
  async function storedOverrides(
    organizationId: string,
  ): Promise<{ match_model: string; billing_mode: string; catalog_version: string | null }[]> {
    const { rows } = await api.sql.query<{
      match_model: string;
      billing_mode: string;
      catalog_version: string | null;
    }>(
      `select match_model, billing_mode, catalog_version
         from ouroboros.model_prices
        where organization_id = $1 and source = 'override'
        order by match_provider_kind, match_model`,
      [organizationId],
    );

    return rows;
  }

  /**
   * Run `work` while counting the statements the application's pool actually sent.
   *
   * `pg.Client.prototype.query` is what Kysely's PostgreSQL dialect calls, once per statement,
   * so counting there counts round trips rather than counting method calls in this service. The
   * suite's own pool is idle inside `work`, which is what makes the number attributable.
   *
   * @param work - What to measure.
   * @returns How many statements it sent.
   */
  async function statementsIssuedBy(work: () => Promise<unknown>): Promise<number> {
    const query = jest.spyOn(Client.prototype, "query");
    try {
      await work();
      return query.mock.calls.length;
    } finally {
      query.mockRestore();
    }
  }

  describe("the eight aliases of mockup 21", () => {
    it.each(MOCKUP_ROWS.map((row) => [row.alias, row] as const))(
      "renders %s exactly as the table draws it",
      async (_alias, expected) => {
        const organizationId = await workspace();
        if (expected.needsLocalOverride === true) {
          await recordOverride(organizationId, "openai_compatible", "*", "free");
        }

        const price = await pricing.resolve(
          expected.key.connectionKind,
          expected.key.modelId,
          organizationId,
        );

        expect(renderPrice(price)).toBe(expected.cell);
      },
    );

    it("draws the whole table in one query", async () => {
      // The ticket's *batch resolution for the eight-alias list issues one query*, counted at
      // the driver rather than inferred from a mock. A cold cache, because a warm one would
      // make the assertion true for the wrong reason.
      const organizationId = await workspace();
      const keys = MOCKUP_ROWS.map((row) => row.key);

      const statements = await statementsIssuedBy(() => pricing.resolveMany(keys, organizationId));

      expect(statements).toBe(1);
    });

    it("draws it again without asking the database at all", async () => {
      const organizationId = await workspace();
      const keys = MOCKUP_ROWS.map((row) => row.key);
      await pricing.resolveMany(keys, organizationId);

      const statements = await statementsIssuedBy(() => pricing.resolveMany(keys, organizationId));

      expect(statements).toBe(0);
    });

    it("gives the batch the same answers as eight separate lookups", async () => {
      // The lateral join has to keep every pair in its place, uncovered ones included. This is
      // the assertion that would fail if a filler row were ever dropped rather than kept — every
      // price after the gap attributed to the wrong model.
      const organizationId = await workspace();
      await recordOverride(organizationId, "openai_compatible", "*", "free");
      const keys = MOCKUP_ROWS.map((row) => row.key);

      const batched = await pricing.resolveMany(keys, organizationId);
      pricing.invalidateCatalog();
      const separately = await Promise.all(
        keys.map((key) => pricing.resolve(key.connectionKind, key.modelId, organizationId)),
      );

      expect(batched.map(renderPrice)).toEqual(MOCKUP_ROWS.map((row) => row.cell));
      expect(batched).toEqual(separately);
    });
  });

  describe("unknown and free", () => {
    it("resolves an uncovered model to nothing at all", async () => {
      // Zero rows, not a zeroed row. The whole ticket in one assertion.
      const organizationId = await workspace();

      const price = await pricing.resolve("anthropic", "claude-imaginary-9", organizationId);

      expect(price).toBeUndefined();
      expect(renderPrice(price)).toBe(UNPRICED);
    });

    it("keeps that distinguishable from a model that is genuinely free", async () => {
      // The criterion asks for this explicitly, and it is worth the explicitness: both cells
      // are "no money to show", and only one of them is a claim about the price.
      const organizationId = await workspace();

      const unknown = await pricing.resolve("anthropic", "claude-imaginary-9", organizationId);
      const free = await pricing.resolve("ollama", "qwen3-coder:32b", organizationId);

      expect(unknown).toBeUndefined();
      expect(free?.billingMode).toBe("free");
      expect(renderPrice(unknown)).not.toBe(renderPrice(free));
    });

    it("resolves an unbound alias to nothing, rather than to a kind's family row", async () => {
      // Mockup 21's `gpt5-experiments`. `null = any (array[null, '*'])` is null in SQL, so only
      // a `'*'` kind could match — and the bundled catalog ships none, deliberately.
      const organizationId = await workspace();

      await expect(pricing.resolve(null, "qwen3-coder:32b", organizationId)).resolves.toBe(
        undefined,
      );
    });

    it("prices one model differently on two provider kinds", async () => {
      // `gpt-5-codex` is in the snapshot as an OpenAI-compatible model at 125 ¢ / 1000 ¢ *and*
      // is reached through Copilot, which is seat-billed by kind. Both are true, and which one
      // is shown is decided by the connection rather than by the model's name.
      const organizationId = await workspace();

      expect(renderPrice(await pricing.resolve("copilot", "gpt-5-codex", organizationId))).toBe(
        SEAT_BASED,
      );
      expect(
        renderPrice(await pricing.resolve("openai_compatible", "gpt-5-codex", organizationId)),
      ).toBe("$1.25 · $10");
    });
  });

  describe("provenance", () => {
    it("stamps a bundled price with the snapshot it came from", async () => {
      const organizationId = await workspace();

      const price = await pricing.resolve("anthropic", "claude-fable-5", organizationId);

      expect(price?.provenance).toMatchObject({
        source: "bundled",
        catalogVersion: CATALOG_VERSION,
      });
      expect(price?.provenance.effectiveAt).toBeInstanceOf(Date);
    });

    it("carries provenance on every one of the seven priced aliases", async () => {
      // *A price with no provenance is a bug*, over the whole table rather than over the one row
      // a spec would naturally reach for.
      const organizationId = await workspace();
      await recordOverride(organizationId, "openai_compatible", "*", "free");

      const prices = await pricing.resolveMany(
        MOCKUP_ROWS.map((row) => row.key),
        organizationId,
      );

      const priced = prices.filter((price) => price !== undefined);
      expect(priced).toHaveLength(7);
      for (const price of priced) {
        expect(price?.provenance.source).toMatch(/^(bundled|override)$/);
        expect(price?.provenance.effectiveAt).toBeInstanceOf(Date);
      }
    });
  });

  describe("an override beating the catalog", () => {
    it("wins for the same pair, and says so", async () => {
      const organizationId = await workspace();
      await recordOverride(organizationId, "anthropic", "claude-fable-5", "token", 1200, 6000);

      const price = await pricing.resolve("anthropic", "claude-fable-5", organizationId);

      expect(renderPrice(price)).toBe("$12 · $60");
      expect(price?.provenance.source).toBe("override");
      expect(price?.provenance.catalogVersion).toBeNull();
    });

    it("wins as a family row over a bundled exact row", async () => {
      // The specific statement about the general case beats the general statement about the
      // specific case, because only one of the two parties has seen the bill. It is V012's
      // precedence rule, and it is the reason the `order by` puts `organization_id is not null`
      // first rather than sorting by how specific the match was.
      const organizationId = await workspace();
      await recordOverride(organizationId, "anthropic", "*", "free");

      const price = await pricing.resolve("anthropic", "claude-fable-5", organizationId);

      expect(renderPrice(price)).toBe(FREE);
      expect(price?.provenance.source).toBe("override");
    });

    it("changes nothing for another workspace", async () => {
      const organizationId = await workspace();
      const elsewhere = await workspace();
      await recordOverride(organizationId, "anthropic", "claude-fable-5", "token", 1200, 6000);

      expect(renderPrice(await pricing.resolve("anthropic", "claude-fable-5", elsewhere))).toBe(
        "$10 · $50",
      );
    });

    it("can price a model the catalog does not cover at all", async () => {
      // Which is the other half of what an override is for: not only correcting a number, but
      // stating one where the snapshot has nothing to say.
      const organizationId = await workspace();
      await recordOverride(organizationId, "anthropic", "claude-imaginary-9", "token", 50, 250);

      expect(
        renderPrice(await pricing.resolve("anthropic", "claude-imaginary-9", organizationId)),
      ).toBe("$0.5 · $2.5");
    });
  });

  describe("the override endpoints", () => {
    describe("who may ask", () => {
      it("refuses a stranger", async () => {
        await api.anonymous("get", PRICES).expect(401);
        await api.anonymous("put", PRICES).expect(401);
        await api.anonymous("delete", PRICES).expect(401);
      });

      it("asks a session acting in no workspace to choose one", async () => {
        const nomad = await api.signIn();

        const response = await api.as(nomad)("get", PRICES).expect(400);

        expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
      });
    });

    describe("the role matrix", () => {
      it("lets every role read, including the one that exists to look", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const viewer = await api.signIn();
        await api.join(space.id, viewer, "viewer");

        const page = bodyOf<Page<PriceOverrideResource>>(
          await api.as(viewer)("get", PRICES).set(TENANT_HEADER, space.slug).expect(200),
        );

        expect(page.items).toEqual([]);
      });

      it("refuses a member's correction with the API's one 403, and does not write", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const member = await api.signIn();
        await api.join(space.id, member, "member");

        const response = await api
          .as(member)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "anthropic",
            modelId: "claude-fable-5",
            billingMode: "token",
            inputCentsPer1m: 1200,
            outputCentsPer1m: 6000,
          })
          .expect(403);

        const envelope = bodyOf<ErrorEnvelope>(response);
        expect(envelope.code).toBe("forbidden");
        expect(envelope.details).toEqual({ role: "member", required: [...ADMINISTRATORS] });
        expect(await storedOverrides(space.id)).toEqual([]);
      });

      it("refuses a viewer's withdrawal the same way", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const viewer = await api.signIn();
        await api.join(space.id, viewer, "viewer");
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);

        await api
          .as(viewer)("delete", PRICES)
          .set(TENANT_HEADER, space.slug)
          .query({ connectionKind: "anthropic", modelId: "claude-fable-5" })
          .expect(403);

        expect(await storedOverrides(space.id)).toHaveLength(1);
      });

      it("persists an admin's correction, not only an owner's", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const admin = await api.signIn();
        await api.join(space.id, admin, "admin");

        const saved = bodyOf<PriceOverrideResource>(
          await api
            .as(admin)("put", PRICES)
            .set(TENANT_HEADER, space.slug)
            .send({
              connectionKind: "anthropic",
              modelId: "claude-fable-5",
              billingMode: "token",
              inputCentsPer1m: 1200,
              outputCentsPer1m: 6000,
            })
            .expect(200),
        );

        expect(saved.display).toBe("$12 · $60");
      });
    });

    describe("recording a correction", () => {
      it("writes an override row, never a bundled one", async () => {
        // Structurally, rather than by care: every row this service writes carries a workspace
        // and `source = 'override'`, and V012's coherence CHECK requires the two to agree. A
        // `catalog_version` here would be this service claiming to be a snapshot.
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "anthropic",
            modelId: "claude-fable-5",
            billingMode: "token",
            inputCentsPer1m: 1200,
            outputCentsPer1m: 6000,
          })
          .expect(200);

        expect(await storedOverrides(space.id)).toEqual([
          { match_model: "claude-fable-5", billing_mode: "token", catalog_version: null },
        ]);
      });

      it("leaves the bundled catalog untouched", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "anthropic",
            modelId: "claude-fable-5",
            billingMode: "token",
            inputCentsPer1m: 1200,
            outputCentsPer1m: 6000,
          })
          .expect(200);

        const { rows } = await api.sql.query<{ count: string }>(
          `select count(*) as count from ouroboros.model_prices where source = 'bundled'`,
        );
        expect(Number(rows[0].count)).toBe(129);
      });

      it("folds the provider kind, so one kind is one row", async () => {
        // A second row spelled `Anthropic` would shadow nothing and be found by nothing — and
        // V012 would refuse it outright, because the column is folded. The service folding first
        // is what turns that into an accepted request.
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        for (const connectionKind of ["Anthropic", "anthropic"]) {
          await api
            .as(owner)("put", PRICES)
            .set(TENANT_HEADER, space.slug)
            .send({
              connectionKind,
              modelId: "claude-fable-5",
              billingMode: "token",
              inputCentsPer1m: 1200,
              outputCentsPer1m: 6000,
            })
            .expect(200);
        }

        expect(await storedOverrides(space.id)).toHaveLength(1);
      });

      it("is idempotent: the same correction twice leaves one row", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const body = {
          connectionKind: "openai_compatible",
          modelId: "*",
          billingMode: "free",
        };

        await api.as(owner)("put", PRICES).set(TENANT_HEADER, space.slug).send(body).expect(200);
        const second = bodyOf<PriceOverrideResource>(
          await api.as(owner)("put", PRICES).set(TENANT_HEADER, space.slug).send(body).expect(200),
        );

        expect(second.display).toBe(FREE);
        expect(await storedOverrides(space.id)).toHaveLength(1);
      });

      it("is visible to the very next resolution — no stale price survives a save", async () => {
        // The ticket's *cache invalidation on an override write is immediate*, through the whole
        // pipeline: a read that warmed the cache, an HTTP write, and a read that must not answer
        // from what it remembered.
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        expect(renderPrice(await pricing.resolve("anthropic", "claude-fable-5", space.id))).toBe(
          "$10 · $50",
        );

        await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "anthropic",
            modelId: "claude-fable-5",
            billingMode: "token",
            inputCentsPer1m: 1200,
            outputCentsPer1m: 6000,
          })
          .expect(200);

        expect(renderPrice(await pricing.resolve("anthropic", "claude-fable-5", space.id))).toBe(
          "$12 · $60",
        );
      });

      it("drops a family row's neighbours too", async () => {
        // The failure a per-key invalidation would leave: `('openai_compatible', '*') → free`
        // changes what `llama-4-maverick` costs without ever naming it.
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        expect(
          renderPrice(await pricing.resolve("openai_compatible", "llama-4-maverick", space.id)),
        ).toBe(UNPRICED);

        await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({ connectionKind: "openai_compatible", modelId: "*", billingMode: "free" })
          .expect(200);

        expect(
          renderPrice(await pricing.resolve("openai_compatible", "llama-4-maverick", space.id)),
        ).toBe(FREE);
      });

      it("refuses a rate the billing mode cannot carry, naming the field", async () => {
        // V012 would refuse it too. What is asserted is that the person who typed it is told
        // which field was wrong rather than being handed the service's own failure.
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        const response = await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "copilot",
            modelId: "*",
            billingMode: "seat",
            inputCentsPer1m: 1200,
          })
          .expect(422);

        const envelope = bodyOf<ErrorEnvelope>(response);
        expect(envelope.code).toBe("validation_failed");
        expect(Object.keys(envelope.details)).toContain("inputCentsPer1m");
        expect(await storedOverrides(space.id)).toEqual([]);
      });

      it("refuses a token price of nothing in both directions", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        const response = await api
          .as(owner)("put", PRICES)
          .set(TENANT_HEADER, space.slug)
          .send({
            connectionKind: "anthropic",
            modelId: "claude-fable-5",
            billingMode: "token",
            inputCentsPer1m: 0,
            outputCentsPer1m: 0,
          })
          .expect(422);

        expect(Object.keys(bodyOf<ErrorEnvelope>(response).details)).toContain("billingMode");
        expect(await storedOverrides(space.id)).toEqual([]);
      });

      it("stores a rate at the column's four decimal places, unrounded", async () => {
        // The reason the column is `numeric(14, 4)` and the reason the amounts cross this
        // service as strings: a rate below a whole cent per 1M is a real number and must survive
        // the round trip as one.
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        const saved = bodyOf<PriceOverrideResource>(
          await api
            .as(owner)("put", PRICES)
            .set(TENANT_HEADER, space.slug)
            .send({
              connectionKind: "ollama",
              modelId: "tiny-local",
              billingMode: "token",
              inputCentsPer1m: 0.0001,
              outputCentsPer1m: 0.0002,
            })
            .expect(200),
        );

        expect(saved.inputCentsPer1m).toBe(0.0001);
        expect(saved.display).toBe("$0.000001 · $0.000002");
      });
    });

    describe("listing corrections", () => {
      it("lists this workspace's overrides and no bundled row", async () => {
        // 129 bundled rows are in the table throughout, and none of them belongs in an answer to
        // *what have we changed*.
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);
        await recordOverride(space.id, "openai_compatible", "*", "free");

        const page = bodyOf<Page<PriceOverrideResource>>(
          await api.as(owner)("get", PRICES).set(TENANT_HEADER, space.slug).expect(200),
        );

        expect(page.total).toBe(2);
        expect(page.items.map((item) => item.modelId)).toEqual(["claude-fable-5", "*"]);
        expect(page.items.map((item) => item.display)).toEqual(["$12 · $60", FREE]);
      });

      it("never lists another workspace's corrections", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const other = await api.signIn();
        const elsewhere = await api.workspace(other);
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);

        const page = bodyOf<Page<PriceOverrideResource>>(
          await api.as(other)("get", PRICES).set(TENANT_HEADER, elsewhere.slug).expect(200),
        );

        expect(page).toMatchObject({ items: [], total: 0 });
      });

      it("pages per the convention", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);
        await recordOverride(space.id, "anthropic", "claude-sonnet-5", "token", 100, 500);

        const page = bodyOf<Page<PriceOverrideResource>>(
          await api
            .as(owner)("get", PRICES)
            .set(TENANT_HEADER, space.slug)
            .query({ limit: 1, offset: 1 })
            .expect(200),
        );

        expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
        expect(page.items.map((item) => item.modelId)).toEqual(["claude-sonnet-5"]);
      });
    });

    describe("withdrawing a correction", () => {
      it("removes it and answers 204, and the catalog answers again", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);

        await api
          .as(owner)("delete", PRICES)
          .set(TENANT_HEADER, space.slug)
          .query({ connectionKind: "anthropic", modelId: "claude-fable-5" })
          .expect(204);

        expect(await storedOverrides(space.id)).toEqual([]);
        expect(renderPrice(await pricing.resolve("anthropic", "claude-fable-5", space.id))).toBe(
          "$10 · $50",
        );
      });

      it("leaves a model the catalog does not cover reading — rather than $0", async () => {
        // Withdrawing a correction is not pricing a model at nothing. This is the assertion that
        // would fail if the delete had been implemented as a write of zeros.
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        await recordOverride(space.id, "openai_compatible", "*", "free");

        await api
          .as(owner)("delete", PRICES)
          .set(TENANT_HEADER, space.slug)
          .query({ connectionKind: "openai_compatible", modelId: "*" })
          .expect(204);

        expect(
          renderPrice(await pricing.resolve("openai_compatible", "llama-4-maverick", space.id)),
        ).toBe(UNPRICED);
      });

      it("answers 404 when there was no correction to withdraw", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        const response = await api
          .as(owner)("delete", PRICES)
          .set(TENANT_HEADER, space.slug)
          .query({ connectionKind: "anthropic", modelId: "claude-fable-5" })
          .expect(404);

        expect(bodyOf<ErrorEnvelope>(response).code).toBe("price_override_not_found");
      });

      it("cannot remove a bundled row, however it is addressed", async () => {
        // `claude-fable-5` is in the catalog and this workspace has not overridden it, so the
        // `404` is the honest answer *and* the catalog is untouched — the `source` predicate in
        // the statement is what makes the second half true rather than incidental.
        const owner = await api.signIn();
        const space = await api.workspace(owner);

        await api
          .as(owner)("delete", PRICES)
          .set(TENANT_HEADER, space.slug)
          .query({ connectionKind: "anthropic", modelId: "claude-fable-5" })
          .expect(404);

        expect(renderPrice(await pricing.resolve("anthropic", "claude-fable-5", space.id))).toBe(
          "$10 · $50",
        );
      });

      it("cannot remove another workspace's correction", async () => {
        const owner = await api.signIn();
        const space = await api.workspace(owner);
        const other = await api.signIn();
        const elsewhere = await api.workspace(other);
        await recordOverride(space.id, "anthropic", "claude-fable-5", "token", 1200, 6000);

        await api
          .as(other)("delete", PRICES)
          .set(TENANT_HEADER, elsewhere.slug)
          .query({ connectionKind: "anthropic", modelId: "claude-fable-5" })
          .expect(404);

        expect(await storedOverrides(space.id)).toHaveLength(1);
      });
    });
  });

  describe("the workspace cascade", () => {
    it("takes a deleted workspace's corrections with it", async () => {
      // `on delete cascade`, and the reason V012 gives for it: an override for a workspace that
      // no longer exists is unreachable, and leaving it would let a later workspace that reused
      // the id inherit somebody else's negotiated rate.
      const organizationId = await workspace();
      await recordOverride(organizationId, "anthropic", "claude-fable-5", "token", 1200, 6000);

      await api.sql.query(`delete from ouroboros.organization where "id" = $1`, [organizationId]);

      expect(await storedOverrides(organizationId)).toEqual([]);
    });
  });
});
