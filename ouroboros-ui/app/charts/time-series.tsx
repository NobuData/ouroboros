"use client";

import { Fragment, useRef, useState, type KeyboardEvent } from "react";

import { cx } from "@/app/ui/class-names";

import {
  areaPath,
  domainMax,
  gridlineYs,
  linePoints,
  percentProperty,
  placePoints,
  plotFrame,
  sparseTicks,
  tickAnchor,
  yOf,
  type PlotFrame,
  type PlotPoint,
} from "./geometry";
import { CHART_MIN_WIDTH_REM, layoutMarks } from "./marks";
import { chartVars } from "./vars";

import "./charts.css";

/**
 * Mockup 15's line-and-area chart — the throughput card and the daily cost card
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)).
 *
 * A daily series drawn as a line over a faint area, with horizontal gridlines, three sparse
 * x-ticks, and the latest value labelled directly at the end of the line. Two optional
 * marks: a dashed **guide** with its own label (the `$20 budget`), and one **annotated point**
 * (the `$31.40 — Zephyr migration spike`).
 *
 * ### The annotation layer
 *
 * Mockup 18's duration chart ([#517](https://github.com/NobuData/ouroboros/issues/517)) is this
 * chart with two more optional parts, rather than a second chart system:
 *
 * - **markers** — detected points, each a dashed vertical through the plot and a tinted **chip**
 *   in a band above it (`May 18 · Zephyr 4.1 migration +1m 30s`). The chips are placed by
 *   `layoutMarks` (`./marks.ts`) so that clustered points stack instead of overlapping, and a
 *   chip that would leave the plot is held against its right edge. A chip is a real button when
 *   {@link TimeSeriesProps.onMarker} is given, so it is reached by Tab and pressed like any other.
 * - a labelled **y-axis** — gridlines at stated values, each written by a formatter (`4m`, not
 *   `240`), over a domain that need not start at zero.
 *
 * The chart draws what it is handed and decides nothing: which points are marked, what a chip
 * says and which tint it wears are the caller's, from its data.
 *
 * ### Interaction, scoped honestly
 *
 * Hover crosshair with a tooltip card, and nothing else — no pan, zoom or brush. Each point
 * has a transparent column over the plot that is both the hover target and a keyboard stop:
 * the columns share one tab stop (the latest point), and the arrow keys, Home and End walk
 * it, so the per-day detail is reachable without a mouse and a ninety-day series is not
 * ninety tab presses. Each column's accessible name is the tooltip's own sentence.
 *
 * ### Accessibility
 *
 * The SVG is one `role="img"` named by {@link TimeSeriesProps.label}, which must state what
 * the chart shows and its headline value. Entrance animation is in the stylesheet's
 * reduced-motion guard.
 */

/** One day of a series. */
export interface TimeSeriesPoint {
  /** The day as the x-axis and the tooltip spell it — `Aug 4`. */
  readonly label: string;
  /** The value plotted. */
  readonly value: number;
  /**
   * The tooltip's detail after the day — `6 merged · $9.12 · 1 intervention`. Omitted, the
   * tooltip says the formatted value.
   */
  readonly meta?: string;
}

/** A dashed horizontal guide — a budget, a target. */
export interface TimeSeriesGuide {
  /** Where it is drawn, in the series' own units. */
  readonly value: number;
  /** Its label, drawn above the line at the left edge — `$20 budget`. */
  readonly label: string;
}

/** One point called out with a dot and a label above it. */
export interface TimeSeriesAnnotation {
  /** Which point, by index into the series. Out of range draws nothing. */
  readonly index: number;
  /** What is said about it — `$31.40 — Zephyr migration spike`. */
  readonly label: string;
}

/** A detected point: a dashed vertical through the plot, and a chip above it. */
export interface TimeSeriesMarker {
  /** What identifies it to the caller — handed back when its chip is pressed. Unique in the chart. */
  readonly id: string;
  /** Which point it sits at, by index into the series. Out of range draws nothing. */
  readonly index: number;
  /** The chip's text — `May 18 · Zephyr 4.1 migration +1m 30s`. */
  readonly label: string;
  /** What a screen reader is told beyond the text — the direction and magnitude in words. */
  readonly description?: string;
  /** The chip's tint: `warn` for a change for the worse, `ok` for one for the better. */
  readonly tone: "warn" | "ok";
}

/** A labelled y-axis. */
export interface TimeSeriesAxis {
  /** The value drawn on the baseline. */
  readonly min: number;
  /** The value drawn at the top of the plot. Values above it are drawn at the top. */
  readonly max: number;
  /** The values that carry a gridline and a label. Those outside the domain are dropped. */
  readonly ticks: readonly number[];
  /** How a tick is written — `4m`. Defaults to the chart's `formatValue`. */
  readonly format?: (value: number) => string;
}

/** What a time series takes. */
export interface TimeSeriesProps {
  /** What the chart shows and its headline value — the SVG's accessible name. */
  readonly label: string;
  /** The series, oldest first. Empty and single-point series both render. */
  readonly points: readonly TimeSeriesPoint[];
  /** How a value is written in the endpoint label and the default tooltip. Defaults to `String`. */
  readonly formatValue?: (value: number) => string;
  /** An optional dashed guide. */
  readonly guide?: TimeSeriesGuide;
  /** An optional annotated point. */
  readonly annotation?: TimeSeriesAnnotation;
  /** Detected points, each a dashed vertical and a chip. In any order; the layout sorts them. */
  readonly markers?: readonly TimeSeriesMarker[];
  /** What the chips are, together — the name of their group. Defaults to `Annotations`. */
  readonly markersLabel?: string;
  /** Called with a marker's id when its chip is pressed. Without it the chips are text. */
  readonly onMarker?: (id: string) => void;
  /** A labelled y-axis. Given, its ticks are the gridlines and `gridlines` is ignored. */
  readonly axis?: TimeSeriesAxis;
  /** How many dimmed gridlines above the baseline. Defaults to `3`. */
  readonly gridlines?: number;
  /** Which points carry an x-tick, by index. Defaults to {@link sparseTicks}. */
  readonly ticks?: readonly number[];
  /** The viewBox's width. Defaults to `640`, the throughput card's. */
  readonly width?: number;
  /** The viewBox's height. Defaults to `196`, the throughput card's. */
  readonly height?: number;
  /** How wide the chart is before its wrapper scrolls: a full-width card or a half one. */
  readonly size?: "wide" | "half";
  /** Classes from the page — placement only. */
  readonly className?: string;
}

/** Room, in viewBox units, between a mark and the text that labels it. */
const LABEL_GAP = 9;

/** How close, in viewBox units, the guide may sit above the endpoint before its label moves below. */
const LABEL_CLEARANCE = 16;

/** Room on the left for a y-axis's labels, in viewBox units — mockup 18's plot starts at `x = 40`. */
const AXIS_GUTTER = 30;

/** The class each marker tone adds to its chip. */
const MARK_TONE: Record<TimeSeriesMarker["tone"], string> = {
  warn: "chart-mark--warn",
  ok: "chart-mark--ok",
};

/**
 * Where the endpoint's direct label goes: above and left of the dot, unless the guide line or
 * the top of the box is in the way, in which case below.
 *
 * @param end The endpoint.
 * @param guideY The guide's y, if there is a guide.
 * @returns The label's position.
 */
function endLabelAt(end: PlotPoint, guideY: number | undefined): PlotPoint {
  const crowded =
    end.y < LABEL_CLEARANCE ||
    (guideY !== undefined && guideY <= end.y && end.y - guideY < LABEL_CLEARANCE);

  return { x: end.x - (crowded ? 0 : 8), y: crowded ? end.y + 2 * LABEL_GAP + 2 : end.y - 10 };
}

/**
 * How an annotation's label hangs off its point, so it does not run off either edge.
 *
 * @param x The point's x.
 * @param frame The frame.
 * @returns The SVG `text-anchor`.
 */
function annotationAnchor(x: number, frame: PlotFrame): "start" | "middle" | "end" {
  if (x > frame.width * 0.75) return "end";
  if (x < frame.width * 0.25) return "start";
  return "middle";
}

/**
 * A line-and-area time series.
 *
 * @param props See {@link TimeSeriesProps}.
 * @returns The chart, inside a wrapper that scrolls sideways on a narrow screen.
 */
export function TimeSeries({
  label,
  points,
  formatValue = String,
  guide,
  annotation,
  markers,
  markersLabel = "Annotations",
  onMarker,
  axis,
  gridlines = 3,
  ticks,
  width = 640,
  height = 196,
  size = "wide",
  className,
}: TimeSeriesProps) {
  // The point the crosshair is on, if any, and — separately — the point that holds the
  // keyboard's one tab stop, which outlives a blur so tabbing back returns to the same day.
  const [active, setActive] = useState<number | null>(null);
  const [stop, setStop] = useState<number | null>(null);
  const hits = useRef<(HTMLButtonElement | null)[]>([]);

  const frame = plotFrame(width, height, axis ? AXIS_GUTTER : 0);
  const values = points.map((point) => point.value);
  const min = axis?.min ?? 0;
  const max = axis ? axis.max : domainMax(values, guide?.value);
  const placed = placePoints(values, max, frame, min);
  const count = placed.length;
  const end = placed[count - 1];
  const guideY = guide ? yOf(guide.value, max, frame, min) : undefined;
  const axisTicks = (axis?.ticks ?? []).filter((tick) => tick >= min && tick <= max);
  const gridYs = axis
    ? axisTicks.filter((tick) => tick > min).map((tick) => yOf(tick, max, frame, min))
    : gridlineYs(gridlines, frame);

  // The markers that sit on a point of this series, and where their chips go.
  const marks = (markers ?? []).filter(
    (marker) => Number.isInteger(marker.index) && marker.index >= 0 && marker.index < count,
  );
  const endFraction = frame.inset / frame.width;
  const layout = layoutMarks(
    marks.map((marker) => ({
      x: placed[marker.index]!.x / frame.width,
      chars: [...marker.label].length,
    })),
    { widthRem: CHART_MIN_WIDTH_REM[size], end: endFraction },
  );
  const noted = annotation ? placed[annotation.index] : undefined;
  const tickIndices = (ticks ?? sparseTicks(count)).filter((index) => index >= 0 && index < count);
  const focusIndex = stop !== null && stop < count ? stop : count - 1;

  /**
   * The sentence a point is described by, in the tooltip and to a screen reader alike.
   *
   * @param index The point.
   * @returns `Aug 4 — 6 merged · $9.12 · 1 intervention`.
   */
  const describe = (index: number): string => {
    const point = points[index]!;
    return `${point.label} — ${point.meta ?? formatValue(point.value)}`;
  };

  /**
   * Walk the keyboard stop along the series.
   *
   * @param event The key press on a column.
   * @param index The column it landed on.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: count - 1,
    }[event.key];

    if (next === undefined) return;

    event.preventDefault();
    const clamped = Math.min(Math.max(next, 0), count - 1);
    setActive(clamped);
    setStop(clamped);
    hits.current[clamped]?.focus();
  };

  // Each column is as wide as the gap between two points, so the columns tile the plot.
  const plotWidth = frame.width - frame.left - frame.inset;
  const step = percentProperty(count > 1 ? plotWidth / (count - 1) / frame.width : 1);
  const activePoint = active !== null ? placed[active] : undefined;

  return (
    <div className={cx("chart-scroll", className)}>
      <div className={cx("chart-scroll__inner", size === "half" && "chart-scroll__inner--half")}>
        {marks.length > 0 ? (
          <div
            className="chart-marks"
            role="group"
            aria-label={markersLabel}
            style={chartVars({ "--chart-rows": String(layout.rows) })}
          >
            {marks.map((marker, index) => {
              const placement = layout.placements[index]!;
              const place = chartVars({
                "--chart-x": percentProperty(placed[marker.index]!.x / frame.width),
                "--chart-end": percentProperty(endFraction),
                "--chart-row": String(placement.row),
                "--chart-chars": String(placement.chars),
              });
              const chip = cx("chart-mark", MARK_TONE[marker.tone]);

              // A pressable chip is named by its text and then what is said beyond it, so the
              // name still starts with what is on screen. A chip that is only text carries the
              // rest as text a screen reader reads on.
              return (
                <Fragment key={marker.id}>
                  <span aria-hidden="true" className="chart-mark__stem" style={place} />
                  {onMarker ? (
                    <button
                      type="button"
                      className={chip}
                      style={place}
                      title={marker.label}
                      aria-label={
                        marker.description ? `${marker.label} — ${marker.description}` : undefined
                      }
                      onClick={() => onMarker(marker.id)}
                    >
                      {marker.label}
                    </button>
                  ) : (
                    <span className={chip} style={place} title={marker.label}>
                      {marker.label}
                      {marker.description ? (
                        <span className="sr-only"> — {marker.description}</span>
                      ) : null}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>
        ) : null}

        <div className="chart-ts__plot">
          <svg
            className="chart-ts__svg"
            viewBox={`0 0 ${frame.width} ${frame.height}`}
            role="img"
            aria-label={label}
          >
            {gridYs.map((y) => (
              <line
                key={y}
                className="chart-ts__grid"
                x1={frame.left}
                y1={y}
                x2={frame.width - frame.inset}
                y2={y}
              />
            ))}
            <line
              className="chart-ts__baseline"
              x1={frame.left}
              y1={frame.baseline}
              x2={frame.width - frame.inset}
              y2={frame.baseline}
            />

            {axis ? (
              <g data-chart-axis="">
                {axisTicks.map((tick) => (
                  <text
                    key={tick}
                    className="chart-ts__text chart-ts__note"
                    x={frame.left - 6}
                    y={yOf(tick, max, frame, min) + 3}
                    textAnchor="end"
                  >
                    {(axis.format ?? formatValue)(tick)}
                  </text>
                ))}
              </g>
            ) : null}

            {marks.length > 0 ? (
              <g data-chart-markers="">
                {marks.map((marker) => (
                  <line
                    key={marker.id}
                    className="chart-ts__marker"
                    x1={placed[marker.index]!.x}
                    y1={0}
                    x2={placed[marker.index]!.x}
                    y2={frame.baseline}
                  />
                ))}
              </g>
            ) : null}

            {guide && guideY !== undefined ? (
              <g data-chart-guide="">
                <line
                  className="chart-ts__guide"
                  x1={frame.left}
                  y1={guideY}
                  x2={frame.width - frame.inset}
                  y2={guideY}
                />
                <text className="chart-ts__text chart-ts__note" x={frame.left} y={guideY - 6}>
                  {guide.label}
                </text>
              </g>
            ) : null}

            {count > 1 ? (
              <>
                <path className="chart-ts__area" d={areaPath(placed, frame)} />
                <polyline className="chart-ts__line" pathLength={1} points={linePoints(placed)} />
              </>
            ) : null}

            {activePoint ? (
              <g data-chart-crosshair="">
                <line
                  className="chart-ts__crosshair"
                  x1={activePoint.x}
                  y1={LABEL_CLEARANCE}
                  x2={activePoint.x}
                  y2={frame.baseline}
                />
                <circle className="chart-ts__dot" cx={activePoint.x} cy={activePoint.y} r={4} />
              </g>
            ) : null}

            {annotation && noted ? (
              <g data-chart-annotation="">
                <circle className="chart-ts__dot" cx={noted.x} cy={noted.y} r={4} />
                <text
                  className="chart-ts__text chart-ts__value"
                  x={noted.x}
                  y={noted.y - LABEL_GAP}
                  textAnchor={annotationAnchor(noted.x, frame)}
                >
                  {annotation.label}
                </text>
              </g>
            ) : null}

            {end ? (
              <g data-chart-endpoint="">
                <circle className="chart-ts__dot" cx={end.x} cy={end.y} r={4} />
                <text
                  className="chart-ts__text chart-ts__value"
                  {...endLabelAt(end, guideY)}
                  textAnchor="end"
                >
                  {formatValue(values[count - 1]!)}
                </text>
              </g>
            ) : null}

            <g data-chart-ticks="">
              {tickIndices.map((index) => (
                <text
                  key={index}
                  className="chart-ts__text chart-ts__note"
                  x={placed[index]!.x}
                  y={frame.height - 12}
                  textAnchor={tickAnchor(index, count)}
                >
                  {points[index]!.label}
                </text>
              ))}
            </g>
          </svg>

          {count > 0 ? (
            <div className="chart-ts__hits" role="group" aria-label={`${label} — daily detail`}>
              {placed.map((point, index) => (
                <button
                  key={index}
                  ref={(element) => {
                    hits.current[index] = element;
                  }}
                  type="button"
                  className="chart-ts__hit"
                  style={chartVars({
                    "--chart-x": percentProperty(point.x / frame.width),
                    "--chart-step": step,
                  })}
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-label={describe(index)}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                  onFocus={() => {
                    setActive(index);
                    setStop(index);
                  }}
                  onBlur={() => setActive((current) => (current === index ? null : current))}
                  onKeyDown={(event) => onKeyDown(event, index)}
                />
              ))}
            </div>
          ) : null}

          {activePoint && active !== null ? (
            <div
              className={cx("chart-tip", activePoint.x > frame.width / 2 && "chart-tip--before")}
              style={chartVars({ "--chart-x": percentProperty(activePoint.x / frame.width) })}
              aria-hidden="true"
            >
              <span className="chart-tip__date">{points[active]!.label}</span> —{" "}
              {points[active]!.meta ?? formatValue(points[active]!.value)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
