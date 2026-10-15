/**
 * The two member actions live-run admission adds (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)):
 *
 * ```
 * POST  /api/v1/queue/{id}/confirm        can_approve_loops   confirmed_at, confirmed_by   queue_item.confirmed
 * PATCH /api/v1/settings/live-execution   owner · admin       live_run_ceiling             workspace.live_ceiling_changed
 * ```
 *
 * Who may ask is the controllers' decorators; this file is what happens once they have let the
 * caller through. Each writes one audit row, and only when something changed — confirming an
 * item twice, or setting the ceiling it already has, leaves the trail alone.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import {
  QUEUE_ITEM_CONFIRMED_EVENT,
  WORKSPACE_LIVE_CEILING_CHANGED_EVENT,
} from "../audit/audit.events";
import { AppConfigService } from "../config/config.service";
import type { QueueItemSummary } from "../dashboard/resources";
import { effectiveCeiling } from "./admission";
import { liveCeilingAboveMax, queueItemNotFound } from "./admission.errors";
import { AdmissionRepository } from "./admission.repository";
import { ADMISSION_CLOCK, AdmissionService, type AdmissionSummaries } from "./admission.service";

/** `GET`/`PATCH /api/v1/settings/live-execution`. */
export interface LiveExecutionSettingsResource {
  /** `OURO_LIVE_EXECUTION_ENABLED`. */
  readonly deploymentEnabled: boolean;
  /** The workspace's own ceiling, as it set it — 1 when it never did. */
  readonly ceiling: number;
  /** `OURO_LIVE_RUN_CEILING_MAX` — the most `ceiling` may be. */
  readonly ceilingMax: number;
  /** The ceiling a claim enforces: the lower of the two. */
  readonly effectiveCeiling: number;
  /** `OURO_LIVE_RUN_WALL_CLOCK_MINUTES`. */
  readonly wallClockMinutes: number;
  /** `OURO_LIVE_RUN_NO_PROGRESS_MINUTES`. */
  readonly noProgressMinutes: number;
}

/** The audit trail, as these actions write to it. */
export type AdmissionAudit = Pick<AuditService, "record">;

@Injectable()
export class ConfirmService {
  /** The clock. */
  private readonly clock: () => Date;

  /**
   * @param store - The admission statements.
   * @param admission - The item's summary, with why it still waits.
   * @param config - The deployment's switch and limits.
   * @param audit - The trail.
   * @param clock - The clock — `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly store: AdmissionRepository,
    @Inject(AdmissionService) private readonly admission: AdmissionSummaries,
    private readonly config: AppConfigService,
    @Inject(AuditService) private readonly audit: AdmissionAudit,
    @Optional() @Inject(ADMISSION_CLOCK) clock?: () => number,
  ) {
    this.clock = () => new Date((clock ?? Date.now)());
  }

  /**
   * Confirm a queued item for a live run. Idempotent: a second confirmation keeps the first and
   * writes no second audit row.
   *
   * @param organizationId - The workspace.
   * @param itemId - `queue_items.id`.
   * @param userId - The member confirming — already held to `can_approve_loops` by the route.
   * @returns The item, with why it is still waiting if anything else holds it.
   * @throws {NotFoundError} `queue_item_not_found`.
   */
  async confirm(organizationId: string, itemId: string, userId: string): Promise<QueueItemSummary> {
    const now = this.clock();
    const result = await this.store.confirm(organizationId, itemId, userId, now);

    if (result === undefined) {
      throw queueItemNotFound(itemId);
    }

    const { item, changed } = result;

    if (changed) {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: QUEUE_ITEM_CONFIRMED_EVENT,
        subjectType: "queue_item",
        subjectId: item.id,
        at: now,
        detail: {
          repository: item.github_repo_id,
          issueNumber: item.issue_number,
          workflow: item.workflow_tag,
        },
      });
    }

    const [summary] = await this.admission.summaries(organizationId, [item], now);

    if (summary === undefined) {
      // `summaries` answers one summary per row; asserted for the types.
      throw new Error("AdmissionService.summaries answered no summary for one row.");
    }

    return summary;
  }

  /**
   * The workspace's live-execution settings, beside the deployment's.
   *
   * @param organizationId - The workspace.
   * @returns The settings.
   */
  async settings(organizationId: string): Promise<LiveExecutionSettingsResource> {
    const ceiling = await this.store.ceiling(this.store.db, organizationId);
    const ceilingMax = this.config.liveRunCeilingMax;

    return {
      deploymentEnabled: this.config.liveExecutionEnabled,
      ceiling,
      ceilingMax,
      effectiveCeiling: effectiveCeiling(ceiling, ceilingMax),
      wallClockMinutes: this.config.liveRunWallClockMinutes,
      noProgressMinutes: this.config.liveRunNoProgressMinutes,
    };
  }

  /**
   * Set the workspace's live-run ceiling.
   *
   * @param organizationId - The workspace.
   * @param ceiling - The new ceiling, 1 or more.
   * @param userId - The administrator setting it.
   * @returns The settings as they now stand.
   * @throws {InvalidRequestError} `live_ceiling_above_max` — above `OURO_LIVE_RUN_CEILING_MAX`.
   */
  async setCeiling(
    organizationId: string,
    ceiling: number,
    userId: string,
  ): Promise<LiveExecutionSettingsResource> {
    const maximum = this.config.liveRunCeilingMax;

    if (ceiling > maximum) {
      throw liveCeilingAboveMax(ceiling, maximum);
    }

    const before = await this.store.ceiling(this.store.db, organizationId);

    if (before !== ceiling) {
      await this.store.saveCeiling(organizationId, ceiling, userId);
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: WORKSPACE_LIVE_CEILING_CHANGED_EVENT,
        subjectType: "workspace",
        subjectId: organizationId,
        at: this.clock(),
        detail: { before, after: ceiling },
      });
    }

    return this.settings(organizationId);
  }
}
