/**
 * The Insights chart primitives ([#442](https://github.com/NobuData/ouroboros/issues/442)) —
 * four shapes that account for all eleven visuals on mockup 15.
 *
 * ```tsx
 * import { HBars, Sparkline, StackedVBars, TimeSeries } from "@/app/charts";
 * ```
 *
 * - {@link TimeSeries} — throughput, daily cost: line and area, guide, annotation, tooltip; and
 *   mockup 18's build-duration chart through its annotation layer: detected-point markers with
 *   collision-aware chips, and a labelled y-axis ([#517](https://github.com/NobuData/ouroboros/issues/517)).
 * - {@link HBars} — interventions, stage medians, suite failures, effort ladder, tokens.
 * - {@link Sparkline} — flaky history, DORA cells.
 * - {@link StackedVBars} — builds per day.
 *
 * Hand-written SVG and CSS, deliberately (decision **I4**): no charting library is in the
 * bundle, and `__tests__/charts/no-chart-library.test.ts` holds it there. Colour and type come
 * from the #16 tokens through `charts.css`, so both themes and every font scale come free.
 * The figures inside them are written by `app/format.ts` — `spanOfMs` for durations,
 * `moneyOfCents`, `tokenCount` and `percentOf` — so every card spells a number the same way.
 */

export { HBars, hBarsLabel, type HBarRow, type HBarsProps } from "./h-bars";
export { Sparkline, type SparklineProps } from "./sparkline";
export {
  StackedVBars,
  type StackedVBarsProps,
  type VBarDay,
  type VBarNote,
} from "./stacked-v-bars";
export {
  TimeSeries,
  type TimeSeriesAnnotation,
  type TimeSeriesAxis,
  type TimeSeriesGuide,
  type TimeSeriesMarker,
  type TimeSeriesPoint,
  type TimeSeriesProps,
} from "./time-series";
