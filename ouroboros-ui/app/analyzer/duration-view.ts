/**
 * Every decision the annotated duration chart and its Details sheet make, and every sentence they
 * say (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517), mockup 18's **Build
 * duration · 90 days, with detected change-points**) — pure, so each honesty rule is a unit test on
 * a small value rather than an assertion about markup.
 *
 * ### Findings rendered, not annotations drawn
 *
 * Every chip is one `change_point` finding and nothing else is a chip: its place is the finding's
 * detected day, its figure the finding's measured delta, and its tint the **sign of that delta** —
 * a build that got faster is good news and never wears the warning hue, whatever its candidate is
 * called. A finding whose day the series does not reach has no place on the chart and is not drawn.
 *
 * ### A ranking, not a verdict
 *
 * The analyzer scores every recorded change within its attribution window; it does not establish a
 * cause. The chip may name the best-scored candidate — that is useful — but the sheet says
 * *attributed to (top candidate)*, lists **every** candidate with its score and the two factors the
 * score is the product of, and states the window, so a reader who knows better can see the
 * reasoning and disagree with it. A shift with nothing recorded in reach says so instead of
 * borrowing a cause.
 *
 * **Framework-free**, as `app/analyzer/view.ts` is.
 */

import type {
  AnalysisEvidence,
  ChangePoint,
  ChangePointCandidate,
  DurationChart,
  DurationPoint,
} from "@/app/api/analyzer";
import type { TimeSeriesAxis, TimeSeriesMarker, TimeSeriesPoint } from "@/app/charts";
import { percentOf, spanOfMs } from "@/app/format";
import { dayLabel } from "@/app/insights/series-view";
import {
  BUILD_FARM_PATH,
  FARM_POOLS_HASH,
  FARM_RUNNERS_HASH,
  prPath,
  testsPath,
  workflowPath,
} from "@/app/paths";
import { BUILD_FARM_ORIGIN } from "@/app/runs/origin";

import { count } from "./view";

/* ------------------------------------------------------------------ the card */

/** The card's tag, verbatim from the mockup. */
export const DURATION_TAG = "median · per build";

/** The caption under the chart, verbatim from the mockup. */
export const DURATION_CAPTION =
  "The analyzer attributes every shift in the curve to a merge, a config change, or infrastructure drift.";

/** What the group of chips is called. */
export const MARKERS_LABEL = "Detected change-points";

/** The days the chart covers when no run has said — the MVP's fixed range. */
export const DEFAULT_DURATION_DAYS = 90;

/** What a card with nothing to draw says. */
export interface DurationEmpty {
  readonly title: string;
  readonly note: string;
}

/** Before any run has looked for change-points. */
export const NO_DURATION_RUN: DurationEmpty = {
  title: "No change-point analysis yet",
  note: "The chart is drawn from an analysis run: its build durations, and the shifts it detected in them. Run an analysis to see it.",
};

/** A run whose window held no successful build to time. */
export const NO_DURATION_SERIES: DurationEmpty = {
  title: "No build durations in this window",
  note: "The last analysis found no successful builds to time, so there is no curve to draw and nothing to detect a shift in.",
};

/**
 * The card's title — `Build duration · 90 days, with detected change-points`.
 *
 * @param chart The chart, or `null` before the page is read.
 * @returns The title, naming the run's own window.
 */
export function durationTitle(chart: DurationChart | null): string {
  const days = chart?.window?.days ?? DEFAULT_DURATION_DAYS;

  return `Build duration · ${count(days, "day")}, with detected change-points`;
}

/**
 * A run that timed builds on too few days for a curve to mean anything (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521)).
 *
 * @param days The days it timed.
 * @param floor The fewest days a chart is drawn from — the service's floor.
 * @returns The empty state.
 */
export function tooFewDays(days: number, floor: number): DurationEmpty {
  return {
    title: "Too few days to chart",
    note: `The last analysis timed builds on ${count(days, "day")}. A curve, and a shift detected in it, need at least ${floor}.`,
  };
}

/**
 * Why the card has no chart, if it has none.
 *
 * @param chart The chart.
 * @param floor The fewest days a chart is drawn from — the service's corpus floor. The page's
 *   state already withholds a too-thin analysis; this is the same rule held by the chart itself,
 *   for a run whose corpus cleared the floor while the build it times ran on fewer days. `0`
 *   (the default) draws whatever there is.
 * @returns The empty state, or `null` when there is a series worth drawing.
 */
export function durationEmpty(chart: DurationChart, floor: number = 0): DurationEmpty | null {
  if (chart.runId === null) return NO_DURATION_RUN;
  if (chart.series.length === 0) return NO_DURATION_SERIES;

  return chart.series.length < floor ? tooFewDays(chart.series.length, floor) : null;
}

/* ------------------------------------------------------------------ durations */

/**
 * A duration as the chart writes one — `4m 12s`, `3m`, `40s`.
 *
 * @param seconds The duration, in seconds. Rounded to the nearest whole one.
 * @returns The span.
 */
export function durationSpan(seconds: number): string {
  return spanOfMs(Math.round(seconds) * 1000);
}

/**
 * A change-point's delta as its chip writes it — `+1m 30s`, `−2m 10s`.
 *
 * @param deltaSeconds After minus before.
 * @returns The signed span, with a true minus sign.
 */
export function deltaText(deltaSeconds: number): string {
  return `${deltaSeconds < 0 ? "−" : "+"}${durationSpan(Math.abs(deltaSeconds))}`;
}

/**
 * A change-point's tint, **by the sign of its delta and nothing else**.
 *
 * @param deltaSeconds After minus before.
 * @returns `ok` for a build that got faster, `warn` for one that got slower.
 */
export function changeTone(deltaSeconds: number): "warn" | "ok" {
  return deltaSeconds < 0 ? "ok" : "warn";
}

/**
 * What happened, in words — the half of a change-point a tint cannot say.
 *
 * @param point The change-point.
 * @returns `Build duration rose by 1m 30s on Jul 13`.
 */
export function changeSentence(point: Pick<ChangePoint, "date" | "deltaSeconds">): string {
  const verb = point.deltaSeconds < 0 ? "fell" : "rose";

  return `Build duration ${verb} by ${durationSpan(Math.abs(point.deltaSeconds))} on ${dayLabel(point.date)}`;
}

/* ------------------------------------------------------------------ candidates */

/** The longest a candidate's name runs on a chip before it is cut. */
export const MAX_CHIP_NAME = 28;

/** What a chip calls the candidate of a shift nothing recorded explains. */
export const UNATTRIBUTED_NAME = "no recorded change";

/**
 * A change-point's best-scored candidate.
 *
 * @param point The change-point.
 * @returns The first of its ranked candidates, or `null` for a finding that carries none.
 */
export function topCandidate(point: Pick<ChangePoint, "candidates">): ChangePointCandidate | null {
  return point.candidates[0] ?? null;
}

/**
 * Whether a candidate is the analyzer saying *nothing recorded was in reach*.
 *
 * @param candidate The candidate.
 * @returns True for the scoreless placeholder a shift with no event in its window carries.
 */
export function isUnattributed(candidate: Pick<ChangePointCandidate, "score">): boolean {
  return candidate.score <= 0;
}

/**
 * A candidate's name, cut to fit a chip. The date and the delta are never cut: they are the
 * finding's measurements, and the name is its guess.
 *
 * @param name The candidate's label.
 * @returns It, or its first characters and an ellipsis when it is longer than {@link MAX_CHIP_NAME}.
 */
export function chipName(name: string): string {
  const characters = [...name.trim()];

  return characters.length <= MAX_CHIP_NAME
    ? characters.join("")
    : `${characters.slice(0, MAX_CHIP_NAME - 1).join("").trimEnd()}…`;
}

/**
 * A chip's text — `Jul 13 · Zephyr 4.1 migration +1m 30s`.
 *
 * @param point The change-point.
 * @returns The date, the top candidate's name and the delta.
 */
export function chipLabel(point: ChangePoint): string {
  const top = topCandidate(point);
  const name = top === null || isUnattributed(top) ? UNATTRIBUTED_NAME : chipName(top.label);

  return `${dayLabel(point.date)} · ${name} ${deltaText(point.deltaSeconds)}`;
}

/**
 * What a screen reader is told about a chip beyond its text: the date, the direction and
 * magnitude in words, and the top candidate in full.
 *
 * @param point The change-point.
 * @returns `Build duration rose by 1m 30s on Jul 13. Top candidate: Zephyr 4.1 migration. Opens the details.`
 */
export function chipDescription(point: ChangePoint): string {
  const top = topCandidate(point);
  const candidate =
    top === null || isUnattributed(top)
      ? "No recorded change in the attribution window."
      : `Top candidate: ${top.label}.`;

  return `${changeSentence(point)}. ${candidate} Opens the details.`;
}

/**
 * The id the chart card's heading answers to — where a measurement that a detected shift
 * confounded links (BW.5, [#520](https://github.com/NobuData/ouroboros/issues/520)).
 */
export const DURATION_ANCHOR = "build-duration";

/* ------------------------------------------------------------------ the chart */

/**
 * The series, as the chart takes it.
 *
 * @param series The served days.
 * @returns One point per day: its label, its median in seconds, and the tooltip's detail.
 */
export function durationPoints(series: readonly DurationPoint[]): TimeSeriesPoint[] {
  return series.map((day) => ({
    label: dayLabel(day.day),
    value: day.medianSeconds,
    meta: `${durationSpan(day.medianSeconds)} median · ${count(day.builds, "build")}`,
  }));
}

/**
 * Where a change-point sits on the series.
 *
 * @param series The served days, oldest first.
 * @param date The change-point's day.
 * @returns The index of that day's point — or of the first day after it with builds, when the
 *   series has none on the day itself; `-1` when the series ends before it.
 */
export function markerIndex(series: readonly DurationPoint[], date: string): number {
  return series.findIndex((day) => day.day >= date);
}

/**
 * The chips — one per change-point the series reaches, and none from anything else.
 *
 * @param chart The chart.
 * @returns The markers the time series draws.
 */
export function durationMarkers(chart: DurationChart): TimeSeriesMarker[] {
  return chart.changePoints.flatMap((point) => {
    const index = markerIndex(chart.series, point.date);
    if (index < 0) return [];

    return [
      {
        id: point.id,
        index,
        label: chipLabel(point),
        description: chipDescription(point),
        tone: changeTone(point.deltaSeconds),
      },
    ];
  });
}

/** The steps a duration axis may count in, in seconds: 1 s to a day. */
const AXIS_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];

/** The most intervals a duration axis is cut into — the mockup's `3m` to `6m` is three. */
const AXIS_INTERVALS = 4;

/**
 * The smallest step an axis counts in, as a share of its longest duration — so a series that
 * barely moves is not magnified into a cliff: four-minute builds are never drawn second by second.
 */
const AXIS_FINEST = 1 / 20;

/**
 * A y-axis for durations: whole steps of a round size, around the data rather than from zero.
 *
 * The mockup's curve runs between 3½ and 5¾ minutes and its axis reads `3m 4m 5m 6m`; from zero the
 * same shifts would be a third the height. The floor is therefore the data's, rounded down to a
 * step, and the labels say so.
 *
 * @param values The series' values, in seconds.
 * @returns The domain and its ticks, written as durations; `undefined` for an empty series.
 */
export function durationAxis(values: readonly number[]): TimeSeriesAxis | undefined {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (finite.length === 0) return undefined;

  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const step =
    AXIS_STEPS.find(
      (size) =>
        size >= high * AXIS_FINEST &&
        Math.ceil(high / size) - Math.floor(low / size) <= AXIS_INTERVALS,
    ) ?? AXIS_STEPS[AXIS_STEPS.length - 1]!;
  const min = Math.floor(low / step) * step;
  // A series that sits exactly on a step still gets a plot with height.
  const max = Math.max(Math.ceil(high / step) * step, min + step);
  const ticks: number[] = [];

  for (let tick = min; tick <= max; tick += step) ticks.push(tick);

  return { min, max, ticks, format: durationSpan };
}

/**
 * Which days carry an x-tick: four of them, evenly spaced, as the mockup draws.
 *
 * @param points How many points.
 * @returns The indices, ascending and unique.
 */
export function durationTicks(points: number): number[] {
  if (points <= 0) return [];

  const last = points - 1;

  return [...new Set([0, Math.round(last / 3), Math.round((2 * last) / 3), last])];
}

/**
 * The chart's accessible name: what the series is, where it runs, and how many shifts were found.
 * Each shift's own sentence is on its chip.
 *
 * @param chart The chart, with at least one day in its series.
 * @returns E.g. `Median zephyr build duration per day, Jul 6 – Oct 2: between 3m 21s and 5m 53s,
 *   ending at 4m 05s. 3 detected change-points.`
 */
export function durationChartLabel(chart: DurationChart): string {
  const values = chart.series.map((day) => day.medianSeconds);
  const first = chart.series[0]!;
  const last = chart.series[chart.series.length - 1]!;
  const subject = chart.durationLabel === null ? "build" : chart.durationLabel;
  const found = durationMarkers(chart).length;
  const shifts = found === 0 ? "No change-points detected" : `${count(found, "detected change-point")}`;

  return (
    `Median ${subject} duration per day, ${dayLabel(first.day)} – ${dayLabel(last.day)}: ` +
    `between ${durationSpan(Math.min(...values))} and ${durationSpan(Math.max(...values))}, ` +
    `ending at ${durationSpan(last.medianSeconds)}. ${shifts}.`
  );
}

/* ------------------------------------------------------------------ the Details sheet */

/** The sheet's heading over the top candidate — the honest wording the issue asks for. */
export const ATTRIBUTED_HEADING = "Attributed to (top candidate)";

/** The sentence under it. */
export const RANKING_NOTE =
  "A ranking, not a verdict. The analyzer scores every recorded change inside the window by how close it was and how plausible that kind of change is — it does not establish a cause. The alternatives are below.";

/** What the top-candidate slot says when nothing recorded was in reach. */
export const UNATTRIBUTED_NOTE =
  "No recorded change within the window. The shift is real — it was detected in the durations — but nothing the analyzer knows of explains it.";

/** The sheet's other headings. */
export const SHEET_HEADINGS = {
  candidates: "Ranked candidates",
  window: "Attribution window",
  confidence: "Confidence",
  evidence: "Evidence",
} as const;

/** What the window slot says for an analyzer version whose window is not known. */
export const NO_WINDOW = "Not recorded for this analyzer version.";

/**
 * A day `offset` days from another.
 *
 * @param day An ISO date.
 * @param offset Days to add; negative for before.
 * @returns The ISO date, or the input unchanged when it is not a date.
 */
export function shiftDay(day: string, offset: number): string {
  const at = Date.parse(`${day}T00:00:00Z`);

  return Number.isNaN(at) ? day : new Date(at + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The sheet's eyebrow — `Change-point · Jul 13`.
 *
 * @param point The change-point.
 * @returns The eyebrow.
 */
export function sheetEyebrow(point: Pick<ChangePoint, "date">): string {
  return `Change-point · ${dayLabel(point.date)}`;
}

/**
 * The attribution window — `±3 days · Jul 10 – Jul 16`.
 *
 * @param point The change-point.
 * @returns The line, or {@link NO_WINDOW}.
 */
export function windowLine(point: Pick<ChangePoint, "date" | "attributionWindowDays">): string {
  const days = point.attributionWindowDays;
  if (days === null) return NO_WINDOW;

  const span = `${dayLabel(shiftDay(point.date, -days))} – ${dayLabel(shiftDay(point.date, days))}`;

  return `±${count(days, "day")} · ${span}`;
}

/**
 * The two segment medians — `4m 12s before → 5m 42s after`.
 *
 * @param point The change-point.
 * @returns The line, or `null` for a finding that recorded neither.
 */
export function segmentLine(
  point: Pick<ChangePoint, "beforeMedianSeconds" | "afterMedianSeconds">,
): string | null {
  const { beforeMedianSeconds: before, afterMedianSeconds: after } = point;
  if (before === null || after === null) return null;

  return `${durationSpan(before)} before → ${durationSpan(after)} after`;
}

/** What each kind of recorded change is called. */
const EVENT_WORDS: Readonly<Record<string, string>> = {
  merge: "merge",
  config_version: "config change",
  policy_version: "workflow version",
  env_recipe_version: "environment recipe",
  infra_event: "infrastructure change",
};

/**
 * How far from the breakpoint a candidate happened, in words.
 *
 * @param days Days from the breakpoint; negative is before.
 * @returns `same day`, `2 days before`, `1 day after`.
 */
export function offsetPhrase(days: number): string {
  if (days === 0) return "same day";

  return `${count(Math.abs(days), "day")} ${days < 0 ? "before" : "after"}`;
}

/**
 * A score, or one of its factors, to the precision the analyzer keeps — `0.70`, `0.175`.
 *
 * @param value The number.
 * @returns It with two decimals, or three when the third is not zero.
 */
export function scoreText(value: number): string {
  const fixed = value.toFixed(3);

  return fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
}

/** Where a piece of evidence opens. */
export interface EvidenceLink {
  /** `kind:id` — unique within a finding. */
  readonly key: string;
  /** `Merge`, `Build`, `Workflow version`, … */
  readonly kind: string;
  /** What it names, or its id when the row is gone. */
  readonly name: string;
  /** A merge's short sha; `null` for everything else. */
  readonly detail: string | null;
  /** The address it opens, or `null` when it opens nothing. */
  readonly href: string | null;
  /** The surface it opens on — `Build Farm` — or why it opens nothing. */
  readonly destination: string;
}

/** What each evidence kind is called. */
const EVIDENCE_WORDS: Readonly<Record<AnalysisEvidence["kind"], string>> = {
  build: "Build",
  test_run: "Test run",
  test_case: "Test case",
  waiver: "Waiver",
  merge: "Merge",
  workflow_version: "Workflow version",
  runner_pool: "Runner pool",
  runner: "Runner",
};

/** What a reference that opens nothing says instead of a destination. */
export const EVIDENCE_UNAVAILABLE = "no longer available to open";

/** How many characters of an id stand for it. */
const SHORT_ID = 7;

/**
 * Where one evidence reference opens.
 *
 * @param evidence The reference, as the service resolved it.
 * @returns Its name and address: a pull request's page, the workflow studio, the build farm — the
 *   runners card for a runner, the pools card for a pool — or a loop's test results, on the
 *   attempt, suite and case the reference names (#518). A reference whose row is gone keeps its id
 *   and opens nothing.
 */
export function evidenceLink(evidence: AnalysisEvidence): EvidenceLink {
  const base = {
    key: `${evidence.kind}:${evidence.id}`,
    kind: EVIDENCE_WORDS[evidence.kind],
    name: evidence.label ?? evidence.id.slice(0, evidence.kind === "merge" ? SHORT_ID : 8),
    detail:
      evidence.kind === "merge" && evidence.label !== null ? evidence.id.slice(0, SHORT_ID) : null,
  };

  if (evidence.surface === "pull_request" && evidence.pullRequestId !== null) {
    return {
      ...base,
      href: prPath(evidence.pullRequestId, BUILD_FARM_ORIGIN.id),
      destination: "Pull request",
    };
  }
  if (evidence.surface === "workflow" && evidence.workflowSlug !== null) {
    return { ...base, href: workflowPath(evidence.workflowSlug), destination: "Workflows" };
  }
  if (evidence.surface === "test_results" && evidence.runId !== null) {
    return {
      ...base,
      href: testsPath(evidence.runId, {
        from: BUILD_FARM_ORIGIN.id,
        ...(evidence.attempt === null ? {} : { attempt: evidence.attempt }),
        ...(evidence.suiteName === null ? {} : { suite: evidence.suiteName }),
        ...(evidence.caseName === null ? {} : { case: evidence.caseName }),
      }),
      destination: "Test results",
    };
  }
  if (evidence.surface === "farm") {
    const hash = { runner: FARM_RUNNERS_HASH, runner_pool: FARM_POOLS_HASH }[evidence.kind as string];

    return {
      ...base,
      href: hash === undefined ? BUILD_FARM_PATH : `${BUILD_FARM_PATH}#${hash}`,
      destination: "Build Farm",
    };
  }

  return { ...base, href: null, destination: EVIDENCE_UNAVAILABLE };
}

/**
 * Every evidence reference of a change-point, in its stored order.
 *
 * @param point The change-point.
 * @returns One link per reference.
 */
export function evidenceLinks(point: Pick<ChangePoint, "evidence">): EvidenceLink[] {
  return point.evidence.map(evidenceLink);
}

/** One row of the ranked candidate list. */
export interface CandidateRow {
  /** Its place in the ranking, from 1. */
  readonly rank: number;
  readonly label: string;
  /** `merge`, `infrastructure change`, … — `null` when the finding did not say. */
  readonly kind: string | null;
  /** `Jul 11 · 2 days before` — `null` when the finding did not say. */
  readonly when: string | null;
  /** `0.70`. */
  readonly score: string;
  /** `proximity 1.00 × prior 0.70` — `null` when the finding did not record the factors. */
  readonly factors: string | null;
  /** Where the evidence it cites opens, or `null` when the finding's evidence does not list it. */
  readonly link: EvidenceLink | null;
  /** Whether it is the *nothing recorded was in reach* placeholder. */
  readonly unattributed: boolean;
}

/**
 * The ranked candidate list — every candidate, in the analyzer's order, each with its score.
 *
 * @param point The change-point.
 * @returns One row per candidate, best first.
 */
export function candidateRows(point: Pick<ChangePoint, "candidates" | "evidence">): CandidateRow[] {
  return point.candidates.map((candidate, index) => {
    const cited = point.evidence.find(
      (evidence) => evidence.kind === candidate.ref.kind && evidence.id === candidate.ref.id,
    );
    const when = [
      candidate.date === null ? null : dayLabel(candidate.date),
      candidate.daysFromBreakpoint === null ? null : offsetPhrase(candidate.daysFromBreakpoint),
    ].filter((part) => part !== null);

    return {
      rank: index + 1,
      label: candidate.label,
      kind:
        candidate.eventKind === null
          ? null
          : (EVENT_WORDS[candidate.eventKind] ?? candidate.eventKind.replaceAll("_", " ")),
      when: when.length === 0 ? null : when.join(" · "),
      score: scoreText(candidate.score),
      factors:
        candidate.proximity === null || candidate.prior === null
          ? null
          : `proximity ${scoreText(candidate.proximity)} × prior ${scoreText(candidate.prior)}`,
      link: cited === undefined ? null : evidenceLink(cited),
      unattributed: isUnattributed(candidate),
    };
  });
}

/**
 * The confidence's basis, as sentences — what the analyzer's documented rule was computed from.
 *
 * @param point The change-point.
 * @returns One line per recorded input; empty for a finding that recorded none.
 */
export function confidenceLines(point: Pick<ChangePoint, "confidenceBasis">): string[] {
  const { sampleSize, effectSize, stability } = point.confidenceBasis;

  return [
    sampleSize === null
      ? null
      : `${count(sampleSize, "build")} in the two segments either side of the shift.`,
    effectSize === null
      ? null
      : `The shift is ${effectSize.toLocaleString("en-US", { maximumFractionDigits: 1 })}× the day-to-day noise within those segments.`,
    stability === null
      ? null
      : `${percentOf(stability)} of their days sit on their own segment's side of the midpoint between the two levels.`,
  ].filter((line) => line !== null);
}
