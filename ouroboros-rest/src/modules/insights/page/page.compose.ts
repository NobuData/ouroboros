/**
 * The Insights page, assembled (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * Pure: everything the service read, in; the payload, out. This is the one place the page's
 * sections meet, and where the page-level money state is decided once and handed to every
 * section that prints a dollar.
 */

import type { FlakeCardCase } from "../../flakes/flakes.resources";
import type { CalibrationReport } from "../calibration.rules";
import type { MetricRange } from "../metrics/metrics.window";
import type { Scoreboard } from "../scoreboard/scoreboard.types";
import {
  doraOf,
  headOf,
  kpisOf,
  moneyOf,
  performanceOf,
  windowOf,
  type Windows,
} from "./page.cards";
import { flakyOf } from "./page.flaky";
import { barCardsOf, type BarBreakdowns } from "./page.hbars";
import type { InsightsResource } from "./page.resources";
import { seriesOf, type ProviderCaps } from "./page.series";

/** Everything the page is composed from — each fact read once, from the plane that owns it. */
export interface PageFacts {
  readonly range: MetricRange;
  /** `owner/name`, lower-case, or null for the whole workspace. */
  readonly repo: string | null;
  /** The last seven days' `merged_prs` and `human_interventions` — the head. */
  readonly week: Windows;
  /** The range's undimensioned windows. */
  readonly windows: Windows;
  /** Ninety days of `tokens`, `unpriced_tokens` and `cost_cents` — the month's projection. */
  readonly quarter: Windows;
  readonly breakdowns: BarBreakdowns;
  readonly calibration: Pick<CalibrationReport, "withinBandPct">;
  readonly caps: ProviderCaps;
  readonly flaky: readonly FlakeCardCase[];
  readonly scoreboard: Scoreboard;
}

/**
 * The payload.
 *
 * @param facts - What was read.
 * @returns `GET /api/v1/insights`.
 */
export function insightsResource(facts: PageFacts): InsightsResource {
  const { windows } = facts;
  const tokens = windowOf(windows, "tokens");
  const usage = moneyOf(
    tokens.value ?? 0,
    windowOf(windows, "unpriced_tokens").value ?? 0,
    windowOf(windows, "cost_cents").value ?? 0,
  );

  return {
    range: facts.range,
    window: { from: tokens.from, to: tokens.to },
    repo: facts.repo,
    usage,
    head: headOf(facts.week),
    kpis: kpisOf(windows, usage),
    series: seriesOf(windows, facts.quarter, facts.caps, usage),
    hbars: barCardsOf(facts.breakdowns, windows, facts.calibration),
    performance: performanceOf(windows, usage),
    flaky: flakyOf(
      facts.flaky,
      tokens.series.map((point) => point.day),
    ),
    scoreboard: facts.scoreboard,
    dora: doraOf(windows),
  };
}
