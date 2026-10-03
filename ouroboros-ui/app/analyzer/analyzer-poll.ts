/**
 * The Build Analyzer page's poll (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516))
 * — the I.8 poll family's loop over `GET /api/analyzer?repo=` on this origin.
 *
 * One payload per repository: the newest run (its status, phase, per-analyzer progress and
 * manifest) and the schedule with its live counter. While a run is in flight the hop asks to be
 * polled every {@link RUNNING_POLL_SECONDS} so *Run analysis now* shows real progress; otherwise
 * the family's default interval holds.
 */

import type { AnalysisRun, AnalysisSchedule } from "@/app/api/analyzer";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const ANALYZER_ENDPOINT = "/api/analyzer";

/** The query parameter naming the repository, `owner/name`. */
export const ANALYZER_REPO_PARAM = "repo";

/** How often a page with a running analysis is read again — fast enough for per-analyzer ticks. */
export const RUNNING_POLL_SECONDS = 3;

/** What is said when something answered and this client could not read it as the page. */
export const UNREADABLE_ANALYZER = "The Build Analyzer could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_ANALYZER = "The Build Analyzer could not be reached.";

/** One repository's analyzer page: the newest run and the schedule. */
export interface AnalyzerPage {
  /** The repository, `owner/name`. */
  readonly repo: string;
  /** The newest run, or `null` before the first analysis. */
  readonly run: AnalysisRun | null;
  /** The schedule; `saved: false` when none was ever saved. */
  readonly schedule: AnalysisSchedule;
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
 * @returns True when it has a repository, a run or `null`, and a schedule.
 */
export function isAnalyzerPage(value: unknown): value is AnalyzerPage {
  if (typeof value !== "object" || value === null) return false;

  const { repo, run, schedule } = value as Partial<Record<keyof AnalyzerPage, unknown>>;

  return (
    typeof repo === "string" &&
    (run === null || (typeof run === "object" && run !== undefined)) &&
    typeof schedule === "object" &&
    schedule !== null
  );
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
