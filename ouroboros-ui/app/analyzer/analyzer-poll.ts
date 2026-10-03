/**
 * The Build Analyzer page's poll (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516))
 * — the I.8 poll family's loop over `GET /api/analyzer?repo=` on this origin.
 *
 * One payload per repository: the newest run (its status, phase, per-analyzer progress and
 * manifest), the schedule with its live counter, the duration chart — the series and the
 * change-points detected on it (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)),
 * which arrive together so a chip can never be drawn over a series it was not detected on — and
 * the suggestion cards (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)): the
 * current suggestions with the findings each cites and the calibration behind its impact — and
 * the drafted-tickets card (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)): the
 * ticket suggestions nobody has drafted, and the planning batches the rest went into. While a run
 * is in flight, or a drafted batch is still being sized, the hop asks to be polled every
 * {@link RUNNING_POLL_SECONDS} so progress is real; otherwise the family's default interval holds.
 */

import type {
  AnalysisRun,
  AnalysisSchedule,
  AnalysisSuggestions,
  AnalysisTickets,
  DurationChart,
} from "@/app/api/analyzer";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const ANALYZER_ENDPOINT = "/api/analyzer";

/** The query parameter naming the repository, `owner/name`. */
export const ANALYZER_REPO_PARAM = "repo";

/**
 * How often a page with something in flight is read again — a running analysis, or a drafted batch
 * the estimator is still sizing. Fast enough for per-analyzer ticks.
 */
export const RUNNING_POLL_SECONDS = 3;

/** What is said when something answered and this client could not read it as the page. */
export const UNREADABLE_ANALYZER = "The Build Analyzer could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_ANALYZER = "The Build Analyzer could not be reached.";

/** One repository's analyzer page: the newest run, the schedule, the chart and the cards. */
export interface AnalyzerPage {
  /** The repository, `owner/name`. */
  readonly repo: string;
  /** The newest run, or `null` before the first analysis. */
  readonly run: AnalysisRun | null;
  /** The schedule; `saved: false` when none was ever saved. */
  readonly schedule: AnalysisSchedule;
  /** The duration series and its change-points; empty before a run has detected any. */
  readonly duration: DurationChart;
  /** The suggestion cards' rows; none before an analysis has composed a suggestion. */
  readonly suggestions: AnalysisSuggestions;
  /** The drafted-tickets card; both lists empty before an analysis has composed a ticket. */
  readonly tickets: AnalysisTickets;
}

/** One read of the page, as the loop needs it. Replaced wholesale in tests. */
export type AnalyzerReader = PollReader<AnalyzerPage>;

/** How to build the page's poll. Everything is optional; production supplies none of it. */
export interface AnalyzerPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestAnalyzer} over the repository's address. */
  read?: AnalyzerReader;
}

/**
 * The address one repository's page is polled at.
 *
 * @param repo The repository, `owner/name`.
 * @returns `/api/analyzer?repo=owner%2Fname`.
 */
export function analyzerUrl(repo: string): string {
  return `${ANALYZER_ENDPOINT}?${ANALYZER_REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a parsed body is an analyzer page — enough of one that the screen can draw it.
 *
 * @param value The parsed body.
 * @returns True when it has a repository, a run or `null`, a schedule, a duration chart with its
 *   two lists, the suggestion cards with theirs, and the drafted-tickets card with its two.
 */
export function isAnalyzerPage(value: unknown): value is AnalyzerPage {
  if (typeof value !== "object" || value === null) return false;

  const { repo, run, schedule, duration, suggestions, tickets } = value as Partial<
    Record<keyof AnalyzerPage, unknown>
  >;

  return (
    typeof repo === "string" &&
    (run === null || (typeof run === "object" && run !== undefined)) &&
    typeof schedule === "object" &&
    schedule !== null &&
    isDurationChart(duration) &&
    isSuggestions(suggestions) &&
    isTickets(tickets)
  );
}

/**
 * Whether a parsed value is a duration chart — enough of one that the card can draw it.
 *
 * @param value The page's `duration`.
 * @returns True when it carries a series and a list of change-points.
 */
function isDurationChart(value: unknown): value is DurationChart {
  if (typeof value !== "object" || value === null) return false;

  const { series, changePoints } = value as Partial<Record<keyof DurationChart, unknown>>;

  return Array.isArray(series) && Array.isArray(changePoints);
}

/**
 * Whether a parsed value is the suggestion cards' content — enough of it that they can be drawn.
 *
 * @param value The page's `suggestions`.
 * @returns True when it carries a list of suggestions and a list of calibration cells.
 */
function isSuggestions(value: unknown): value is AnalysisSuggestions {
  if (typeof value !== "object" || value === null) return false;

  const { suggestions, calibration } = value as Partial<Record<keyof AnalysisSuggestions, unknown>>;

  return Array.isArray(suggestions) && Array.isArray(calibration);
}

/**
 * Whether a parsed value is the drafted-tickets card's content — enough of it to be drawn.
 *
 * @param value The page's `tickets`.
 * @returns True when it carries a list of un-drafted suggestions and a list of batches.
 */
function isTickets(value: unknown): value is AnalysisTickets {
  if (typeof value !== "object" || value === null) return false;

  const { undrafted, batches } = value as Partial<Record<keyof AnalysisTickets, unknown>>;

  return Array.isArray(undrafted) && Array.isArray(batches);
}

/**
 * One conditional read of the page over `fetch`.
 *
 * @param url The address, from {@link analyzerUrl}.
 * @returns The reader the loop calls.
 */
export function requestAnalyzer(url: string): AnalyzerReader {
  return (etag) =>
    requestPayload(url, etag, isAnalyzerPage, {
      unreachable: UNREACHABLE_ANALYZER,
      unreadable: UNREADABLE_ANALYZER,
    });
}

/**
 * The page's poll for one repository's address.
 *
 * @param url The address, from {@link analyzerUrl}.
 * @param options Test seams.
 * @returns The poll — not started; the store starts it on mount.
 */
export function createAnalyzerPoll(url: string, options: AnalyzerPollOptions = {}): Poll<AnalyzerPage> {
  return createPoll(options.read ?? requestAnalyzer(url), options);
}
