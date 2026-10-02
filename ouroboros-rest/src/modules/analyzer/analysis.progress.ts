/**
 * Per-analyzer progress — what makes the page's run states real rather than a spinner (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * `analysis_runs.progress` (V086) holds one entry per analyzer of the run's set, in the set's
 * order: `pending` until the engine starts it, `running` while it does, then how it ended. The
 * functions here are pure — each returns a new document — and the orchestrator stores every one
 * as it happens, so a person watching the run sees `change_point ✓ · log_signature …` tick over.
 */

import type {
  AnalyzerOutcome,
  AnalyzerOutcomeStatus,
  AnalyzerSet,
} from "../engine/engine.analysis";
import type { ManifestAnalyzers } from "./corpus/corpus.manifest";

/** An analyzer's state: not started, under way, or one of the harness's outcomes. */
export type AnalyzerState = "pending" | "running" | AnalyzerOutcomeStatus;

/** One analyzer's entry, in the stored names. */
export interface AnalyzerProgress {
  id: string;
  version: number;
  status: AnalyzerState;
  /** Findings written, once it completed. */
  findings?: number;
  elapsed_seconds?: number;
  /** A sentence, for anything that did not complete. */
  reason?: string;
}

/** `analysis_runs.progress`. */
export interface RunProgress {
  analyzers: AnalyzerProgress[];
}

/**
 * Every analyzer of a set, pending.
 *
 * @param set - The run's analyzer set.
 * @returns The starting document.
 */
export function pendingProgress(set: AnalyzerSet): RunProgress {
  return {
    analyzers: set.analyzers.map((analyzer) => ({
      id: analyzer.id,
      version: analyzer.version,
      status: "pending",
    })),
  };
}

/**
 * Replace one analyzer's entry.
 *
 * @param progress - The document.
 * @param id - The analyzer.
 * @param update - Its new entry, less id and version.
 * @returns The new document. An id the set does not name is appended, so an engine that ran an
 *   analyzer the run did not expect is visible rather than dropped.
 */
function withEntry(
  progress: RunProgress,
  id: string,
  version: number,
  update: Omit<AnalyzerProgress, "id" | "version">,
): RunProgress {
  const known = progress.analyzers.some((entry) => entry.id === id);
  const entries = known
    ? progress.analyzers.map((entry) =>
        entry.id === id ? { id, version: entry.version, ...update } : entry,
      )
    : [...progress.analyzers, { id, version, ...update }];

  return { analyzers: entries };
}

/**
 * An analyzer the engine has started.
 *
 * @param progress - The document.
 * @param id - The analyzer.
 * @param version - Its version.
 * @returns The new document.
 */
export function analyzerStarted(progress: RunProgress, id: string, version: number): RunProgress {
  return withEntry(progress, id, version, { status: "running" });
}

/**
 * An analyzer the engine has finished with, however it ended.
 *
 * @param progress - The document.
 * @param outcome - The engine's outcome.
 * @param written - Findings written for it; ignored unless it completed.
 * @returns The new document.
 */
export function analyzerEnded(
  progress: RunProgress,
  outcome: Pick<AnalyzerOutcome, "analyzer" | "version" | "status" | "reason" | "elapsedSeconds">,
  written: number,
): RunProgress {
  return withEntry(progress, outcome.analyzer, outcome.version, {
    status: outcome.status,
    elapsed_seconds: outcome.elapsedSeconds,
    ...(outcome.status === "completed" ? { findings: written } : {}),
    ...(outcome.reason === null || outcome.reason === undefined ? {} : { reason: outcome.reason }),
  });
}

/**
 * Every analyzer that never got to run, as `not_run`, with one reason — what a run that stopped
 * early says about the rest.
 *
 * @param progress - The document.
 * @param reason - Why they did not run.
 * @returns The new document; analyzers that had ended keep their outcome.
 */
export function remainingNotRun(progress: RunProgress, reason: string): RunProgress {
  return {
    analyzers: progress.analyzers.map((entry) =>
      entry.status === "pending" || entry.status === "running"
        ? { id: entry.id, version: entry.version, status: "not_run", reason }
        : entry,
    ),
  };
}

/**
 * Which analyzers completed and which did not — the manifest's `analyzers` record.
 *
 * @param progress - The final document.
 * @returns The ids under each heading, in set order. `timed_out` and `memory_exceeded` are
 *   failures for this purpose: neither produced findings.
 */
export function analyzerSummary(progress: RunProgress): ManifestAnalyzers {
  const ids = (states: readonly AnalyzerState[]): string[] =>
    progress.analyzers.filter((entry) => states.includes(entry.status)).map((entry) => entry.id);

  return {
    completed: ids(["completed"]),
    skipped: ids(["skipped"]),
    failed: ids(["failed", "timed_out", "memory_exceeded"]),
    not_run: ids(["not_run", "pending", "running"]),
  };
}
