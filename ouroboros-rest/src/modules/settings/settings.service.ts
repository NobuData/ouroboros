/**
 * The rules of the auto-merge surface ([#74](https://github.com/NobuData/ouroboros/issues/74)),
 * which are three:
 *
 *   * **The workspace is the session's, never the request's.** Both operations take the
 *     organization id the tenant guard resolved, exactly as the dashboard's do; whose
 *     switch this is cannot be asked wrongly.
 *   * **Absence is the defaults.** A workspace that has never chosen has no settings row
 *     and reads `enabled: false` with null stamps — never a 404, because the switch always
 *     has a position, and never a written-on-read row, because the table holds choices.
 *   * **A write is attributed, and it is the audit seam.** `updated_by` is the session
 *     user on every upsert, and the one point a change is known to have persisted is where
 *     {@link SettingsAudit} is told — the stub #90 makes real.
 *
 * Who may *reach* the write is deliberately not decided here: `@Roles(...ADMINISTRATORS)`
 * on the controller's PATCH is the whole of it, enforced by the globally registered
 * `RolesGuard` before a body is even validated. A member's attempt is a `403` that never
 * calls this service, which is what the ticket's does-not-write criterion means.
 */

import { Injectable } from "@nestjs/common";

import { currentUser } from "../tenancy/tenant.context";
import { SettingsAudit } from "./audit";
import type { PatchAutoMergeDto } from "./settings.dto";
import { SettingsRepository } from "./settings.repository";
import { autoMergeFromWrite, autoMergeResource, type AutoMergeResource } from "./resources";

@Injectable()
export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly audit: SettingsAudit,
  ) {}

  /**
   * The workspace's auto-merge setting, defaults included.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The resource — the stored choice where one exists, `false` where none does.
   */
  async read(organizationId: string): Promise<AutoMergeResource> {
    return autoMergeResource(await this.settings.effective(organizationId));
  }

  /**
   * Apply what the caller changed, and answer with the setting as it now stands.
   *
   * A body carrying nothing is legal and changes nothing — PATCH means "what is present
   * changed", per the preferences surface's argument — and writes no row, stamps no
   * `updated_by`, and emits no audit event, because nothing happened worth attributing.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param patch - The validated body.
   * @returns The resource after the write, read back from what the database returned
   *   rather than from what was sent — the row is the truth, and the trigger has already
   *   stamped it.
   */
  async update(organizationId: string, patch: PatchAutoMergeDto): Promise<AutoMergeResource> {
    if (patch.enabled === undefined) {
      return this.read(organizationId);
    }

    const caller = this.caller();
    const row = await this.settings.upsertAutoMerge(organizationId, patch.enabled, caller);

    this.audit.autoMergeChanged({
      organizationId,
      enabled: row.auto_merge_on_checks,
      changedBy: caller,
      changedAt: row.updated_at,
    });

    return autoMergeFromWrite(row);
  }

  /**
   * The signed-in person, or a loud failure.
   *
   * @returns Their id — what `updated_by` records and the audit event names.
   * @throws {Error} When there is no signed-in person — unreachable through the pipeline,
   *   because the route is authenticated and tenant-required; the same posture as
   *   `preferences.service.ts`, and sharper here, because a write this surface could not
   *   attribute is a write the audit trail would have to lie about.
   */
  private caller(): string {
    const user = currentUser();

    if (user === undefined) {
      throw new Error(
        "/api/v1/settings/auto-merge was reached with no signed-in person. The route is " +
          "neither @AllowAnonymous() nor @TenantOptional() — an auto-merge write belongs " +
          "to somebody.",
      );
    }

    return user.id;
  }
}
