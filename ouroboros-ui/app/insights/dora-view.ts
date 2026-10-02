/**
 * Every decision mockup 15's **DELIVERY HEALTH · DORA-ISH** strip makes, and every sentence it
 * says (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * Four cells — deploy frequency, lead time, change failure rate and MTTR — each a figure, its
 * move against the prior window and a `Sparkline` of its days, and under the title the caption
 * the strip is built to keep true: *Computed from your GitHub + build farm events, not
 * self-reported.*
 *
 * ### Proxies say so
 *
 * Two of the four are stand-ins: change failure rate is revert detection and MTTR is loop-scoped
 * recovery. The registry flags them (`proxy`, BI.1 #432), the service passes the flag through on
 * the cell, and a flagged cell wears a **`proxy` badge** whose popover prints the formula and the
 * caveat — straight from the registry, so nothing here can come to disagree with it. Deploy
 * frequency's own caveat names what stands in for a deploy.
 *
 * ### No invented curves
 *
 * A cell with no figure says *not enough data to measure* and draws no sparkline; a sparkline
 * with no positive day is not drawn either, because a flat line at zero reads as failure rather
 * than as a loop that has not run yet.
 *
 * Framework-free and pure, as `app/insights/view.ts` is.
 */

import type { InsightsPage, InsightsRange, MetricMethodology } from "@/app/api/insights";
import { spanOfMs } from "@/app/format";
import type { StatTone } from "@/app/ui/stat-card";

import { NOT_MEASURED, PROXY_BADGE } from "./view";

/** How a cell's line is coloured — goodness, or no judgement. A cell is never *failed*. */
export type DoraTone = Extract<StatTone, "up" | "down" | "muted">;

/** One DORA cell, as served. */
export type InsightsDoraCell = InsightsPage["dora"][number];

/** The strip's title, verbatim from the mockup. */
export const DORA_TITLE = "Delivery health · DORA-ish";

/** The caption beside the title, verbatim from the mockup. */
export const DORA_CAPTION = "Computed from your GitHub + build farm events, not self-reported.";

/** The line under a cell with no figure — time, not failure. */
export const DORA_NOT_ENOUGH = "Not enough data to measure yet.";

/** Each cell's caption, verbatim from the mockup. */
const DORA_LABEL: Readonly<Record<InsightsDoraCell["key"], string>> = {
  deploy_frequency: "Deploy frequency",
  lead_time: "Lead time · issue→merge",
  change_failure_rate: "Change failure rate",
  mttr: "MTTR",
};

/** One cell, ready to draw. */
export interface DoraCellView {
  /** The cell's key — stable across ranges. */
  readonly key: InsightsDoraCell["key"];
  /** The caption — the methodology button's text. */
  readonly label: string;
  /** The figure, without its suffix, or {@link NOT_MEASURED}. */
  readonly value: string;
  /** The fainter rest of the figure — `/day` — or `null`. */
  readonly valueSuffix: string | null;
  /** The line under the figure. */
  readonly delta: string;
  /** How that line is coloured — by goodness, never by sign. */
  readonly tone: DoraTone;
  /** The sparkline's days, oldest first, or `null` when there is no curve to draw. */
  readonly sparkline: readonly number[] | null;
  /** Whether the sparkline recedes — a cell that did not move. */
  readonly dim: boolean;
  /** Whether the cell wears the {@link PROXY_BADGE}. */
  readonly proxy: boolean;
  /** The registry entry its popover prints. */
  readonly methodology: MetricMethodology;
  /** The cell in one sentence, for a screen reader — the sparkline is decoration. */
  readonly summary: string;
}

/**
 * A number to one decimal, without a trailing `.0` — `4.2`, `3`.
 *
 * @param value The number.
 * @returns It, rounded.
 */
function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * A cell's figure, in its unit.
 *
 * @param cell The cell. Its value is not null.
 * @param value The value — the figure, or the size of a move.
 * @returns `4.2`, `3h 10m`, `3.1%`, `22m`.
 */
function figureOf(cell: InsightsDoraCell, value: number): string {
  switch (cell.unit) {
    case "duration_ms":
      return spanOfMs(value);
    case "pct":
      return `${oneDecimal(value)}%`;
    default:
      return oneDecimal(value);
  }
}

/**
 * The size of a move, in the cell's unit.
 *
 * @param cell The cell.
 * @param size The move's absolute size.
 * @returns `0.4/day`, `12m`, `0.4pts`.
 */
function moveOf(cell: InsightsDoraCell, size: number): string {
  switch (cell.unit) {
    case "per_day":
      return `${oneDecimal(size)}/day`;
    case "pct":
      return `${oneDecimal(size)}pts`;
    default:
      return figureOf(cell, size);
  }
}

/**
 * The line under a cell's figure.
 *
 * - No figure: {@link DORA_NOT_ENOUGH}.
 * - No prior window, or no move: says so — the mockup's `— flat`.
 * - A duration says *faster* or *slower*; anything else names the prior window it moved against.
 *
 * @param cell The cell.
 * @param range The window.
 * @returns The line.
 */
function deltaOf(cell: InsightsDoraCell, range: InsightsRange): string {
  if (cell.value === null) return DORA_NOT_ENOUGH;
  if (cell.delta === null) return `No prior ${range} to compare.`;
  if (cell.trend.direction === "flat" || cell.delta === 0) return `— flat vs prior ${range}`;

  const arrow = cell.delta > 0 ? "▲" : "▼";
  const size = moveOf(cell, Math.abs(cell.delta));

  if (cell.unit === "duration_ms") return `${arrow} ${size} ${cell.delta < 0 ? "faster" : "slower"}`;

  return `${arrow} ${size} vs prior ${range}`;
}

/**
 * The tone of a cell's line — goodness, from the service's `trend.good`.
 *
 * @param cell The cell.
 * @returns `up` for good news, `down` for bad, `muted` for no judgement.
 */
function toneOf(cell: InsightsDoraCell): DoraTone {
  if (cell.value === null || cell.trend.good === null) return "muted";
  return cell.trend.good ? "up" : "down";
}

/** The most bars a cell's sparkline draws — the mockup's cells are a glance, not a chart. */
export const SPARK_BARS = 15;

/**
 * The sparkline's bars — or `null` when there is no curve to draw.
 *
 * One value per day is served; a 90-day window is ninety bars, wider than a cell. The days are
 * grouped, in order, into at most {@link SPARK_BARS} consecutive runs, and each bar is the mean of
 * the days in its run that were measured. A day nothing was measured on adds nothing to its bar,
 * and a run with no measured day is a zero-height bar. A series with no positive bar at all is no
 * curve — never a flat line at zero.
 *
 * @param cell The cell.
 * @returns The bars, oldest first, or `null`.
 */
export function sparklineOf(cell: InsightsDoraCell): number[] | null {
  if (cell.value === null || cell.sparkline.length === 0) return null;

  const size = Math.ceil(cell.sparkline.length / SPARK_BARS);
  const bars: number[] = [];

  for (let start = 0; start < cell.sparkline.length; start += size) {
    const measured = cell.sparkline
      .slice(start, start + size)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    bars.push(measured.length === 0 ? 0 : measured.reduce((sum, value) => sum + value, 0) / measured.length);
  }

  return bars.some((value) => value > 0) ? bars : null;
}

/**
 * One cell.
 *
 * @param cell The cell, as served.
 * @param range The window the page shows.
 * @returns What the strip draws.
 */
export function doraCell(cell: InsightsDoraCell, range: InsightsRange): DoraCellView {
  const label = DORA_LABEL[cell.key];
  const value = cell.value === null ? NOT_MEASURED : figureOf(cell, cell.value);
  const valueSuffix = cell.value !== null && cell.unit === "per_day" ? "/day" : null;
  const delta = deltaOf(cell, range);
  const proxy = cell.proxy || cell.methodology.proxy;

  return {
    key: cell.key,
    label,
    value,
    valueSuffix,
    delta,
    tone: toneOf(cell),
    sparkline: sparklineOf(cell),
    dim: cell.trend.direction === "flat",
    proxy,
    methodology: cell.methodology,
    summary: `${label}${proxy ? ` (${PROXY_BADGE})` : ""}: ${value}${valueSuffix ?? ""}. ${delta}`,
  };
}

/**
 * The strip, in the service's cell order.
 *
 * @param page The page, as served.
 * @returns The four cells.
 */
export function doraStrip(page: InsightsPage): DoraCellView[] {
  return page.dora.map((cell) => doraCell(cell, page.range));
}
