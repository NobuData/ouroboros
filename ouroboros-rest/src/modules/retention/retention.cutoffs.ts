/**
 * A sweep's cutoffs — one instant per workspace, computed by `RetentionPolicyService` and handed to
 * the sweep (BQ.3, [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * A sweep runs across every workspace at once, and each workspace may store its own tier. Rather
 * than have each sweep join `retention_policies` and do date arithmetic in its own SQL — four
 * places a refactor could quietly change one of — the service resolves the tiers into instants and
 * the sweep's statement compares a timestamp against {@link cutoffSql}: the workspace's own cutoff
 * when it stored a tier, the default cutoff otherwise.
 */

import { sql, type RawBuilder } from "kysely";

import type { DataClass } from "./retention.policy";

/** The cutoffs one sweep of one class works to. */
export interface RetentionCutoffs {
  /** The class these are for. */
  readonly dataClass: DataClass;
  /** The cutoff for a workspace that stored no tier — `now − default days`. */
  readonly fallback: Date;
  /** The cutoff for each workspace that stored a tier for this class. */
  readonly byOrganization: ReadonlyMap<string, Date>;
}

/** A column reference a cutoff can be compared against — `alias.column` or `column`. */
const COLUMN_PATTERN = /^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/;

/**
 * The cutoff for one workspace.
 *
 * @param cutoffs - The sweep's cutoffs.
 * @param organizationId - The workspace.
 * @returns Its own cutoff, or the fallback.
 */
export function cutoffOf(cutoffs: RetentionCutoffs, organizationId: string): Date {
  return cutoffs.byOrganization.get(organizationId) ?? cutoffs.fallback;
}

/**
 * The cutoff as a SQL expression over a workspace column — a `case` with one arm per workspace
 * that stored a tier, else the fallback. Every instant is a bound parameter.
 *
 * @param cutoffs - The sweep's cutoffs.
 * @param organizationColumn - The column naming each row's workspace, e.g. `job.organization_id`.
 *   Spliced into the statement, so it must be a plain identifier; anything else throws.
 * @returns A `timestamptz` expression.
 * @throws {Error} When `organizationColumn` is not a plain column reference.
 */
export function cutoffSql(cutoffs: RetentionCutoffs, organizationColumn: string): RawBuilder<Date> {
  if (!COLUMN_PATTERN.test(organizationColumn)) {
    throw new Error(`not a column reference: ${organizationColumn}`);
  }

  const fallback = sql<Date>`${cutoffs.fallback}::timestamptz`;
  if (cutoffs.byOrganization.size === 0) return fallback;

  const arms = [...cutoffs.byOrganization].map(
    ([organizationId, cutoff]) => sql`when ${organizationId} then ${cutoff}::timestamptz`,
  );

  return sql<Date>`(case ${sql.raw(organizationColumn)} ${sql.join(arms, sql` `)} else ${fallback} end)`;
}
