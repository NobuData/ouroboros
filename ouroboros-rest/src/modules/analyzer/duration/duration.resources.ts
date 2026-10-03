/**
 * What `GET /api/v1/analyzer/duration` answers (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517))
 * — mockup 18's **Build duration · 90 days, with detected change-points** card and the Details
 * sheet behind each chip.
 *
 * Two things are published here and nothing is added to either:
 *
 *   * **the series** — BI's `build_duration` daily medians for the job label the analyzed corpus
 *     timed, over that corpus's window;
 *   * **the change-points** — the run's `change_point` findings as V081 stores them: the detected
 *     day, the measured delta, the two segment medians, **every ranked candidate with its score
 *     and the score's components**, the confidence with its basis, and the evidence references.
 *
 * The stored documents are the engine's, in `snake_case`; this file is where they become the API's
 * `camelCase`, key by key, so a key an analyzer adds is not published until it is named here. A
 * key V081 does not require (`before_median_seconds`, a candidate's `proximity`) is `null` when a
 * finding does not carry it — never a default that reads as a measurement.
 */

import type { EngineSeriesPoint } from "../../engine/engine.analysis";
import type { AnalysisRunRow } from "../analysis.repository";
import type { CorpusManifest } from "../corpus/corpus.manifest";
import type { EvidenceIds, FindingRow, ResolvedEvidence } from "./duration.repository";

/**
 * The attribution window, in days either side of a breakpoint, by change-point analyzer version.
 *
 * The engine's `changepoint.py` documents it as `attribution_window_days` and its ledger pins
 * the parameters per version, so a version's window never changes; a finding does not repeat it.
 * A version this service does not know has no window to state, and reads as `null`.
 */
export const ATTRIBUTION_WINDOW_DAYS: Readonly<Record<number, number>> = { 1: 3 };

/** The product surface an evidence reference opens on. */
export type EvidenceSurface = "farm" | "pull_request" | "workflow";

/** One evidence reference, with what it names and where it opens. */
export interface EvidenceResource {
  /** V081's kind — `build`, `merge`, `workflow_version`, `runner_pool`, `runner`, … */
  kind: string;
  /** A uuid, or a commit sha for a `merge`. */
  id: string;
  /**
   * What it names — `#412 · zephyr build`, a merge's title, `standard-fix v9`, a pool's or a
   * runner's name. Null when the row is no longer there, or the kind is not one this read opens.
   */
  label: string | null;
  /** Where it opens; null when it names nothing that can be opened. */
  surface: EvidenceSurface | null;
  /** The mirrored PR, exactly when `surface` is `pull_request`. */
  pullRequestId: string | null;
  /** The workflow's slug, exactly when `surface` is `workflow`. */
  workflowSlug: string | null;
}

/** One ranked attribution candidate. */
export interface ChangePointCandidateResource {
  label: string;
  /** 0–1; candidates are ranked by it, best first. */
  score: number;
  /** `merge`, `policy_version`, `infra_event`, … — null on the *unattributed* candidate. */
  eventKind: string | null;
  /** The day the candidate change happened. */
  date: string | null;
  /** Days from the breakpoint; negative is before it. */
  daysFromBreakpoint: number | null;
  /** The score's two factors: how close in time, and how plausible the kind. */
  proximity: number | null;
  prior: number | null;
  /** The evidence the candidate cites — one of the finding's `evidence`. */
  ref: { kind: string; id: string };
}

/** One detected change-point — a chip and its Details sheet. */
export interface ChangePointResource {
  /** The finding's id. */
  id: string;
  /** The analyzer version that detected it. */
  analyzerVersion: number;
  /** The first day of the new level, UTC. */
  date: string;
  /** The series it was detected on — `build.duration_median`. */
  metric: string;
  /** After minus before, in seconds; negative is faster. Never zero. */
  deltaSeconds: number;
  beforeMedianSeconds: number | null;
  afterMedianSeconds: number | null;
  /** Days either side of `date` in which a change is a candidate; null for an unknown version. */
  attributionWindowDays: number | null;
  /** Ranked, best first. Never empty. */
  candidates: ChangePointCandidateResource[];
  /** 0–100. */
  confidence: number;
  confidenceBasis: {
    method: string | null;
    sampleSize: number | null;
    effectSize: number | null;
    stability: number | null;
  };
  /** Every reference the finding cites, in its stored order. */
  evidence: EvidenceResource[];
}

/** One day of the series. */
export interface DurationPointResource {
  /** UTC day. */
  day: string;
  /** The day's median build duration, in seconds. */
  medianSeconds: number;
  /** How many builds the median is over. */
  builds: number;
}

/** The read: a repository's duration series and the change-points detected on it. */
export interface DurationChartResource {
  repo: string;
  /** The run whose findings annotate the series; null before one has detected change-points. */
  runId: string | null;
  /** When that run ended. */
  analyzedAt: string | null;
  /** The job label whose builds are timed — the corpus's `durationLabel`. */
  durationLabel: string | null;
  /** The run's corpus window; null with `runId`. */
  window: { from: string; to: string; days: number } | null;
  /** One point per day with builds, oldest first. */
  series: DurationPointResource[];
  /** Oldest breakpoint first. */
  changePoints: ChangePointResource[];
}

/** A stored JSON object, or an empty one for anything else. */
function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A stored JSON number, or null. */
function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A stored JSON string, or null. */
function textOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A stored `{kind, id}` reference; V081 holds every one to that shape. */
function refOf(value: unknown): { kind: string; id: string } {
  const ref = objectOf(value);

  return { kind: textOf(ref.kind) ?? "", id: textOf(ref.id) ?? "" };
}

/** A finding's evidence references, in their stored order. */
function refsOf(finding: Pick<FindingRow, "evidence_refs">): { kind: string; id: string }[] {
  return Array.isArray(finding.evidence_refs) ? finding.evidence_refs.map(refOf) : [];
}

/**
 * The references a set of findings cite, grouped for one resolving read.
 *
 * @param findings - The findings.
 * @returns Each resolvable kind's distinct ids. Kinds this read opens nowhere are left out.
 */
export function evidenceIds(findings: readonly Pick<FindingRow, "evidence_refs">[]): EvidenceIds {
  const ids: Record<keyof EvidenceIds, Set<string>> = {
    builds: new Set(),
    merges: new Set(),
    workflowVersions: new Set(),
    runnerPools: new Set(),
    runners: new Set(),
  };
  const groups: Readonly<Record<string, keyof EvidenceIds>> = {
    build: "builds",
    merge: "merges",
    workflow_version: "workflowVersions",
    runner_pool: "runnerPools",
    runner: "runners",
  };

  for (const ref of findings.flatMap(refsOf)) {
    const group = groups[ref.kind];
    if (group !== undefined) {
      ids[group].add(ref.id);
    }
  }

  return {
    builds: [...ids.builds],
    merges: [...ids.merges],
    workflowVersions: [...ids.workflowVersions],
    runnerPools: [...ids.runnerPools],
    runners: [...ids.runners],
  };
}

/** A reference that names nothing this read can open. */
function unresolved(ref: { kind: string; id: string }): EvidenceResource {
  return { ...ref, label: null, surface: null, pullRequestId: null, workflowSlug: null };
}

/**
 * One reference, with what it names and where it opens.
 *
 * @param ref - The stored reference.
 * @param resolved - What the workspace's rows answered.
 * @returns The resource. A merge opens on its mirrored PR when there is one and otherwise on the
 *   farm, whose build is how the commit is known at all.
 */
export function evidenceResource(
  ref: { kind: string; id: string },
  resolved: ResolvedEvidence,
): EvidenceResource {
  const onFarm = (label: string): EvidenceResource => ({
    ...unresolved(ref),
    label,
    surface: "farm",
  });

  switch (ref.kind) {
    case "build": {
      const build = resolved.builds.find((row) => row.id === ref.id);

      return build === undefined
        ? unresolved(ref)
        : onFarm(`#${String(build.number)} · ${build.label}`);
    }
    case "merge": {
      const merge = resolved.merges.find((row) => row.sha === ref.id);
      if (merge === undefined) {
        return unresolved(ref);
      }
      if (merge.pull_request_id !== null) {
        return {
          ...unresolved(ref),
          label: merge.title,
          surface: "pull_request",
          pullRequestId: merge.pull_request_id,
        };
      }

      return merge.title === null ? unresolved(ref) : onFarm(merge.title);
    }
    case "workflow_version": {
      const version = resolved.workflowVersions.find((row) => row.id === ref.id);

      return version === undefined
        ? unresolved(ref)
        : {
            ...unresolved(ref),
            label: `${version.slug} ${version.version === null ? "draft" : `v${String(version.version)}`}`,
            surface: "workflow",
            workflowSlug: version.slug,
          };
    }
    case "runner_pool":
    case "runner": {
      const rows = ref.kind === "runner_pool" ? resolved.runnerPools : resolved.runners;
      const named = rows.find((row) => row.id === ref.id);

      return named === undefined ? unresolved(ref) : onFarm(named.name);
    }
    default:
      return unresolved(ref);
  }
}

/**
 * One stored candidate, renamed.
 *
 * @param value - An element of the finding's `data.candidates`.
 * @returns The resource.
 */
function candidateResource(value: unknown): ChangePointCandidateResource {
  const candidate = objectOf(value);

  return {
    label: textOf(candidate.label) ?? "",
    score: numberOf(candidate.score) ?? 0,
    eventKind: textOf(candidate.event_kind),
    date: textOf(candidate.date),
    daysFromBreakpoint: numberOf(candidate.days_from_breakpoint),
    proximity: numberOf(candidate.proximity),
    prior: numberOf(candidate.prior),
    ref: refOf(candidate.ref),
  };
}

/**
 * One change-point finding, as the chart and its sheet read it.
 *
 * @param finding - The stored finding.
 * @param resolved - What its references name.
 * @returns The resource, its candidates in their stored — ranked — order.
 */
export function changePointResource(
  finding: FindingRow,
  resolved: ResolvedEvidence,
): ChangePointResource {
  const data = objectOf(finding.data);
  const basis = objectOf(finding.confidence_basis);

  return {
    id: finding.id,
    analyzerVersion: finding.analyzer_version,
    date: textOf(data.date) ?? "",
    metric: textOf(data.metric) ?? "",
    deltaSeconds: numberOf(data.delta_seconds) ?? 0,
    beforeMedianSeconds: numberOf(data.before_median_seconds),
    afterMedianSeconds: numberOf(data.after_median_seconds),
    attributionWindowDays: ATTRIBUTION_WINDOW_DAYS[finding.analyzer_version] ?? null,
    candidates: (Array.isArray(data.candidates) ? data.candidates : []).map(candidateResource),
    confidence: finding.confidence,
    confidenceBasis: {
      method: textOf(basis.method),
      sampleSize: numberOf(basis.sample_size),
      effectSize: numberOf(basis.effect_size),
      stability: numberOf(basis.stability),
    },
    evidence: refsOf(finding).map((ref) => evidenceResource(ref, resolved)),
  };
}

/**
 * One rolled-up day, in seconds.
 *
 * @param point - BI's row: the day's median in milliseconds and the samples it is over.
 * @returns The point.
 */
export function durationPointResource(point: EngineSeriesPoint): DurationPointResource {
  return {
    day: point.day,
    medianSeconds: Math.round(point.value) / 1000,
    builds: point.samples.length,
  };
}

/**
 * What a repository with no annotated run answers.
 *
 * @param repo - The repository.
 * @returns An empty chart: no run, no series, no change-points.
 */
export function emptyDurationChart(repo: string): DurationChartResource {
  return {
    repo,
    runId: null,
    analyzedAt: null,
    durationLabel: null,
    window: null,
    series: [],
    changePoints: [],
  };
}

/**
 * The chart, composed.
 *
 * @param run - The annotated run.
 * @param points - Its duration label's rolled-up days inside its window, oldest first.
 * @param findings - Its change-point findings, oldest breakpoint first.
 * @param resolved - What the findings' references name.
 * @returns The resource.
 */
export function durationChartResource(
  run: AnalysisRunRow,
  points: readonly EngineSeriesPoint[],
  findings: readonly FindingRow[],
  resolved: ResolvedEvidence,
): DurationChartResource {
  const manifest = run.corpus_manifest as CorpusManifest;

  return {
    repo: run.repo_ref,
    runId: run.id,
    analyzedAt: run.finished_at === null ? null : run.finished_at.toISOString(),
    durationLabel: manifest.duration_label ?? null,
    window: { from: manifest.window.from, to: manifest.window.to, days: manifest.window.days },
    series: points.map(durationPointResource),
    changePoints: findings.map((finding) => changePointResource(finding, resolved)),
  };
}
