/**
 * Row → resource, for the auto-merge surface — the same seam `preferences/resources.ts`
 * keeps, at the workspace's scale.
 *
 * The rows are the database's (snake_case, `Date`s); the resource is the contract's
 * (camelCase, exactly what `openapi.yaml`'s `AutoMergeSetting` schema promises). Two row
 * shapes arrive here because V011 splits reading from writing — the effective view for a
 * `GET`, the table row a `PATCH` got back — and one mapper per shape is what keeps the two
 * answers the same resource rather than two opinions about it.
 *
 * **Absence is the defaults, never a 404.** A workspace that has never chosen has no
 * settings row and reads `enabled: false` with null stamps — the switch always has a
 * position, and the safe default for "merge without review" is never yes.
 */

import type { WorkspaceSettings, WorkspaceSettingsEffective } from "../db/schema";

/**
 * What both routes answer — the contract's `AutoMergeSetting` schema.
 *
 * The stamps are nullable **together**: both are null exactly when the workspace has never
 * written a settings row, which is how a client tells a chosen `false` from a default one
 * without a boolean invented for the purpose.
 */
export interface AutoMergeResource {
  /** The switch's position — `false` for a workspace that has never chosen. */
  readonly enabled: boolean;
  /** When a setting last changed, ISO 8601, or null when nothing ever has. */
  readonly updatedAt: string | null;
  /** Who last changed it — `"user".id` — or null: never set, or the setter was deleted. */
  readonly updatedBy: string | null;
}

/**
 * The setting as the effective view answers it — the `GET` path.
 *
 * @param row - The workspace's row of `workspace_settings_effective`, or `undefined` for a
 *   workspace the view has no row for at all. Unreachable through the pipeline (the tenant
 *   guard has established the workspace exists), and mapped to the defaults anyway: a
 *   setting this surface could not read must read as *off* rather than as *on*.
 * @returns The resource.
 */
export function autoMergeResource(row: WorkspaceSettingsEffective | undefined): AutoMergeResource {
  return {
    enabled: row?.auto_merge_on_checks ?? false,
    updatedAt: row?.updated_at?.toISOString() ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * The setting as a write handed it back — the `PATCH` path.
 *
 * The table row rather than a second read of the view: what the upsert returned *is* the
 * new state, trigger stamps included, and reading the view after writing the table would
 * be a race with the next administrator dressed up as confirmation.
 *
 * @param row - The stored row.
 * @returns The resource. `updatedAt` is never null here — a stored row is always stamped.
 */
export function autoMergeFromWrite(row: WorkspaceSettings): AutoMergeResource {
  return {
    enabled: row.auto_merge_on_checks,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}
