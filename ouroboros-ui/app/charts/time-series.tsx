"use client";

import { useRef, useState, type KeyboardEvent } from "react";

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

  const frame = plotFrame(width, height);
  const values = points.map((point) => point.value);
  const max = domainMax(values, guide?.value);
  const placed = placePoints(values, max, frame);
  const count = placed.length;
  const end = placed[count - 1];
  const guideY = guide ? yOf(guide.value, max, frame) : undefined;
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
  const plotWidth = frame.width - 2 * frame.inset;
  const step = percentProperty(count > 1 ? plotWidth / (count - 1) / frame.width : 1);
  const activePoint = active !== null ? placed[active] : undefined;

  return (
    <div className={cx("chart-scroll", className)}>
      <div className={cx("chart-scroll__inner", size === "half" && "chart-scroll__inner--half")}>
        <svg
          className="chart-ts__svg"
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          role="img"
          aria-label={label}
        >
          {gridlineYs(gridlines, frame).map((y) => (
            <line
              key={y}
              className="chart-ts__grid"
              x1={frame.inset}
              y1={y}
              x2={frame.width - frame.inset}
              y2={y}
            />
          ))}
          <line
            className="chart-ts__baseline"
            x1={frame.inset}
            y1={frame.baseline}
            x2={frame.width - frame.inset}
            y2={frame.baseline}
          />

          {guide && guideY !== undefined ? (
            <g data-chart-guide="">
              <line
                className="chart-ts__guide"
                x1={frame.inset}
                y1={guideY}
                x2={frame.width - frame.inset}
                y2={guideY}
              />
              <text className="chart-ts__text chart-ts__note" x={frame.inset} y={guideY - 6}>
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
                style={chartVars({ "--chart-x": percentProperty(point.x / frame.width), "--chart-step": step })}
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
  );
}
