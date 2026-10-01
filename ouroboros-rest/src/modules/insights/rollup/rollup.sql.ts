/**
 * SQL fragments the extractors share (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * Only the plumbing is shared — how a GitHub repository row becomes a `repo_ref`, and how a row's
 * counts arrive — never a metric's definition. Each extractor states its own population in full,
 * and the oracle twin in `rollup.oracle.fixture.ts` states it again independently; a definition
 * shared between the two would make the parity check compare a query with itself.
 */

import { sql, type RawBuilder } from "kysely";

/**
 * Join a row carrying `github_repo_id` to the repository and its owner.
 *
 * Adds the aliases `gr` (`github_repos`) and `gor` (`github_orgs`); {@link REPO_REF} reads them.
 *
 * @param alias - The alias of the row with `github_repo_id` — `r` for a run, `b` for a build job.
 *   A fixed identifier chosen by the extractor, never input.
 * @returns The two joins.
 */
export function joinRepo(alias: "r" | "b"): RawBuilder<unknown> {
  return sql.raw(
    `join ouroboros.github_repos gr on gr.id = ${alias}.github_repo_id ` +
      `join ouroboros.github_orgs gor on gor.id = gr.org_id`,
  );
}

/** The `repo_ref` of the repository {@link joinRepo} joined: V067's `login || '/' || name`. */
export const REPO_REF = sql.raw(`(gor.login || '/' || gr.name)`);

/**
 * A count or sum as `pg` hands it back — `bigint` and `numeric` arrive as strings — made a number.
 *
 * @param value - The column.
 * @returns The number; 0 for null (an empty `sum`).
 */
export function num(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}
