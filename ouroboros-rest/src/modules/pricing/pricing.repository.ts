/**
 * Every statement this module issues against `model_prices` (V012,
 * [#580](https://github.com/NobuData/ouroboros/issues/580)) — five of them, all scoped to one
 * workspace.
 *
 * ## The precedence rule is the database's, and stays there
 *
 * *Override beats bundled, exact model beats a family row, exact kind beats `'*'`* is
 * implemented once, in `ouroboros.model_price()`, and both read paths below call it rather
 * than re-deriving it in a `where` clause. That is not deference for its own sake: DASH-J.4
 * (#92), Z.5 (#198) and AB.4 (#210) are all going to price something, and three copies of a
 * four-way precedence are three sets of numbers that disagree in a report. The function is
 * `language sql stable` so PostgreSQL inlines it, which is what makes a lookup the
 * `model_prices_lookup_idx` scan rather than an opaque function scan.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement carries it — the same rule
 * `dashboard.repository.ts` states, and sharper here, because the column it scopes is the one
 * that decides whose negotiated rate is shown. The value comes from the tenant context, never
 * from anything a caller wrote.
 *
 * The two read statements pass it *into* the function, which resolves `organization_id = $1
 * or organization_id is null` — a workspace sees its own overrides and the bundled catalog,
 * and no other workspace's anything. The three write statements filter on it *and* on
 * `source = 'override'`, which is belt and braces on purpose: the source predicate is what
 * makes "this service cannot touch the bundled catalog" a clause a reader can see rather than
 * a consequence of `organization_id` never being null on this path.
 *
 * ## Amounts stay strings
 *
 * `numeric(14, 4)` arrives from `pg` as text, and nothing here narrows it. See
 * `db/schema.ts`'s note on `ModelPricesTable.input_cents_per_1m`: the conversion happens once,
 * at the contract's edge, in `resources.ts`.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type BillingMode, type ModelPrice } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import type { ModelKey } from "./price";

/** The value `source` carries on every row this service writes. Bundled rows are the import's. */
export const OVERRIDE_SOURCE = "override";

/** The amounts an override write may carry, already validated against its billing mode. */
export interface OverrideAmounts {
  /** Input rate in cents per 1M tokens, or null for a mode that has no rate. */
  readonly inputCentsPer1m: number | null;
  /** Output rate in cents per 1M tokens, or null for a mode that has no rate. */
  readonly outputCentsPer1m: number | null;
}

@Injectable()
export class PricingRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * What this workspace pays for one model — at most one row, and often none.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionKind - The provider kind, folded, or null for an unbound alias. A null
   *   resolves to nothing by construction: `null = any (array[null, '*'])` is null in SQL, so
   *   only a `'*'` kind could match and the bundled catalog ships none.
   * @param modelId - The model identifier, unfolded.
   * @returns The winning row, or `undefined` when the catalog covers nothing for the pair —
   *   which is the `—` cell and is never a zeroed row.
   */
  async resolve(
    organizationId: string,
    connectionKind: string | null,
    modelId: string,
  ): Promise<ModelPrice | undefined> {
    const { rows } = await sql<ModelPrice>`
      select *
        from ${sql.id(SCHEMA_NAME)}.model_price(${organizationId}, ${connectionKind}, ${modelId})
    `.execute(this.database.db);

    return rows[0];
  }

  /**
   * The same question for a whole alias list, in **one** statement.
   *
   * The registry table is eight rows and eight lookups, and eight round trips to answer one
   * page is the cost this exists to remove — the ticket's *one query rather than eight*.
   *
   * `unnest(…, …) with ordinality` turns the requested pairs into a relation, and
   * `left join lateral` invokes the lookup once per pair. `left` rather than an inner join is
   * the whole of the honesty here: a pair the catalog does not cover produces a row of nulls
   * and keeps its place in the result, where an inner join would silently shorten the list and
   * leave the caller zipping prices onto the wrong models.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param models - The pairs to resolve, in the order the answers are wanted. May contain
   *   duplicates; each is resolved independently.
   * @returns One entry per requested pair, in the requested order — the winning row, or
   *   `undefined` where nothing matched.
   * @throws {Error} If the server returned a different number of rows than were asked for,
   *   which cannot happen through a left join and would mean every price after the divergence
   *   was attributed to the wrong model.
   */
  async resolveMany(
    organizationId: string,
    models: readonly ModelKey[],
  ): Promise<(ModelPrice | undefined)[]> {
    if (models.length === 0) {
      return [];
    }

    const kinds = models.map((model) => model.connectionKind);
    const identifiers = models.map((model) => model.modelId);

    const { rows } = await sql<ModelPrice & { ordinality: string }>`
      select asked.ordinality, found.*
        from unnest(${kinds}::text[], ${identifiers}::text[])
             with ordinality as asked(kind, model, ordinality)
        left join lateral
             ${sql.id(SCHEMA_NAME)}.model_price(${organizationId}, asked.kind, asked.model) found
          on true
       order by asked.ordinality
    `.execute(this.database.db);

    if (rows.length !== models.length) {
      throw new Error(
        `Batch price resolution asked for ${models.length} models and was answered with ` +
          `${rows.length} rows. A left join cannot drop a row, so the statement in ` +
          "pricing.repository.ts and the function in V012__model_prices.sql have diverged.",
      );
    }

    // A pair that matched nothing is a row of nulls, and `id` is the column that says so: it is
    // `not null` on every real row, so a null there is the left join's filler rather than data.
    return rows.map((row) => (row.id === null ? undefined : row));
  }

  /**
   * One page of the prices this workspace has corrected, and how many there are.
   *
   * Overrides only — the bundled catalog is the same hundred and twenty-nine rows for
   * everybody, and a workspace asking what *it* has changed is asking about its own list.
   *
   * Two statements rather than a windowed read plus a `count(*) over ()`: the #31 pagination
   * convention counts the total on every page, and a window function would put the count on
   * every row of a payload that then has to strip it. They are issued concurrently, so the pair
   * costs one round trip's latency rather than two.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param window - The page to read, defaults already applied.
   * @returns The rows for this window, ordered by the lookup key so the listing is stable
   *   across calls and reads the way the catalog does — a kind, then its models — and the total
   *   ignoring the window.
   */
  async listOverrides(
    organizationId: string,
    window: PageWindow,
  ): Promise<{ rows: ModelPrice[]; total: number }> {
    const scoped = this.database.db
      .selectFrom("model_prices")
      .where("organization_id", "=", organizationId)
      .where("source", "=", OVERRIDE_SOURCE);

    const [rows, counted] = await Promise.all([
      scoped
        .selectAll()
        .orderBy("match_provider_kind", "asc")
        .orderBy("match_model", "asc")
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      scoped.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow(),
    ]);

    return { rows, total: counted.total };
  }

  /**
   * Record this workspace's own price for one model, replacing whatever it said before.
   *
   * An upsert rather than a read-then-write, for the reason `settings.repository.ts` gives:
   * the unique key makes the conflict target exact, "correct this price" is the same request
   * whether it is the first correction or the fortieth, and two racing administrators are
   * arbitrated by the database instead of by whichever read first.
   *
   * `effective_at` moves to the server clock on update as well as on insert. A corrected rate
   * that kept the superseded rate's start date would be a row claiming this price has applied
   * since a date on which it did not.
   *
   * `catalog_version` is never named here and is null by default, which V012 requires of an
   * override: an override is not a version of anything. `meta` is likewise left at its default
   * — a workspace correcting a rate is not thereby claiming a context window.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionKind - The provider kind, folded, or `'*'` for every kind.
   * @param modelId - The model identifier, or `'*'` for every model of the kind.
   * @param billingMode - How the money works — already validated against the amounts.
   * @param amounts - The rates, or nulls for a mode that carries none.
   * @returns The row as stored, trigger stamps included.
   */
  async upsertOverride(
    organizationId: string,
    connectionKind: string,
    modelId: string,
    billingMode: BillingMode,
    amounts: OverrideAmounts,
  ): Promise<ModelPrice> {
    return this.database.db
      .insertInto("model_prices")
      .values({
        organization_id: organizationId,
        match_provider_kind: connectionKind,
        match_model: modelId,
        billing_mode: billingMode,
        input_cents_per_1m: asNumeric(amounts.inputCentsPer1m),
        output_cents_per_1m: asNumeric(amounts.outputCentsPer1m),
        source: OVERRIDE_SOURCE,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["organization_id", "match_provider_kind", "match_model", "source"])
          .doUpdateSet({
            billing_mode: billingMode,
            input_cents_per_1m: asNumeric(amounts.inputCentsPer1m),
            output_cents_per_1m: asNumeric(amounts.outputCentsPer1m),
            effective_at: sql<Date>`now()`,
          }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Withdraw this workspace's correction, so the bundled catalog answers again.
   *
   * Deleting an override is not the same as pricing a model at nothing: the row goes, the
   * lookup falls back to the snapshot, and a model the snapshot does not cover goes back to
   * reading `—`. That is why this is a delete rather than a write of zeros.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionKind - The provider kind, folded.
   * @param modelId - The model identifier.
   * @returns The row that was removed, or `undefined` when this workspace had no override for
   *   the pair — which the service turns into a `404` rather than a silent success, because a
   *   client that thought it was withdrawing a correction should learn that it was not there.
   */
  async deleteOverride(
    organizationId: string,
    connectionKind: string,
    modelId: string,
  ): Promise<ModelPrice | undefined> {
    return this.database.db
      .deleteFrom("model_prices")
      .where("organization_id", "=", organizationId)
      .where("source", "=", OVERRIDE_SOURCE)
      .where("match_provider_kind", "=", connectionKind)
      .where("match_model", "=", modelId)
      .returningAll()
      .executeTakeFirst();
  }
}

/**
 * An amount on its way into a `numeric(14, 4)` column.
 *
 * `pg` renders a JavaScript number into the statement's text, and `numeric` parses that text —
 * so a value that reached here as a number is stored at the column's precision without a float
 * ever being involved on the server's side. The DTO is what bounds it to four decimal places
 * before it gets this far, which is the step that makes the round trip lossless rather than
 * merely usually lossless.
 *
 * @param amount - The rate, or null for a billing mode that carries none.
 * @returns The value Kysely inserts — a string, because the column's TypeScript type is the
 *   string `pg` hands a `numeric` back as, and inserting the number would be a type error that
 *   says something true about reads.
 */
function asNumeric(amount: number | null): string | null {
  return amount === null ? null : String(amount);
}
