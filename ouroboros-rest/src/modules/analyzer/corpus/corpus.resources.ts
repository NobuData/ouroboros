/**
 * What `GET /api/v1/analyzer/corpus` answers (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521)) — how much history a repository
 * holds, how much the analyzer needs, and how much the last analysis that ended actually read.
 *
 * The page's cold states are this document rendered: *the analyzer needs more history* is
 * `sufficient: false`, with the count and the floor it states; *no analysis yet* is
 * `analyzed: null` over a corpus that is sufficient.
 */

import type { AnalysisRunRow } from "../analysis.repository";
import {
  corpusSufficient,
  MINIMUM_DAYS_WITH_BUILDS,
  type CorpusManifest,
  type CorpusWindow,
} from "./corpus.manifest";

/** How much history a corpus held. */
export interface CorpusHistoryResource {
  /** Builds that finished inside the window. */
  builds: number;
  /** Days of the window on which at least one build finished. */
  daysWithBuilds: number;
  /** Whether that is at or above the floor. */
  sufficient: boolean;
}

/** The corpus of the newest run that ended having judged it. */
export interface AnalyzedCorpusResource extends CorpusHistoryResource {
  runId: string;
  /** When that run ended. */
  analyzedAt: string;
}

/** A repository's corpus, as it stands and as it was last analysed. */
export interface CorpusStateResource extends CorpusHistoryResource {
  repo: string;
  /** The window a run started now would read. */
  window: CorpusWindow;
  /** The floor: the fewest days with a build before an analysis is shown. */
  minimumDaysWithBuilds: number;
  /** What the newest ended run read, or null before one has ended. */
  analyzed: AnalyzedCorpusResource | null;
}

/**
 * A corpus's history, judged.
 *
 * @param builds - Builds inside the window.
 * @param daysWithBuilds - Days of it with a build.
 * @returns Both, and whether they clear the floor.
 */
function history(builds: number, daysWithBuilds: number): CorpusHistoryResource {
  return { builds, daysWithBuilds, sufficient: corpusSufficient(daysWithBuilds) };
}

/**
 * What a judged run read, in the API's names.
 *
 * @param run - A run that ended with a confidence basis, or undefined.
 * @returns Its corpus, or null when there is no such run — or it stored no basis after all.
 */
export function analyzedCorpusResource(
  run: AnalysisRunRow | undefined,
): AnalyzedCorpusResource | null {
  const basis = (run?.corpus_manifest as CorpusManifest | null | undefined)?.confidence;
  if (run === undefined || basis === undefined || run.finished_at === null) {
    return null;
  }

  return {
    runId: run.id,
    analyzedAt: run.finished_at.toISOString(),
    ...history(basis.builds, basis.days_with_builds),
  };
}

/**
 * The whole answer.
 *
 * @param repo - The repository asked about.
 * @param window - The window a run started now would read.
 * @param counts - What lies inside it; zeros for a repository the workspace has none of.
 * @param run - The newest judged run, or undefined.
 * @returns The document.
 */
export function corpusStateResource(
  repo: string,
  window: CorpusWindow,
  counts: { builds: number; daysWithBuilds: number },
  run: AnalysisRunRow | undefined,
): CorpusStateResource {
  return {
    repo,
    window: { ...window },
    ...history(counts.builds, counts.daysWithBuilds),
    minimumDaysWithBuilds: MINIMUM_DAYS_WITH_BUILDS,
    analyzed: analyzedCorpusResource(run),
  };
}
