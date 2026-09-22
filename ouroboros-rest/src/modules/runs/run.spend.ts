/**
 * What one run has spent — the one statement both sides of the run surface sum `token_usage`
 * with.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) answers a resources report with
 * these totals, and AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)) draws the
 * Resources card from them. Decision **R8** is that no number exists twice, and two hand-written
 * copies of *"sum this run's ledger"* would be two places for the unpriced rule to drift apart —
 * so the statement lives here, as a function over whichever handle the caller holds, and both
 * call it.
 *
 * **Unpriced is not free.** `costCents` is `null` when *every* attributed row is unpriced (and
 * when there are no rows at all) — decisions **M7** and **N10**'s count-only case — rather than
 * `"0"`, which would say the run cost nothing about a run whose model simply has no price in the
 * catalog. `unpricedEvents` is what makes a partial sum legible: a non-null cost with unpriced
 * rows beside it is a lower bound, and the caller is told how many rows it is missing.
 */

import { sql, type Kysely, type Transaction } from "kysely";

import type { Database } from "../db/schema";

/** A connection or a transaction — always the caller's. */
export type SpendReader = Kysely<Database> | Transaction<Database>;

/** What one run has spent. */
export interface SpendTotals {
  /** Prompt tokens. */
  readonly tokensIn: number;
  /** Completion tokens. */
  readonly tokensOut: number;
  /** Cost in cents as a decimal string, or `null` when every attributed row is unpriced. */
  readonly costCents: string | null;
  /** How many attributed rows carry no price. */
  readonly unpricedEvents: number;
}

/**
 * Sum one run's ledger.
 *
 * @param reader - The connection or transaction to read through.
 * @param run - `runs.id`. The caller has already established that the run is one it may read.
 * @returns The two token sums, the cost as a decimal string (`null` per the rule above), and how
 *   many attributed rows carry no price.
 */
export async function readSpendTotals(reader: SpendReader, run: string): Promise<SpendTotals> {
  const row = await reader
    .selectFrom("token_usage")
    .select([
      sql<string>`coalesce(sum(tokens_in), 0)`.as("tokens_in"),
      sql<string>`coalesce(sum(tokens_out), 0)`.as("tokens_out"),
      sql<string | null>`sum(cost_cents)`.as("cost_cents"),
      sql<string>`count(*) filter (where cost_cents is null)`.as("unpriced"),
    ])
    .where("run_id", "=", run)
    .executeTakeFirstOrThrow();

  return {
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    costCents: row.cost_cents,
    unpricedEvents: Number(row.unpriced),
  };
}
