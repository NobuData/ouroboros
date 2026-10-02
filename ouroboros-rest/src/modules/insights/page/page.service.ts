/**
 * The Insights page's read (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)):
 * gather every fact once, from the plane that owns it, and hand them to the composers.
 *
 * ```
 * MetricsService.windows      the head (7d) · every undimensioned figure of the range · 90d cost
 * MetricsService.breakdown    causes · stages · suites · efforts · task kinds
 * ScoreboardService           BJ.3's scoreboard
 * CalibrationService          #435's report — the effort card's line
 * FlakeStateService.card      AT.3's states and occurrences
 * InsightsPageRepository      the provider caps — configuration, not a metric — and the
 *                             rollups' freshness (BK.6, #447)
 * ```
 *
 * **One instant for the whole page.** Every read is given the same `now`, so a request that
 * straddles midnight UTC cannot draw the head from one day and the charts from the next.
 *
 * It computes nothing: what a number *is* stays in the registry and the service that fills it
 * (decision **I1**), which is what lets the email digest (#440) read this same payload and
 * inherit every honesty rule instead of re-deriving one.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { FlakeStateService } from "../../flakes/flake-state.service";
import { CalibrationService } from "../calibration.service";
import { METRICS_CLOCK, MetricsService } from "../metrics/metrics.service";
import type { MetricRange } from "../metrics/metrics.window";
import { dayBounds } from "../rollup/rollup.days";
import { ScoreboardService } from "../scoreboard/scoreboard.service";
import { windowOf } from "./page.cards";
import { insightsResource } from "./page.compose";
import { freshnessOf } from "./page.freshness";
import { InsightsPageRepository } from "./page.repository";
import type { InsightsResource } from "./page.resources";

/** The range the page shows when the request names none — the mockup's active segment. */
export const DEFAULT_INSIGHTS_RANGE: MetricRange = "30d";

/** The head is always the last week. */
const HEAD_RANGE: MetricRange = "7d";

/** Long enough to hold the whole of the current month, whatever range the page shows. */
const PROJECTION_RANGE: MetricRange = "90d";

/** The head's two figures. */
const HEAD_METRICS = ["merged_prs", "human_interventions"] as const;

/** The projection's three: the money rule needs tokens beside the spend. */
const MONEY_METRICS = ["tokens", "unpriced_tokens", "cost_cents"] as const;

/** Every undimensioned figure the page draws for its range. */
export const PAGE_METRICS: readonly string[] = [
  // the KPI row
  "merge_rate",
  "merged_untouched_rate",
  "cycle_time",
  "cost_per_merged_pr",
  "human_interventions",
  // the series
  "merged_prs",
  ...MONEY_METRICS,
  "builds",
  "build_failures",
  // the performance strip and the bar cards' lines
  "build_success_rate",
  "test_cases_run",
  "test_pass_rate",
  "local_tokens",
  // the DORA strip
  "deploy_frequency",
  "lead_time",
  "change_failure_rate",
  "mttr",
];

/** What a request may ask for. */
export interface InsightsRequest {
  readonly range: MetricRange;
  /** One repository's `owner/name`, or undefined for the whole workspace. */
  readonly repo?: string;
  /**
   * The instant to read as of, instead of the clock's. The weekly digest (#440) passes its
   * scheduled slot, so a run that starts late still reports the week its slot names. No route
   * exposes it.
   */
  readonly now?: Date;
}

@Injectable()
export class InsightsPageService {
  /**
   * @param metrics - The windowed metrics service.
   * @param scoreboard - The model scoreboard.
   * @param calibration - The estimator's calibration.
   * @param flakes - The flakes plane's card read.
   * @param repository - The provider caps and the rollups' freshness.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly metrics: MetricsService,
    private readonly scoreboard: ScoreboardService,
    private readonly calibration: CalibrationService,
    private readonly flakes: FlakeStateService,
    private readonly repository: InsightsPageRepository,
    @Optional() @Inject(METRICS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * The Insights page for a workspace over a range.
   *
   * @param organizationId - The workspace, from the tenant context. Every read filters on it.
   * @param request - The range and, optionally, one repository.
   * @returns The payload.
   */
  async read(organizationId: string, request: InsightsRequest): Promise<InsightsResource> {
    const now = request.now ?? new Date(this.clock());
    // The mirror stores accounts and repositories lower-case, so the grain's `repo_ref` is too.
    const repo = request.repo?.toLowerCase();
    const scope = { organizationId, repo, range: request.range, now };

    const [
      week,
      windows,
      quarter,
      interventions,
      stages,
      suites,
      effort,
      tokens,
      scoreboard,
      calibration,
      caps,
      freshness,
    ] = await Promise.all([
      this.metrics.windows(HEAD_METRICS, { ...scope, range: HEAD_RANGE }),
      this.metrics.windows(PAGE_METRICS, scope),
      this.metrics.windows(MONEY_METRICS, { ...scope, range: PROJECTION_RANGE }),
      this.metrics.breakdown("human_interventions", scope),
      this.metrics.breakdown("stage_duration", scope),
      this.metrics.breakdown("test_failures_by_suite", scope),
      this.metrics.breakdown("completion_time_by_effort", scope),
      this.metrics.breakdown("tokens_by_task_kind", scope),
      this.scoreboard.scoreboard(scope),
      this.calibration.report(organizationId, request.range),
      this.repository.caps(organizationId),
      this.repository.freshness(organizationId),
    ]);

    // The flaky card covers the same UTC days the charts do.
    const window = windowOf(windows, "tokens");
    const flaky = await this.flakes.card(
      organizationId,
      { from: dayBounds(window.from).from, to: dayBounds(window.to).to },
      repo,
    );

    return insightsResource({
      range: request.range,
      repo: repo ?? null,
      week,
      windows,
      quarter,
      breakdowns: { interventions, stages, suites, effort, tokens },
      calibration,
      caps,
      flaky,
      scoreboard,
      freshness: freshnessOf(freshness, now),
    });
  }
}
