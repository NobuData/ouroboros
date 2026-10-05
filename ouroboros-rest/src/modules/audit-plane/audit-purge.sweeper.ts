/**
 * The audit purge — the sweep the `audit` retention tier governs (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486); consumes BQ.3's tier, #482).
 *
 * ```
 * every hour (jittered) ─▶ cutoffs("audit") ─▶ each workspace:
 *   tier below the 90-day floor? ─▶ refuse, log, touch nothing
 *   else ─▶ audit_events_purge() in batches ─▶ removed · held
 *           removed > 0 ─▶ audit.purged {cutoff, days, removed, held}   (actor: system)
 * report ─▶ log line + RetentionSchedule.swept("audit", removed)
 * ```
 *
 * **Retention is honest in both directions.** `retained 400d` promises the data survives that long
 * — the cutoff is the policy service's `now − tier`, the database refuses one inside 90 days, and
 * this sweeper refuses first — and that it does not survive indefinitely by accident: every hour
 * the expired events go, a batch at a time.
 *
 * **Never silent.** Each workspace whose purge removed something gets an `audit.purged` row, which
 * also fans out on `audit.*` to the SIEM; an event held back because another table references it
 * is counted as `held`, never quietly kept; and the tick's totals go to the log and to the
 * retention card's *last sweep*.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AUDIT_PURGED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { describeForLog } from "../errors/failure";
import { cutoffOf } from "../retention/retention.cutoffs";
import { boundsFor, tierDaysOf } from "../retention/retention.policy";
import { RetentionSchedule } from "../retention/retention.schedule";
import { RetentionPolicyService } from "../retention/retention.service";
import { jittered } from "../scheduling/cadence";
import { AuditPurgeRepository } from "./audit-purge.repository";

/** How the timer names itself in `SchedulerRegistry`. */
export const AUDIT_PURGE_SWEEP = "audit-retention";

/** How often the purge runs, before jitter — hourly. Retention is counted in days. */
export const AUDIT_PURGE_INTERVAL_MS = 3_600_000;

/** The most events one call to `audit_events_purge()` deletes. */
export const AUDIT_PURGE_BATCH = 1_000;

/** The most batches one workspace gets per tick — a backlog is worked down over ticks. */
export const AUDIT_PURGE_MAX_BATCHES = 20;

/** What one workspace's purge did. */
export interface AuditPurgeOutcome {
  /** The workspace. */
  readonly organizationId: string;
  /** The tier the cutoff was computed from, in whole days. */
  readonly days: number;
  /** Events older than this were expired. */
  readonly cutoff: Date;
  /** Events deleted. */
  readonly removed: number;
  /** Expired events kept because another table references them. */
  readonly held: number;
}

/** What one tick did — the tombstone counts. */
export interface AuditPurgeReport {
  /** Events deleted, across workspaces. */
  readonly removed: number;
  /** Expired events held back, across workspaces. */
  readonly held: number;
  /** The workspaces that had something removed or held. */
  readonly workspaces: readonly AuditPurgeOutcome[];
  /** Workspaces skipped because their tier was below the floor — should always be empty. */
  readonly refused: readonly string[];
}

@Injectable()
export class AuditPurgeSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuditPurgeSweeper.name);
  private stopped = false;

  /**
   * @param repository - The purge's statements.
   * @param retention - The `audit` tier's cutoffs.
   * @param retentionSchedule - Where the next sweep and the tombstone counts are reported.
   * @param audit - The trail, for `audit.purged`.
   * @param scheduler - Nest's registry, so the timer has a name.
   */
  constructor(
    private readonly repository: AuditPurgeRepository,
    private readonly retention: RetentionPolicyService,
    private readonly retentionSchedule: RetentionSchedule,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /** Start the loop. The first sweep is a full jittered interval away. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;
    this.retentionSchedule.stopped("audit");

    if (this.scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)) {
      this.scheduler.deleteTimeout(AUDIT_PURGE_SWEEP);
    }
  }

  /**
   * One purge across every workspace, without the scheduling — what a suite drives.
   *
   * @returns The tombstone counts.
   */
  async sweep(): Promise<AuditPurgeReport> {
    const at = this.now();
    const cutoffs = await this.retention.cutoffs("audit", at);
    const { floor } = boundsFor("audit");
    const workspaces: AuditPurgeOutcome[] = [];
    const refused: string[] = [];

    for (const organizationId of await this.repository.organizations()) {
      const cutoff = cutoffOf(cutoffs, organizationId);
      const days = tierDaysOf(at, cutoff);

      // The policy service and V094's CHECK both keep a tier at or above the floor, and the
      // database function refuses again; refusing here keeps a wrong cutoff from even being tried.
      if (days < floor) {
        refused.push(organizationId);
        continue;
      }

      const outcome = await this.purgeOne(organizationId, cutoff, days);
      if (outcome.removed > 0 || outcome.held > 0) workspaces.push(outcome);
    }

    return {
      removed: workspaces.reduce((sum, outcome) => sum + outcome.removed, 0),
      held: workspaces.reduce((sum, outcome) => sum + outcome.held, 0),
      workspaces,
      refused,
    };
  }

  /**
   * Purge one workspace in batches, and record what went.
   *
   * @param organizationId - The workspace.
   * @param cutoff - Its cutoff.
   * @param days - The tier it came from.
   * @returns What was removed and held.
   */
  private async purgeOne(
    organizationId: string,
    cutoff: Date,
    days: number,
  ): Promise<AuditPurgeOutcome> {
    let removed = 0;
    let held = 0;

    for (let batch = 0; batch < AUDIT_PURGE_MAX_BATCHES; batch += 1) {
      const result = await this.repository.purge(organizationId, cutoff, AUDIT_PURGE_BATCH);
      removed += result.removed;
      held = result.held;

      if (result.removed < AUDIT_PURGE_BATCH) break;
    }

    if (removed > 0) {
      await this.audit.record({
        organizationId,
        actorId: null,
        action: AUDIT_PURGED_EVENT,
        subjectType: "workspace",
        subjectId: organizationId,
        at: this.now(),
        detail: { cutoff: cutoff.toISOString(), days, removed, held },
      });
    }

    return { organizationId, days, cutoff, removed, held };
  }

  /** Run one sweep and book the next, whatever this one did. */
  private async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)) {
      this.scheduler.deleteTimeout(AUDIT_PURGE_SWEEP);
    }

    try {
      const report = await this.sweep();
      this.retentionSchedule.swept("audit", this.now(), report.removed);

      if (report.refused.length > 0) {
        this.logger.error(
          `Audit retention: refused to purge ${String(report.refused.length)} workspace(s) whose ` +
            `audit tier is below the ${String(boundsFor("audit").floor)}-day floor: ` +
            report.refused.join(", "),
        );
      }

      if (report.removed > 0 || report.held > 0) {
        this.logger.log(
          `Audit retention: removed ${String(report.removed)} event(s) and held ` +
            `${String(report.held)} still referenced, across ` +
            `${String(report.workspaces.length)} workspace(s).`,
        );
      }
    } catch (error) {
      // A sweep is lost, not the loop: a process that stopped purging would keep every event.
      this.logger.error(
        "An audit retention purge failed; retrying next tick.",
        describeForLog(error),
      );
    }

    this.schedule();
  }

  /** Book the next sweep, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const delay = jittered(AUDIT_PURGE_INTERVAL_MS);
    const timer = setTimeout(() => {
      void this.tick();
    }, delay);
    this.retentionSchedule.booked("audit", new Date(Date.now() + delay));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(AUDIT_PURGE_SWEEP, timer);
  }
}
