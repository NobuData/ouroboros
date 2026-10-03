/**
 * What the Build Analyzer's run routes answer (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)) — one run, as mockup 18's head and meta
 * strip render it and as BW.1's progress states poll it.
 *
 * The stored documents (`corpus_manifest`, `analyzer_set`, `progress`) are V080/V086's, in the
 * database's `snake_case`; this file is where they become the API's `camelCase`, field by field, so
 * a key added to a stored document is not published until it is named here.
 */

import type { AnalysisPhase, AnalysisStatus, AnalysisTrigger } from "../db/schema";
import type { AnalyzerSet } from "../engine/engine.analysis";
import type { AnalyzerProgress, RunProgress } from "./analysis.progress";
import type { AnalysisRunRow } from "./analysis.repository";
import {
  COUNT_KEYS,
  type BudgetKey,
  type ConfidenceBasis,
  type ConfidenceLevel,
  type ConfidenceThreshold,
  type CorpusManifest,
  type CountKey,
  type SamplingRecord,
} from "./corpus/corpus.manifest";

/** A source's sampling record, in the API's names. */
export interface SamplingRecordResource {
  sampled: boolean;
  rate: number;
  /** `maxBuilds`, `maxLogLines` or `computeCeilingSeconds`; null when nothing bound it. */
  cap: "maxBuilds" | "maxLogLines" | "computeCeilingSeconds" | null;
}

/** The four counted sources, in the API's names. */
export interface CorpusCountsResource {
  builds: number;
  loops: number;
  logLines: number;
  hilSessions: number;
}

/** The corpus manifest — the meta strip's receipt. */
export interface CorpusManifestResource {
  window: { from: string; to: string; days: number };
  counts: CorpusCountsResource;
  sources: Record<keyof CorpusCountsResource, SamplingRecordResource>;
  budget: { maxBuilds: number; maxLogLines: number; computeCeilingSeconds: number };
  durationLabel: string | null;
  absent: { source: string; reason: string }[];
  /** Present once the run has ended. */
  analyzers: { completed: string[]; skipped: string[]; failed: string[]; notRun: string[] } | null;
  /** What produced the confidence note (#516); null on a run with no note or one older than it. */
  confidence: ConfidenceBasisResource | null;
}

/** One confidence level's bar, in the API's names. */
export interface ConfidenceThresholdResource {
  coverage: number;
  perDay: number;
}

/** The confidence note's computed basis — the strip's popover (BW.1, #516). */
export interface ConfidenceBasisResource {
  level: ConfidenceLevel;
  windowDays: number;
  builds: number;
  daysWithBuilds: number;
  coverage: number;
  perDay: number;
  rule: { high: ConfidenceThresholdResource; medium: ConfidenceThresholdResource };
}

/** One analyzer's progress. */
export interface AnalyzerProgressResource {
  id: string;
  version: number;
  status: AnalyzerProgress["status"];
  findings: number | null;
  elapsedSeconds: number | null;
  reason: string | null;
}

/** One analysis run. */
export interface AnalysisRunResource {
  id: string;
  repo: string;
  trigger: AnalysisTrigger;
  status: AnalysisStatus;
  /** The step a running run is in, or the one a finished run ended in. */
  phase: AnalysisPhase;
  progress: { analyzers: AnalyzerProgressResource[] };
  /** Null until assembly has stored it, and on a run that failed before it could. */
  manifest: CorpusManifestResource | null;
  analyzerSet: AnalyzerSet;
  startedAt: string;
  finishedAt: string | null;
  computeSeconds: number;
  /** Null unless an LLM pass ran (V080's provenance rule). */
  llmCostCents: number | null;
  confidenceNote: string | null;
  failureReason: string | null;
}

/** `GET /api/v1/analyzer/runs/latest` — the newest run, or none yet. */
export interface LatestAnalysisResource {
  run: AnalysisRunResource | null;
}

/** A count key in the API's names. */
const COUNT_NAMES: Record<CountKey, keyof CorpusCountsResource> = {
  builds: "builds",
  loops: "loops",
  log_lines: "logLines",
  hil_sessions: "hilSessions",
};

/** A budget key in the API's names. */
const CAP_NAMES: Record<BudgetKey, NonNullable<SamplingRecordResource["cap"]>> = {
  max_builds: "maxBuilds",
  max_log_lines: "maxLogLines",
  compute_ceiling_seconds: "computeCeilingSeconds",
};

/**
 * A sampling record, renamed.
 *
 * @param record - The stored record.
 * @returns It in the API's names.
 */
function samplingResource(record: SamplingRecord): SamplingRecordResource {
  return {
    sampled: record.sampled,
    rate: record.rate,
    cap: record.cap === null ? null : CAP_NAMES[record.cap],
  };
}

/**
 * A confidence threshold, renamed.
 *
 * @param bar - The stored bar.
 * @returns It in the API's names.
 */
function thresholdResource(bar: ConfidenceThreshold): ConfidenceThresholdResource {
  return { coverage: bar.coverage, perDay: bar.per_day };
}

/**
 * The stored confidence basis, renamed.
 *
 * @param basis - `corpus_manifest.confidence`.
 * @returns It in the API's names.
 */
export function confidenceBasisResource(basis: ConfidenceBasis): ConfidenceBasisResource {
  return {
    level: basis.level,
    windowDays: basis.window_days,
    builds: basis.builds,
    daysWithBuilds: basis.days_with_builds,
    coverage: basis.coverage,
    perDay: basis.per_day,
    rule: {
      high: thresholdResource(basis.rule.high),
      medium: thresholdResource(basis.rule.medium),
    },
  };
}

/**
 * The stored manifest, renamed.
 *
 * @param manifest - `analysis_runs.corpus_manifest`.
 * @returns It in the API's names.
 */
export function manifestResource(manifest: CorpusManifest): CorpusManifestResource {
  const counts = {} as CorpusCountsResource;
  const sources = {} as CorpusManifestResource["sources"];

  for (const key of COUNT_KEYS) {
    counts[COUNT_NAMES[key]] = manifest.counts[key];
    sources[COUNT_NAMES[key]] = samplingResource(manifest.sources[key]);
  }

  return {
    window: { ...manifest.window },
    counts,
    sources,
    budget: {
      maxBuilds: manifest.budget.max_builds,
      maxLogLines: manifest.budget.max_log_lines,
      computeCeilingSeconds: manifest.budget.compute_ceiling_seconds,
    },
    durationLabel: manifest.duration_label ?? null,
    absent: (manifest.absent ?? []).map((entry) => ({
      source: entry.source,
      reason: entry.reason,
    })),
    analyzers:
      manifest.analyzers === undefined
        ? null
        : {
            completed: manifest.analyzers.completed,
            skipped: manifest.analyzers.skipped,
            failed: manifest.analyzers.failed,
            notRun: manifest.analyzers.not_run,
          },
    confidence:
      manifest.confidence === undefined ? null : confidenceBasisResource(manifest.confidence),
  };
}

/**
 * One analyzer's progress, renamed.
 *
 * @param entry - The stored entry.
 * @returns It in the API's names.
 */
function progressResource(entry: AnalyzerProgress): AnalyzerProgressResource {
  return {
    id: entry.id,
    version: entry.version,
    status: entry.status,
    findings: entry.findings ?? null,
    elapsedSeconds: entry.elapsed_seconds ?? null,
    reason: entry.reason ?? null,
  };
}

/**
 * A run row, as the API answers it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function analysisRunResource(row: AnalysisRunRow): AnalysisRunResource {
  const progress = row.progress as RunProgress;

  return {
    id: row.id,
    repo: row.repo_ref,
    trigger: row.trigger,
    status: row.status,
    phase: row.phase,
    progress: { analyzers: progress.analyzers.map(progressResource) },
    manifest:
      row.corpus_manifest === null ? null : manifestResource(row.corpus_manifest as CorpusManifest),
    analyzerSet: row.analyzer_set as AnalyzerSet,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
    computeSeconds: row.compute_seconds,
    llmCostCents: row.llm_cost_cents,
    confidenceNote: row.confidence_note,
    failureReason: row.failure_reason,
  };
}
