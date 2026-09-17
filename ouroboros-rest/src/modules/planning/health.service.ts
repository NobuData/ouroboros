/**
 * `BacklogHealthService` — mockup 09's **Backlog Health** card, as computed truth.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)), decision **N9**. Three meters over
 * the workspace's canonical tickets — `Sized 38/42`, `Blocked 4`, `Stale > 30d 6` — each with the
 * filter AM.3 ([#285](https://github.com/NobuData/ouroboros/issues/285)) links it through to, and the
 * footnote's nightly job with its schedule and last run, so *"Estimator re-runs nightly"* is a claim
 * a person can check rather than copy.
 *
 * Every number is counted on the read (`health.repository.ts`), so a synced state change moves the
 * card on the next request. An empty workspace is zeros throughout — genuine counts, never absent.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { BacklogHealthRepository, type LastRunRow } from "./health.repository";
import type { BacklogHealthResource, ReestimationRunResource } from "./planning.resources";

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BacklogHealthService {
  /**
   * @param repository - The counts and the last run.
   * @param config - The stale threshold and the job's schedule.
   */
  constructor(
    private readonly repository: BacklogHealthRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The card for one workspace.
   *
   * @param organizationId - The workspace.
   * @param now - The instant staleness is measured from. Defaulted; a spec pins it.
   * @returns The meters, their drill-through filters, and the nightly job.
   */
  async health(organizationId: string, now: Date = new Date()): Promise<BacklogHealthResource> {
    const thresholdDays = this.config.backlogStaleDays;
    const staleBefore = new Date(now.getTime() - thresholdDays * DAY_MS);
    const [metrics, lastRun] = await Promise.all([
      this.repository.metrics(organizationId, staleBefore),
      this.repository.lastRun(organizationId),
    ]);

    return {
      open: metrics.open,
      sized: {
        count: metrics.sized,
        total: metrics.open,
        filter: { state: "open", sizing: "unsized" },
      },
      blocked: { count: metrics.blocked, filter: { state: "open", blocked: true } },
      stale: {
        count: metrics.stale,
        thresholdDays,
        filter: { state: "open", staleDays: thresholdDays },
      },
      reestimation: {
        schedule: {
          hourUtc: this.config.reestimationHourUtc,
          jitterMinutes: this.config.reestimationJitterMinutes,
          batchLimit: this.config.reestimationBatch,
        },
        lastRun: lastRun === undefined ? null : runResource(lastRun),
      },
    };
  }
}

/**
 * A last-run row as the tooltip reads it.
 *
 * @param row - The row.
 * @returns The resource, instants as ISO 8601.
 */
function runResource(row: LastRunRow): ReestimationRunResource {
  return {
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    status: row.status,
    found: row.found,
    queued: row.queued,
    inFlight: row.inFlight,
  };
}
