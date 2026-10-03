/**
 * Every decision the accountability cards make, and every sentence they say (BW.5,
 * [#520](https://github.com/NobuData/ouroboros/issues/520), mockup 18's **Predicted vs measured**
 * and **How it works**) — pure, so each honesty rule is a unit test on a small value rather than
 * an assertion about markup.
 *
 * ### A miss is drawn like a win
 *
 * The under-delivered row is the point of the card. Every closed measurement gets the same row —
 * name, predicted, measured — at the same weight; only the measured figure's hue and the note
 * under it say how it went. Nothing is filtered, collapsed or muted.
 *
 * ### Four outcomes, and one that is not an outcome yet
 *
 * | verdict | measured line | under the row |
 * |---|---|---|
 * | `delivered` | the measured change, `✓` | — |
 * | `under`, `over` | the measured change, in the warning hue | the service's composed note |
 * | `confounded` | the measured change, marked *confounded* | the note, then what interfered, each dated and linked |
 * | `pending` | `day N of 14` | which metric is being measured |
 *
 * A confounded measurement has not under-delivered or delivered: it is unattributable, and is
 * never drawn as any of the clean three.
 *
 * ### "Retrains" is one multiplier, and the popover shows it
 *
 * {@link recalibrationCells} lays out the service's own calibration cells: the analyzer and impact
 * class, the factor in effect, each update that moved it and the measurements that update cited —
 * beside the formula the service states. Nothing here computes a factor.
 *
 * ### The explainer describes the run that happened
 *
 * {@link ingestLine} is composed from the newest run's corpus manifest: a class the corpus held
 * nothing of says so, and a source the deployment does not have is listed as **not read**, with
 * the manifest's own reason — never as something ingested.
 *
 * **Framework-free**, as `app/analyzer/view.ts` is.
 */

import type {
  AnalysisManifest,
  CalibrationCell,
  DurationChart,
  Measurement,
  Measurements,
} from "@/app/api/analyzer";
import { dayLabel } from "@/app/insights/series-view";
import { SECURITY_MODEL_URL } from "@/app/providers/view";

import { DURATION_ANCHOR, chipLabel } from "./duration-view";
import { MEASUREMENTS_ANCHOR, figure, impactAmount } from "./suggestions-view";
import { count } from "./view";

/* ------------------------------------------------------------------ the card */

/** The card's title, as the mockup names it (the card head upper-cases it). */
export const MEASUREMENTS_TITLE = "Predicted vs measured";

/** The card head's tag, verbatim from the mockup. */
export const MEASUREMENTS_TAG = "applied earlier";

/**
 * The id the card's heading answers to — where an applied suggestion's row links
 * (`suggestions-view.ts`, which named it before this card existed).
 */
export { MEASUREMENTS_ANCHOR };

/** The window a measurement runs for when the page holds none to say otherwise (V085's default). */
export const DEFAULT_WINDOW_DAYS = 14;

/** What the card says instead of an empty frame. */
export const NO_MEASUREMENTS = {
  title: "Nothing applied yet",
  note: "When a suggestion is applied, what it predicted is frozen here and the metric it targets is measured over the following days — then the two are set side by side, whichever way it went.",
} as const;

/**
 * The card's rows — every measurement, **oldest apply first**, as the mockup orders its pair; a
 * suggestion applied today is the last row.
 *
 * @param measurements The page's measurements (the service answers newest first).
 * @returns A sorted copy. Two applied in the same instant keep the service's order, reversed.
 */
export function measurementRows(measurements: Pick<Measurements, "measurements">): Measurement[] {
  return [...measurements.measurements].reverse().sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
}

/**
 * The id a row answers to — where a confound naming that application links.
 *
 * @param id The measurement.
 * @returns The element id.
 */
export function measurementAnchor(id: string): string {
  return `measurement-${id}`;
}

/**
 * When a row's suggestion was applied — the mockup's `(applied Jul 2)`.
 *
 * @param measurement The measurement.
 * @returns The parenthesis.
 */
export function appliedLabel(measurement: Pick<Measurement, "appliedOn">): string {
  return `(applied ${dayLabel(measurement.appliedOn)})`;
}

/** The two lines' labels, verbatim from the mockup. */
export const LINE_LABELS = { predicted: "predicted", measured: "measured" } as const;

/**
 * What was predicted — `−3m 40s`, in the prediction's own unit.
 *
 * @param measurement The measurement.
 * @returns The signed amount.
 */
export function predictedText(measurement: Pick<Measurement, "predicted">): string {
  return impactAmount(measurement.predicted.delta, measurement.predicted.unit);
}

/* ------------------------------------------------------------------ verdicts */

/** How a row's measured line is treated. */
export type VerdictTone =
  /** Delivered: the success hue and a check. */
  | "ok"
  /** Under or over: the warning hue — as prominent as a success, never muted. */
  | "warn"
  /** Confounded: unattributable, and marked so — none of the clean three. */
  | "confounded"
  /** Pending: no verdict yet. */
  | "pending";

/**
 * How a verdict is treated.
 *
 * @param verdict The measurement's verdict.
 * @returns The treatment.
 */
export function verdictTone(verdict: Measurement["verdict"]): VerdictTone {
  if (verdict === "delivered") return "ok";
  if (verdict === "under" || verdict === "over") return "warn";

  return verdict === "confounded" ? "confounded" : "pending";
}

/** What each verdict is called — said beside a hue, so the hue is never the only signal. */
const VERDICT_WORDS: Readonly<Record<Measurement["verdict"], string>> = {
  pending: "pending",
  delivered: "delivered",
  under: "under-delivered",
  over: "over-delivered",
  confounded: "confounded",
};

/**
 * A verdict, in a word.
 *
 * @param verdict The measurement's verdict.
 * @returns `delivered`, `under-delivered`, `over-delivered`, `confounded` or `pending`.
 */
export function verdictWord(verdict: Measurement["verdict"]): string {
  return VERDICT_WORDS[verdict];
}

/** The mark a delivered measurement carries, as the mockup draws it. */
export const DELIVERED_MARK = "✓";

/** The mark a confounded measurement carries beside its figure. */
export const CONFOUNDED_MARK = "confounded";

/**
 * A row's measured line.
 *
 * @param measurement The measurement.
 * @returns `day 3 of 14` while it is pending; otherwise the measured change in the prediction's
 *   unit — `−3m 55s`. A closed row the service answered no result for (it should not) says so
 *   rather than drawing a figure.
 */
export function measuredText(measurement: Pick<Measurement, "verdict" | "day" | "windowDays" | "measured" | "predicted">): string {
  if (measurement.verdict === "pending") return `day ${measurement.day} of ${measurement.windowDays}`;
  if (measurement.measured === null) return "not recorded";

  return impactAmount(measurement.measured.delta, measurement.predicted.unit);
}

/** What each rolled-up metric is called. An id not listed is written with its underscores as spaces. */
const METRIC_NAMES: Readonly<Record<string, string>> = {
  build_duration: "build duration",
  queue_wait: "queue wait",
  human_interventions: "human interventions",
  cycle_time: "cycle time",
  stage_duration: "stage duration",
};

/** How each baseline statistic is written after its metric. */
const STATISTIC_NAMES: Readonly<Record<string, string>> = {
  median: "median",
  p95: "p95",
  weekly_sum: "per week",
};

/**
 * The metric a measurement is taken on, named — with how its window becomes one number and the
 * slice measured, when the baseline recorded them.
 *
 * @param measurement The measurement.
 * @returns `build duration (median)`, `queue wait (p95, pool-a)`, `cycle time`.
 */
export function targetText(measurement: Pick<Measurement, "targetMetric" | "baseline">): string {
  const name = METRIC_NAMES[measurement.targetMetric] ?? measurement.targetMetric.replace(/_/g, " ");
  const { statistic, dimension } = measurement.baseline;
  const detail = [
    statistic === undefined ? null : (STATISTIC_NAMES[statistic] ?? statistic),
    dimension === undefined || dimension === "" ? null : dimension,
  ].filter((part): part is string => part !== null);

  return detail.length === 0 ? name : `${name} (${detail.join(", ")})`;
}

/**
 * What a pending row says under its lines: which metric is being measured, and until when.
 *
 * @param measurement The open measurement.
 * @returns `measuring queue wait (p95, pool-a) until Oct 17`.
 */
export function pendingNote(measurement: Pick<Measurement, "targetMetric" | "baseline" | "windowEndsOn">): string {
  return `measuring ${targetText(measurement)} until ${dayLabel(measurement.windowEndsOn)}`;
}

/**
 * The line under a row: a pending row's target, the service's composed note, or — for a miss
 * closed without one — the verdict in a word, so a miss is never drawn bare.
 *
 * @param measurement The measurement.
 * @returns The line, or `null` where the row needs none: a delivered measurement, and a
 *   confounded one without a note (its mark and its list already say so).
 */
export function rowNote(measurement: Measurement): string | null {
  if (measurement.verdict === "pending") return pendingNote(measurement);
  if (measurement.note !== null && measurement.note.trim() !== "") return measurement.note;

  return verdictTone(measurement.verdict) === "warn" ? verdictWord(measurement.verdict) : null;
}

/* ------------------------------------------------------------------ confounds */

/** The heading over a confounded row's interfering events — the service's note comes before it. */
export const CONFOUNDS_HEADING = "What interfered:";

/** The same list under a row still pending: what has already landed inside its window. */
export const PENDING_CONFOUNDS_HEADING = "Already inside its window:";

/** One thing that interfered with a measurement. */
export interface ConfoundItem {
  /** `kind:id` — unique within a measurement. */
  readonly key: string;
  /** What it was, with its date — `applied Sep 3: ccache warm-up`. */
  readonly text: string;
  /** Where it is on this page, or `null` when the page no longer holds it. */
  readonly href: string | null;
}

/**
 * What interfered with a measurement — each named, dated and linked to where it is on the page.
 *
 * An **application** is another suggestion applied inside the window against the same metric: it
 * has a measurement of its own, so it is named by that row and links to it. A **change-point** is
 * a shift detected on the metric inside the window: it is named by the chart's chip for that day
 * (matched by the finding, else by the day — a later analysis re-detects the same shift under a
 * new finding) and links to the chart. One the page no longer holds keeps its date and links
 * nowhere — never to somewhere plausible.
 *
 * @param measurement The measurement.
 * @param measurements Every measurement of the page — where an interfering application is.
 * @param chart The duration chart — where an interfering change-point is.
 * @returns The items, in the order the service recorded them.
 */
export function confoundItems(
  measurement: Pick<Measurement, "confounds">,
  measurements: readonly Measurement[],
  chart: Pick<DurationChart, "changePoints"> | null,
): ConfoundItem[] {
  return measurement.confounds.map((confound) => {
    const key = `${confound.kind}:${confound.id}`;
    const when = dayLabel(confound.date);

    if (confound.kind === "application") {
      const other = measurements.find((candidate) => candidate.suggestionId === confound.id);

      return other === undefined
        ? { key, text: `another suggestion was applied ${when}`, href: null }
        : { key, text: `applied ${when}: ${other.title}`, href: `#${measurementAnchor(other.id)}` };
    }

    const points = chart?.changePoints ?? [];
    const point = points.find((candidate) => candidate.id === confound.id) ?? points.find((candidate) => candidate.date === confound.date);

    return point === undefined
      ? { key, text: `a change-point was detected ${when}`, href: null }
      : { key, text: `change-point ${chipLabel(point)}`, href: `#${DURATION_ANCHOR}` };
  });
}

/* ------------------------------------------------------------------ the caption and its popover */

/**
 * How long a measurement runs, for the caption: the newest measurement's own window, else V085's
 * default — so the sentence states what the rows show.
 *
 * @param measurements The page's measurements (newest first).
 * @returns The number of days.
 */
export function windowDays(measurements: Pick<Measurements, "measurements">): number {
  return measurements.measurements[0]?.windowDays ?? DEFAULT_WINDOW_DAYS;
}

/** The caption's word that opens the recalibration popover, verbatim from the mockup's sentence. */
export const RETRAINS_WORD = "retrains";

/**
 * The caption, verbatim from the mockup, around the word that opens the popover.
 *
 * @param days How long a measurement runs.
 * @returns What comes before `retrains`, and what comes after.
 */
export function captionParts(days: number): { before: string; after: string } {
  return {
    before: `Every applied suggestion is re-measured for ${count(days, "day")}. The analyzer's model `,
    after: " on its own misses.",
  };
}

/** The popover's heading. */
export const RECALIBRATION_HEADING = "How the analyzer recalibrates";

/** What "retrains" means here, said plainly before the arithmetic. */
export const RECALIBRATION_LEDE =
  "Each analyzer keeps one multiplier per kind of impact. When a measurement closes cleanly, the multiplier is recomputed from what was measured against what was predicted, and the next analysis scales its estimates by it.";

/** What the popover says when no cell exists yet. */
export const NO_RECALIBRATION =
  "No measurement has closed yet, so nothing has been recalibrated: every estimate is taken as made (× 1).";

/** One calibration cell, as the popover draws it. */
export interface RecalibrationCell {
  /** `analyzer/impactClass` — unique within the repository. */
  readonly key: string;
  /** `cache_window · duration_delta`. */
  readonly heading: string;
  /** `× 0.6545 now, from 1 closed measurement`. */
  readonly factor: string;
  /** Every update that moved it, newest first, each naming the measurements it added. */
  readonly history: readonly string[];
}

/**
 * The measurements an update cited, by name.
 *
 * @param ids The measurements' ids.
 * @param measurements The page's measurements.
 * @returns `ccache warm-up`, `Test-suite split and ccache warm-up`; a measurement the page no longer
 *   holds is counted rather than named.
 */
function citedNames(ids: readonly string[], measurements: readonly Measurement[]): string {
  const names = ids.flatMap((id) => measurements.find((candidate) => candidate.id === id)?.title ?? []);
  const missing = ids.length - names.length;
  const all = missing === 0 ? names : [...names, count(missing, "earlier measurement")];

  return all.length <= 1 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all.at(-1) ?? ""}`;
}

/**
 * One update of a factor, as a line: when, from what to what, and the formula's own two sums —
 * what was measured over what was predicted before any factor — with the measurements it added.
 *
 * The sums are written as the service holds them, not as spans: they are the formula's numerator
 * and denominator (a measurement far off its prediction is clamped before it is summed), and the
 * factor is exactly their quotient.
 *
 * @param entry The update.
 * @param measurements The page's measurements, to name the ones it added.
 * @returns `Sep 17 · × 1 → × 0.6545 = −72 ÷ −110 over 1 measurement — moved by ccache warm-up`.
 */
function historyLine(entry: CalibrationCell["history"][number], measurements: readonly Measurement[]): string {
  const moved = citedNames(entry.addedMeasurementIds, measurements);

  return (
    `${dayLabel(entry.createdAt.slice(0, 10))} · × ${figure(entry.fromFactor)} → × ${figure(entry.toFactor)} = ` +
    `${figure(entry.measuredSum)} ÷ ${figure(entry.predictedSum)} over ${count(entry.sampleCount, "measurement")}` +
    (moved === "" ? "" : ` — moved by ${moved}`)
  );
}

/**
 * The repository's calibration cells, as the popover draws them — the service's own numbers.
 *
 * @param measurements The page's measurements and calibration.
 * @returns One entry per cell, in the service's order.
 */
export function recalibrationCells(measurements: Measurements): RecalibrationCell[] {
  return measurements.calibration.map((cell) => ({
    key: `${cell.analyzer}/${cell.impactClass}`,
    heading: `${cell.analyzer} · ${cell.impactClass}`,
    factor: `× ${figure(cell.factor)} now, from ${count(cell.sampleCount, "closed measurement")}`,
    history: cell.history.map((entry) => historyLine(entry, measurements.measurements)),
  }));
}

/* ------------------------------------------------------------------ how it works */

/** The explainer's title, as the mockup names it. */
export const HOW_IT_WORKS_TITLE = "How it works";

/** The three steps' numbers and names, verbatim from the mockup. */
export const STEPS = [
  { number: "01", name: "Ingest" },
  { number: "02", name: "Correlate" },
  { number: "03", name: "Synthesize" },
] as const;

/** What the second step does, verbatim from the mockup. */
export const CORRELATE_LINE = "change-points ↔ merges, configs, infra events";

/** What the third step does, verbatim from the mockup. */
export const SYNTHESIZE_LINE = "process changes, workflow drafts, tickets — with evidence attached";

/** The source the manifest names when a deployment has no rig telemetry export. */
const RIG_TELEMETRY = "rig_telemetry";

/** What each source the corpus may lack is called. One not listed is written with spaces. */
const ABSENT_NAMES: Readonly<Record<string, string>> = { [RIG_TELEMETRY]: "rig telemetry" };

/** What follows a class the corpus held nothing of. */
export const NONE_IN_WINDOW = "none in this window";

/** What the ingest step says before any analysis has assembled a corpus. */
export const INGEST_BEFORE_A_RUN =
  "build logs, test results and loop transcripts — and rig telemetry where the deployment exports it. No analysis has assembled a corpus here yet.";

/** A source a run did not read, and why. */
export interface AbsentSource {
  /** The manifest's id for it. */
  readonly source: string;
  /** What it is called. */
  readonly name: string;
  /** The manifest's own reason. */
  readonly reason: string;
}

/** The ingest step, as the newest run's corpus manifest states it. */
export interface IngestLine {
  /** The classes read — the mockup's line, each class as the run found it. */
  readonly read: string;
  /** The sources the deployment does not have, each with the manifest's reason. */
  readonly absent: readonly AbsentSource[];
}

/**
 * The ingest step's line, from what the newest run actually read.
 *
 * The mockup's four classes, each tied to the manifest: **build logs** to the log lines the
 * window's builds stored, **test results** to the builds' own (read with them — the manifest keeps
 * no separate count), **loop transcripts** to its loops, and **rig telemetry** to its HIL
 * sessions. A class the window held none of says so; a source the manifest lists as absent is not
 * in the line at all — it is returned apart, with the manifest's reason.
 *
 * @param manifest The newest run's manifest, or `null` before a run has assembled a corpus.
 * @returns The line and the absent sources; {@link INGEST_BEFORE_A_RUN} and none before a run.
 */
export function ingestLine(manifest: AnalysisManifest | null): IngestLine {
  if (manifest === null) return { read: INGEST_BEFORE_A_RUN, absent: [] };

  const missing = new Set(manifest.absent.map((entry) => entry.source));
  const classes: readonly (readonly [name: string, held: number | null, source: string | null])[] = [
    ["build logs", manifest.counts.logLines, null],
    ["test results", null, null],
    ["loop transcripts", manifest.counts.loops, null],
    ["rig telemetry", manifest.counts.hilSessions, RIG_TELEMETRY],
  ];

  return {
    read: classes
      .filter(([, , source]) => source === null || !missing.has(source))
      .map(([name, held]) => (held === 0 ? `${name} (${NONE_IN_WINDOW})` : name))
      .join(", "),
    absent: manifest.absent.map((entry) => ({
      source: entry.source,
      name: ABSENT_NAMES[entry.source] ?? entry.source.replace(/_/g, " "),
      reason: entry.reason,
    })),
  };
}

/** What precedes each absent source under the ingest step. */
export const NOT_READ_LABEL = "not read";

/** The tenant-locality footer, verbatim from the mockup. */
export const LOCALITY_NOTE = "Runs on your build farm's data. Nothing leaves the tenant.";

/** The footer's link — it leaves the application, so it keeps its `↗`. */
export const LOCALITY_LINK = "How that is enforced ↗";

/**
 * Where the footer's claim is argued: the security model's section on the analyzer's corpus —
 * that assembly reads only the tenant's database, dispatch has one destination, and an analyzer
 * cannot reach the network.
 */
export const LOCALITY_URL = `${SECURITY_MODEL_URL}#66-the-build-analyzers-corpus-stays-on-the-tenant`;
