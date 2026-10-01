/**
 * Integration helpers for the windowed metrics service (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)) and its consumers: write rollup rows
 * and loop PRs, and ask the service for the figures the dashboard must agree with.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { MetricsService } from "../modules/insights/metrics/metrics.service";
import { addDays, utcDay } from "../modules/insights/rollup/rollup.days";
import { ROLLUP_EXTRACTORS } from "../modules/insights/rollup/rollup.extractors";
import { RollupService } from "../modules/insights/rollup/rollup.service";
import type { ApiHarness } from "./harness.fixture";

/** The dashboard's shared figures, as `MetricsService` answers them over seven days. */
export interface SharedFigures {
  readonly merged7d: { readonly count: number; readonly deltaVsPrior: number };
  readonly mergeRate: number;
  readonly avgCycleSeconds: number;
  readonly interventions7d: number;
  readonly mergedSinceMorning: number;
}

/**
 * What the dashboard's pulse and merged stat should read: the service's own windows, converted
 * to the dashboard's units. The #437 amendment is verified by comparing the endpoint with this.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param now - The instant; now by default.
 * @returns The figures.
 */
export async function sharedFigures(
  api: ApiHarness,
  organizationId: string,
  now: Date = new Date(),
): Promise<SharedFigures> {
  const metrics = api.nest.get(MetricsService);
  const scope = { organizationId, range: "7d" as const, now };
  const [merged, rate, cycle, interventions] = await Promise.all([
    metrics.window("merged_prs", scope),
    metrics.window("merge_rate", scope),
    metrics.window("cycle_time", scope),
    metrics.window("human_interventions", scope),
  ]);

  return {
    merged7d: { count: merged.value ?? 0, deltaVsPrior: merged.delta ?? 0 },
    mergeRate: (rate.value ?? 0) / 100,
    avgCycleSeconds: (cycle.value ?? 0) / 1000,
    interventions7d: interventions.value ?? 0,
    mergedSinceMorning: merged.series.at(-1)?.value ?? 0,
  };
}

/** One `metric_daily` row, as the rollup would write it. */
export interface MetricDayRow {
  readonly repoRef: string;
  readonly metricId: string;
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly value: number;
  readonly numerator?: number;
  readonly denominator?: number;
  /** A median row's samples, ascending; its `value` must be their median. */
  readonly samples?: readonly number[];
  readonly dimension?: string;
  /** Tooltip figures. */
  readonly meta?: Readonly<Record<string, number>>;
}

/**
 * Write rollup rows directly, as a fill would have.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param rows - The rows; `is_rate` is read from the registry.
 */
export async function insertMetricDays(
  api: ApiHarness,
  organizationId: string,
  rows: readonly MetricDayRow[],
): Promise<void> {
  for (const row of rows) {
    const meta = row.samples === undefined ? (row.meta ?? {}) : { samples: row.samples };

    await api.sql.query(
      `insert into ouroboros.metric_daily
         (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, numerator,
          denominator, meta)
       select $1, $2, $3, d.is_rate, $4, $5::date, $6, $7, $8, $9::jsonb
         from ouroboros.metric_definitions d where d.metric_id = $3`,
      [
        organizationId,
        row.repoRef,
        row.metricId,
        row.dimension ?? "",
        row.day,
        row.value,
        row.numerator ?? null,
        row.denominator ?? null,
        JSON.stringify(meta),
      ],
    );
  }
}

/**
 * Fill a workspace's rollups through the real service, as the hourly job would have: every family,
 * the given number of days back to yesterday, and today.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param days - How many days before today to fill.
 */
export async function fillRollups(
  api: ApiHarness,
  organizationId: string,
  days: number,
): Promise<void> {
  const rollups = api.nest.get(RollupService);
  const now = new Date();
  const yesterday = addDays(utcDay(now), -1);

  for (const { family } of ROLLUP_EXTRACTORS) {
    const outcome = await rollups.backfill(
      organizationId,
      family,
      addDays(yesterday, -(days - 1)),
      yesterday,
      now,
    );

    if (outcome.status !== "succeeded") {
      throw new Error(`${family} did not fill: ${outcome.error ?? "unknown"}`);
    }
  }
}

/**
 * Move a workspace's rollup bookkeeping, as a finished fill does — what retires cached windows.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param family - The family that "refreshed".
 */
export async function markRollupRefreshed(
  api: ApiHarness,
  organizationId: string,
  family = "throughput",
): Promise<void> {
  await api.sql.query(
    `insert into ouroboros.metric_rollup_state
       (organization_id, family, last_run_status, last_run_at)
     values ($1, $2, 'succeeded', clock_timestamp())
     on conflict (organization_id, family) do update
       set last_run_status = 'succeeded', last_run_at = clock_timestamp()`,
    [organizationId, family],
  );
}

/**
 * The pull request a loop opened, merged or closed — what the throughput tail counts.
 *
 * Creates the workspace's git-host ticket source on first use, since every PR names one.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param runId - The loop.
 * @param spec - Its number, state and, for a merge, the instant.
 */
export async function insertLoopPr(
  api: ApiHarness,
  organizationId: string,
  runId: string,
  spec: { number: number; state: "merged" | "closed"; mergedAt?: string },
): Promise<void> {
  await api.sql.query(
    `insert into ouroboros.ticket_sources (organization_id, kind, display_name)
     select $1, 'github', 'GitHub'
      where not exists (select 1 from ouroboros.ticket_sources where organization_id = $1)`,
    [organizationId],
  );
  await api.sql.query(
    `insert into ouroboros.pull_requests
       (organization_id, source_id, external_number, external_url, title, head_branch,
        base_branch, run_id, state, merged_at)
     values ($1, (select id from ouroboros.ticket_sources where organization_id = $1 limit 1),
             $2::int, 'https://github.com/acme/repo/pull/' || $2::text, 'Loop ' || $2::text,
             'loop/' || $2::text, 'main', $3, $4, $5)`,
    [organizationId, spec.number, runId, spec.state, spec.mergedAt ?? null],
  );
}
