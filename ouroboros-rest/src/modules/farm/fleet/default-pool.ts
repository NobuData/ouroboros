/**
 * The workspace default pool (FE.1, [#1834](https://github.com/NobuData/ouroboros/issues/1834)).
 *
 * A workflow's build or test stage may name `runner_pool: "$default"` instead of a pool. The
 * shipped templates do (V156), so an unedited template builds wherever the workspace builds.
 * Each workspace has at most one default pool (`runner_pools.is_default`): the first pool it
 * creates, until Settings picks another, and the oldest remaining pool when the default is
 * deleted.
 *
 * Two readers resolve the reference, and both go through {@link selectDefaultPool}:
 *
 * - **readiness** (`loop/readiness.service.ts`) — reports which pool it resolved, or
 *   `build_pool_required` when the workspace has none;
 * - **a run's build submission** (`run-builds/run-builds.service.ts`) — pins the resolved pool on
 *   the run (`runs.default_pool_id`) the first time, so the run never drifts to another pool.
 *
 * `$default` can never be a real pool's name: V040's `runner_pools_name_shape` admits only
 * `[a-z0-9-]`.
 */

import type { Kysely, Transaction } from "kysely";

import type { Database } from "../../db/schema";

/** The reserved `runner_pool` value that means "the workspace default pool". */
export const DEFAULT_POOL_REFERENCE = "$default";

/** The default pool, as its resolvers need it. */
export interface DefaultPool {
  readonly id: string;
  readonly name: string;
}

/**
 * Whether a stage's `runner_pool` names the workspace default rather than a pool.
 *
 * @param pool - The stage's `runner_pool`, or `null`/`undefined` when it names none.
 * @returns `true` only for {@link DEFAULT_POOL_REFERENCE}.
 */
export function namesDefaultPool(pool: string | null | undefined): boolean {
  return pool === DEFAULT_POOL_REFERENCE;
}

/**
 * The workspace's default pool.
 *
 * @param db - The connection or an open transaction.
 * @param organizationId - The workspace.
 * @returns Its id and name, or `undefined` when the workspace has no pool at all.
 */
export async function selectDefaultPool(
  db: Kysely<Database> | Transaction<Database>,
  organizationId: string,
): Promise<DefaultPool | undefined> {
  return db
    .selectFrom("runner_pools")
    .select(["id", "name"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .executeTakeFirst();
}
