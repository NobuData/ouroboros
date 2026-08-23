import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { ModelPrice } from "../db/schema";
import { PricingRepository } from "./pricing.repository";

/**
 * The five statements, and the properties a price rests on.
 *
 * This layer holds no rules — it holds statements — which is exactly why mocking a *method*
 * would prove nothing here. `expect(repository.resolve).toHaveBeenCalled()` says nothing about
 * whether the SQL went through `ouroboros.model_price()` or re-implemented its precedence in a
 * `where` clause, and *the precedence lives in one place* is what keeps this service's numbers
 * and DASH-J.4's the same numbers. So these run against a real Kysely over a recording driver:
 * the compiler is real, the SQL asserted is the SQL PostgreSQL would receive, and nothing is
 * sent.
 *
 * Whether the server accepts these statements and answers correctly is
 * `pricing.integration-spec.ts`'s question, against the catalog the migrations really ship.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** One row, as the lookup would hand it back. Its contents are not this suite's subject. */
const ROW = {
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
} satisfies ModelPrice;

/** The all-null row a `left join lateral` produces for a pair nothing matched. */
const UNMATCHED = Object.fromEntries(
  Object.keys(ROW).map((column) => [column, null]),
) as unknown as ModelPrice;

describe("the pricing repository", () => {
  let database: RecordingDatabase;
  let prices: PricingRepository;

  beforeEach(() => {
    database = recordingDatabase();
    prices = new PricingRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every statement this repository can issue, as a callable.
     *
     * Enumerated rather than sampled: a method added without a workspace predicate is a method
     * that would show one workspace another's negotiated rate, and it should fail this suite on
     * the day it is written.
     */
    const everyStatement: readonly [string, (repository: PricingRepository) => Promise<unknown>][] =
      [
        ["resolve", (repository) => repository.resolve(WORKSPACE, "anthropic", "claude-fable-5")],
        [
          "resolveMany",
          (repository) =>
            repository.resolveMany(WORKSPACE, [
              { connectionKind: "anthropic", modelId: "claude-fable-5" },
            ]),
        ],
        [
          "listOverrides",
          (repository) => repository.listOverrides(WORKSPACE, { limit: 25, offset: 0 }),
        ],
        [
          "upsertOverride",
          (repository) =>
            repository.upsertOverride(WORKSPACE, "anthropic", "claude-fable-5", "token", {
              inputCentsPer1m: 1200,
              outputCentsPer1m: 6000,
            }),
        ],
        [
          "deleteOverride",
          (repository) => repository.deleteOverride(WORKSPACE, "anthropic", "claude-fable-5"),
        ],
      ];

    it.each(everyStatement)("carries the workspace into %s, by parameter", async (_name, issue) => {
      database.answers({ rows: [ROW] }, { rows: [ROW] });

      await issue(prices);

      for (const statement of database.statements) {
        expect(statement.parameters).toContain(WORKSPACE);
      }
    });
  });

  describe("resolving one model", () => {
    it("asks the database's own lookup function, rather than re-deriving its precedence", async () => {
      // The one assertion that keeps four tickets reading the same numbers. A `select … from
      // model_prices where … order by …` here would pass every behavioural test in this module
      // and be a second implementation of the rule the moment either copy was edited.
      database.answers({ rows: [ROW] });

      await prices.resolve(WORKSPACE, "anthropic", "claude-fable-5");

      expect(database.statements[0].sql).toContain('"ouroboros".model_price');
      expect(database.statements[0].sql).not.toContain("order by");
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "anthropic", "claude-fable-5"]);
    });

    it("answers with the row the function chose", async () => {
      database.answers({ rows: [ROW] });

      expect(await prices.resolve(WORKSPACE, "anthropic", "claude-fable-5")).toEqual(ROW);
    });

    it("answers undefined when the function returned nothing", async () => {
      // Zero rows is the honest answer for a model the catalog does not cover, and it is the
      // one the `—` cell is rendered from. Never a zeroed row.
      database.answers({ rows: [] });

      expect(await prices.resolve(WORKSPACE, "anthropic", "gpt-5.2-preview")).toBeUndefined();
    });

    it("passes a null provider kind through as null", async () => {
      // The unbound alias. `null = any (array[null, '*'])` is null in SQL, so this resolves to
      // nothing by construction — and coercing it to a string here would look up a kind called
      // `"null"` instead.
      database.answers({ rows: [] });

      await prices.resolve(WORKSPACE, null, "gpt-5.2-preview");

      expect(database.statements[0].parameters).toEqual([WORKSPACE, null, "gpt-5.2-preview"]);
    });
  });

  describe("resolving a list", () => {
    it("issues exactly one statement for eight models", async () => {
      // The ticket's *one query rather than eight*, asserted where it can actually break.
      const models = [
        { connectionKind: "anthropic", modelId: "claude-fable-5" },
        { connectionKind: "anthropic", modelId: "claude-sonnet-5" },
        { connectionKind: "anthropic", modelId: "claude-haiku-4-5" },
        { connectionKind: "copilot", modelId: "gpt-5-codex" },
        { connectionKind: "cursor", modelId: "composer-2" },
        { connectionKind: "ollama", modelId: "qwen3-coder:32b" },
        { connectionKind: "openai_compatible", modelId: "llama-4-maverick" },
        { connectionKind: null, modelId: "gpt-5.2-preview" },
      ];
      database.answers({ rows: models.map(() => ROW) });

      await prices.resolveMany(WORKSPACE, models);

      expect(database.statements).toHaveLength(1);
    });

    it("sends the pairs as two arrays and joins the lookup laterally", async () => {
      database.answers({ rows: [ROW, ROW] });

      await prices.resolveMany(WORKSPACE, [
        { connectionKind: "anthropic", modelId: "claude-fable-5" },
        { connectionKind: null, modelId: "gpt-5.2-preview" },
      ]);

      const [statement] = database.statements;
      expect(statement.sql).toContain("unnest");
      expect(statement.sql).toContain("with ordinality");
      expect(statement.sql).toContain("left join lateral");
      expect(statement.sql).toContain('"ouroboros".model_price');
      expect(statement.parameters).toEqual([
        ["anthropic", null],
        ["claude-fable-5", "gpt-5.2-preview"],
        WORKSPACE,
      ]);
    });

    it("orders by the ordinality it asked for, so the answers line up with the request", async () => {
      database.answers({ rows: [ROW] });

      await prices.resolveMany(WORKSPACE, [
        { connectionKind: "anthropic", modelId: "claude-fable-5" },
      ]);

      expect(database.statements[0].sql).toContain("order by asked.ordinality");
    });

    it("reads a left-join filler row as no price rather than as data", async () => {
      // `left join lateral` keeps an uncovered pair in its place as a row of nulls. Reading
      // that as a row would hand the caller a price whose every field is null; reading it as
      // absence is the `—` cell.
      database.answers({ rows: [ROW, UNMATCHED] });

      expect(
        await prices.resolveMany(WORKSPACE, [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: null, modelId: "gpt-5.2-preview" },
        ]),
      ).toEqual([ROW, undefined]);
    });

    it("issues nothing at all for an empty list", async () => {
      expect(await prices.resolveMany(WORKSPACE, [])).toEqual([]);
      expect(database.statements).toEqual([]);
    });

    it("refuses an answer of a different length than the question", async () => {
      // Unreachable through a left join, and the failure it guards against is the worst one
      // available here: every price after the divergence attributed to the wrong model.
      database.answers({ rows: [ROW] });

      await expect(
        prices.resolveMany(WORKSPACE, [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: "anthropic", modelId: "claude-sonnet-5" },
        ]),
      ).rejects.toThrow(/asked for 2 models and was answered with 1 rows/);
    });
  });

  describe("listing this workspace's overrides", () => {
    it("reads only override rows, windowed and ordered by the lookup key", async () => {
      database.answers({ rows: [ROW] }, { rows: [{ total: 1 }] });

      expect(await prices.listOverrides(WORKSPACE, { limit: 25, offset: 0 })).toEqual({
        rows: [ROW],
        total: 1,
      });

      const [listed] = database.statements;
      expect(listed.sql).toContain('from "ouroboros"."model_prices"');
      expect(listed.sql).toContain('where "organization_id" = $1 and "source" = $2');
      expect(listed.sql).toContain('order by "match_provider_kind" asc, "match_model" asc');
      expect(listed.parameters).toEqual([WORKSPACE, "override", 25, 0]);
    });

    it("counts the total the pagination convention publishes", async () => {
      database.answers({ rows: [] }, { rows: [{ total: 7 }] });

      const { total } = await prices.listOverrides(WORKSPACE, { limit: 25, offset: 0 });

      expect(total).toBe(7);
      expect(database.sql().some((sql) => sql.includes("count(*)::int"))).toBe(true);
    });
  });

  describe("writing an override", () => {
    it("upserts on the key the unique constraint names, and always as an override", async () => {
      // One statement rather than read-then-write: the unique key arbitrates two racing
      // administrators, and "correct this price" is the same request whether it is the first
      // correction or the fortieth.
      database.answers({ rows: [ROW] });

      await prices.upsertOverride(WORKSPACE, "anthropic", "claude-fable-5", "token", {
        inputCentsPer1m: 1200,
        outputCentsPer1m: 6000,
      });

      const [statement] = database.statements;
      expect(statement.sql).toContain('insert into "ouroboros"."model_prices"');
      expect(statement.sql).toContain(
        'on conflict ("organization_id", "match_provider_kind", "match_model", "source") do update set',
      );
      expect(statement.parameters).toContain("override");
    });

    it("sends the amounts as the numeric column's text, not as floats", async () => {
      database.answers({ rows: [ROW] });

      await prices.upsertOverride(WORKSPACE, "anthropic", "claude-fable-5", "token", {
        inputCentsPer1m: 1200.5,
        outputCentsPer1m: 6000,
      });

      expect(database.statements[0].parameters).toContain("1200.5");
      expect(database.statements[0].parameters).not.toContain(1200.5);
    });

    it("sends a null for a mode that carries no rate", async () => {
      database.answers({ rows: [ROW] });

      await prices.upsertOverride(WORKSPACE, "copilot", "*", "seat", {
        inputCentsPer1m: null,
        outputCentsPer1m: null,
      });

      expect(database.statements[0].parameters).toContain(null);
    });

    it("moves effective_at to the server clock on an update", async () => {
      // A corrected rate that kept the superseded rate's start date would be a row claiming
      // this price has applied since a date on which it did not. `now()` rather than a value
      // from this process, because the server clock is the one the row's other stamps use.
      database.answers({ rows: [ROW] });

      await prices.upsertOverride(WORKSPACE, "anthropic", "claude-fable-5", "token", {
        inputCentsPer1m: 1200,
        outputCentsPer1m: 6000,
      });

      expect(database.statements[0].sql).toContain('"effective_at" = now()');
    });

    it("never names catalog_version, updated_at or meta", async () => {
      // `catalog_version` must be null on an override — V012 requires it, because an override
      // is not a version of anything. `updated_at` is the trigger's. `meta` is the catalog's:
      // a workspace correcting a rate is not thereby claiming a context window.
      database.answers({ rows: [ROW] });

      await prices.upsertOverride(WORKSPACE, "anthropic", "claude-fable-5", "token", {
        inputCentsPer1m: 1200,
        outputCentsPer1m: 6000,
      });

      expect(database.statements[0].sql).not.toContain("catalog_version");
      expect(database.statements[0].sql).not.toContain("updated_at");
      expect(database.statements[0].sql).not.toContain("meta");
    });
  });

  describe("removing an override", () => {
    it("deletes only this workspace's override for the pair", async () => {
      // The `source` predicate is belt and braces on a path where `organization_id` is never
      // null anyway — and it is what makes "this service cannot delete a bundled row" a clause
      // a reader can see rather than a consequence they have to work out.
      database.answers({ rows: [ROW] });

      await prices.deleteOverride(WORKSPACE, "anthropic", "claude-fable-5");

      const [statement] = database.statements;
      expect(statement.sql).toContain('delete from "ouroboros"."model_prices"');
      expect(statement.parameters).toEqual([WORKSPACE, "override", "anthropic", "claude-fable-5"]);
    });

    it("answers undefined when there was nothing to remove", async () => {
      database.answers({ rows: [] });

      expect(await prices.deleteOverride(WORKSPACE, "anthropic", "claude-fable-5")).toBeUndefined();
    });
  });
});
