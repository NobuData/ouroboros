/**
 * Which picture the Build Analyzer page draws, and every sentence its cold states say (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521)) — pure, so the rule is a unit test on
 * a small value rather than an assertion about markup.
 *
 * Mockup 18 is the page with ninety days of history analysed. Most repositories do not start
 * there, and a page that drew an empty chart and a strip of zeros for them would teach that the
 * feature does not work. So the page first asks one question of the service's corpus read
 * (`GET /api/v1/analyzer/corpus`): **was the newest analysis that ended derived from enough
 * history?**
 *
 * | newest ended run's corpus | current corpus | the page draws |
 * |---|---|---|
 * | at or above the floor | any | **results** — the seven regions |
 * | none, or below | below | **insufficient** — the count, the floor, what is read |
 * | none, or below | at or above | **never run** — the explainer and a call to action |
 *
 * The floor is the service's (`minimumDaysWithBuilds`); nothing here restates it. A run in flight,
 * a failed one and a budget stop are not states of their own: they are the progress panel, over
 * whichever of these holds — so results that came from enough history stay readable under a run
 * that failed, and a first run that failed still finds the call to action under it.
 *
 * **Framework-free**, as `app/analyzer/view.ts` is.
 */

import type { AnalysisRun, AnalyzerCorpus } from "@/app/api/analyzer";
import { coarseAgo } from "@/app/format";

import type { AnalyzerPage } from "./analyzer-poll";
import { analyzerHeadline, corpusHeadline, count } from "./view";

/* ------------------------------------------------------------------ the rule */

/** Which picture the page draws. */
export type PageState =
  /** The page has not been read: every region holds its place and claims nothing. */
  | "loading"
  /** Too little history for an analysis to be worth showing — and none that was. */
  | "insufficient"
  /** Enough history, and no analysis of it yet. */
  | "never-run"
  /** An analysis of enough history ended: the mockup's page. */
  | "results";

/**
 * Which picture the page draws.
 *
 * @param page The page, or `null` before it is read.
 * @returns The state — see the table in this file's header.
 */
export function pageState(page: AnalyzerPage | null): PageState {
  if (page === null) return "loading";
  if (page.corpus.analyzed?.sufficient === true) return "results";

  return page.corpus.sufficient ? "never-run" : "insufficient";
}

/**
 * Whether the page is in one of its two cold states — the ones that draw a panel in place of the
 * result cards.
 *
 * @param state The page's state.
 * @returns True for `insufficient` and `never-run`.
 */
export function isCold(state: PageState): boolean {
  return state === "insufficient" || state === "never-run";
}

/**
 * Which of the side column's work cards are drawn. Over results (and while unread) both are. In a
 * cold state each stays only where it holds something a person made: a drafted batch — possibly
 * half pushed — and an applied suggestion's measurement must not vanish with the chart.
 *
 * @param page The page, or `null` before it is read.
 * @returns Whether the drafted-tickets card and the predicted-vs-measured card are drawn.
 */
export function sideCards(page: AnalyzerPage | null): { tickets: boolean; measurements: boolean } {
  if (page === null || !isCold(pageState(page))) return { tickets: true, measurements: true };

  return {
    tickets: page.tickets.batches.length > 0,
    measurements: page.measurements.measurements.length > 0,
  };
}

/* ------------------------------------------------------------------ the head */

/** The headline before the page is read — a state, not a claim about the repository. */
export const HEADLINE_UNREAD = "Reading the analyzer…";

/**
 * The page's headline.
 *
 * @param page The page, or `null` before it is read.
 * @returns What the state is, in one sentence: the mockup's *Your last 1,284 builds have
 *   opinions.* over results — slot-filled from the newest run's manifest, or from the analysed
 *   corpus when that run has none — and the cold states' own titles otherwise.
 */
export function pageHeadline(page: AnalyzerPage | null): string {
  if (page === null) return HEADLINE_UNREAD;

  const { corpus, run } = page;

  switch (pageState(page)) {
    case "insufficient":
      return `${INSUFFICIENT_TITLE}.`;
    case "never-run":
      return run?.status === "running" ? analyzerHeadline(run) : `${neverRunTitle(corpus)}.`;
    default:
      return run?.manifest == null && corpus.analyzed !== null
        ? corpusHeadline(corpus.analyzed.builds, corpus.window.days)
        : analyzerHeadline(run);
  }
}

/* ------------------------------------------------------------------ insufficient */

/** The insufficient state's title, as the roadmap words it. */
export const INSUFFICIENT_TITLE = "The analyzer needs more history";

/**
 * How much history a corpus holds — *7 builds on 5 days in the last 90.*
 *
 * @param history The builds and the days they finished on.
 * @param days The window's length.
 * @returns The sentence; a corpus with no build at all says so.
 */
export function historyLine(
  history: Pick<AnalyzerCorpus, "builds" | "daysWithBuilds">,
  days: number,
): string {
  if (history.builds === 0) return `No builds in the last ${count(days, "day")}.`;

  return `${count(history.builds, "build")} on ${count(history.daysWithBuilds, "day")} in the last ${days}.`;
}

/**
 * The floor, as a sentence — the service's number, never one written here.
 *
 * @param corpus The corpus state.
 * @returns *It needs builds on at least 10 days before it can tell a shift from noise.*
 */
export function floorLine(corpus: Pick<AnalyzerCorpus, "minimumDaysWithBuilds">): string {
  return `It needs builds on at least ${count(corpus.minimumDaysWithBuilds, "day")} before it can tell a shift from noise.`;
}

/**
 * What the newest ended analysis read, when that was too little — said so nobody wonders where
 * its chart went.
 *
 * @param corpus The corpus state.
 * @returns The sentence, or `null` when no analysis ended or the one that did read enough.
 */
export function thinAnalysisLine(corpus: Pick<AnalyzerCorpus, "analyzed">): string | null {
  const { analyzed } = corpus;
  if (analyzed === null || analyzed.sufficient) return null;

  return analyzed.builds === 0
    ? "The last analysis found no builds to read, so it has nothing to show."
    : `The last analysis read ${count(analyzed.builds, "build")} on ${count(analyzed.daysWithBuilds, "day")} — too little to show a chart or suggestions from.`;
}

/** An analysis may still be started on a thin corpus; this says what that will and will not do. */
export const THIN_RUN_NOTE =
  "An analysis can still be run, but its chart and suggestions are shown only once that history exists.";

/** The label over what the analyzer reads. */
export const READS_LABEL = "What it reads";

/** What the analyzer reads, for a repository it has not read yet. */
export const READS_LINE =
  "Every build's log and test results, and every loop's transcript — and rig telemetry where the deployment exports it.";

/* ------------------------------------------------------------------ never run */

/** The never-run state's title. */
export const NEVER_RUN_TITLE = "No analysis has run here yet";

/** Its title where an analysis did run, on too little, and the history has since grown. */
export const GROWN_TITLE = "There is enough history to analyse now";

/**
 * The never-run state's title.
 *
 * @param corpus The corpus state.
 * @returns {@link NEVER_RUN_TITLE}, or {@link GROWN_TITLE} when a thin analysis came before.
 */
export function neverRunTitle(corpus: Pick<AnalyzerCorpus, "analyzed">): string {
  return corpus.analyzed === null ? NEVER_RUN_TITLE : GROWN_TITLE;
}

/** What a first analysis produces — the page it will draw, in one sentence. */
export const FIRST_RUN_NOTE =
  "An analysis charts build duration with the shifts it detects, suggests changes to how builds run and to the workflows, and drafts tickets — each with the evidence behind it.";

/** The call to action's label. Not the head's *Run analysis now*: two controls, two names. */
export const FIRST_RUN_LABEL = "Run the first analysis";

/** The call to action's label where an analysis ran before, on too little. */
export const NEW_RUN_LABEL = "Run a new analysis";

/**
 * The call to action's label.
 *
 * @param corpus The corpus state.
 * @returns {@link FIRST_RUN_LABEL}, or {@link NEW_RUN_LABEL} when a thin analysis came before.
 */
export function ctaLabel(corpus: Pick<AnalyzerCorpus, "analyzed">): string {
  return corpus.analyzed === null ? FIRST_RUN_LABEL : NEW_RUN_LABEL;
}

/** Why the call to action is inert while an analysis is in flight. */
export const RUN_IN_FLIGHT_REASON = "An analysis is running — its progress is above.";

/* ------------------------------------------------------------------ the progress panel */

/**
 * What the cards under the progress panel show, when that is not simply "this run's results" —
 * the one sentence that keeps a run in flight, a failed run and a budget stop from being read as
 * the source of what is drawn below them.
 *
 * @param run The newest run.
 * @param corpus The corpus state — which run's results the page holds.
 * @param now The clock.
 * @returns The sentence, or `null` for a complete run, or when no results are drawn at all.
 */
export function shownResultsLine(run: AnalysisRun, corpus: AnalyzerCorpus, now: Date): string | null {
  const { analyzed } = corpus;
  if (run.status === "complete" || analyzed === null || !analyzed.sufficient) return null;

  // A budget stop that judged its corpus is itself the newest analysis that ended.
  if (analyzed.runId === run.id) {
    return "The results below include what its finished analyzers found; anything from an analyzer that did not finish is an earlier analysis's.";
  }

  const since = coarseAgo(analyzed.analyzedAt, now);

  return run.status === "running"
    ? `The results below are the last finished analysis's, from ${since} — they stay until this one ends.`
    : `The results below are the last finished analysis's, from ${since} — this run changed none of them.`;
}
