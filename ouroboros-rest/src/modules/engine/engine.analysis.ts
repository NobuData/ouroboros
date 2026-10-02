/**
 * `ouroboros-engine`'s Build Analyzer routes, mirrored — the analyzer set, the corpus, and the
 * event stream a run answers with (BV.1, [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * The engine half is BV.2's SPI and harness (#511) behind two `/v0` routes:
 *
 *   * `GET /v0/analysis/analyzers` — the registry as `analysis_runs.analyzer_set` stores it
 *     (`{label, analyzers: [{id, version, kind}]}`), read when a run starts so the run row names
 *     exactly the analyzers that will write into it;
 *   * `POST /v0/analysis/runs` — a corpus and a compute ceiling in, **newline-delimited JSON**
 *     out: one {@link AnalysisEvent} per line, written as each analyzer starts and ends, closed by
 *     a `report`. A stream that ends without its report is a run that crashed.
 *
 * **Two departures from `engine.contract.ts`'s conventions, both deliberate.**
 *
 *   * **The corpus is written in the engine's names.** It is the largest body this service sends
 *     anywhere — every build of ninety days, sampled log tails — and translating it key by key
 *     would hold two copies of it at once for no reader's benefit: nothing in this service reads
 *     a corpus after assembling it. So {@link EngineCorpus} *is* the wire shape, `snake_case`
 *     included, and the assembler builds it directly.
 *   * **A finding is passed through, not parsed into this service's names.** It is a row of
 *     `analysis_findings` already (#511 mirrors V081), and the database's own checks are what
 *     hold it to that contract when the orchestrator writes it. The schema below checks only what
 *     this service reads to route it: which analyzer, which version.
 */

import { z } from "zod";

import { ENGINE_API_VERSION } from "./engine.contract";

/** `GET` — the analyzers a run will dispatch to, in `analysis_runs.analyzer_set`'s shape. */
export const ENGINE_ANALYZERS_ROUTE = `${ENGINE_API_VERSION}/analysis/analyzers`;

/** `POST` — run every analyzer over one corpus, answering a stream of {@link AnalysisEvent}s. */
export const ENGINE_ANALYSIS_RUN_ROUTE = `${ENGINE_API_VERSION}/analysis/runs`;

/** The media type the run route answers in: one JSON document per line. */
export const NDJSON_MEDIA_TYPE = "application/x-ndjson";

/** An analyzer id, as V080's `analysis_analyzer_set_valid` accepts one. */
const ANALYZER_ID = /^[a-z][a-z0-9_]{0,62}$/;

/** One analyzer of a set. */
export interface AnalyzerEntry {
  id: string;
  version: number;
  kind: "deterministic" | "llm";
}

/** What `GET /v0/analysis/analyzers` answers — exactly what `analysis_runs.analyzer_set` stores. */
export interface AnalyzerSet {
  /** What *Analyzed by* renders, e.g. `deterministic analyzers v1`. */
  label: string;
  analyzers: AnalyzerEntry[];
}

/** The analyzer set, parsed. Same names on both sides: it is stored as the engine says it. */
export const analyzerSetSchema = z.object({
  label: z.string().trim().min(1),
  analyzers: z
    .array(
      z.object({
        id: z.string().regex(ANALYZER_ID),
        version: z.number().int().min(1),
        kind: z.enum(["deterministic", "llm"]),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------------------------------------
// The corpus — in the engine's names (see this file's header).
// ---------------------------------------------------------------------------------------------

/** A UTC day, `YYYY-MM-DD`. */
export type IsoDay = string;

/** One finished build of the duration series. */
export interface EngineBuildSample {
  build_id: string;
  day: IsoDay;
  duration_seconds: number;
}

/** An evidence reference, as V081 resolves one. */
export interface EngineEvidenceRef {
  kind: string;
  id: string;
}

/** A dated change attribution can rank. */
export interface EngineCandidateEvent {
  kind: "merge" | "config_version" | "policy_version" | "env_recipe_version" | "infra_event";
  day: IsoDay;
  label: string;
  ref: EngineEvidenceRef;
}

/** The end of one build's stored log. */
export interface EngineLogTail {
  build_id: string;
  day: IsoDay;
  label: string;
  status: "succeeded" | "failed" | "retried";
  /** Every line the build stored, read or not — `build_jobs.log_lines`. */
  line_count: number;
  /** The last lines, oldest first. */
  lines: string[];
}

/** One test case that did not simply pass. */
export interface EngineTestCase {
  test_run_id: string;
  build_id: string | null;
  day: IsoDay;
  suite: string;
  platform: string | null;
  case_key: string;
  status: "passed" | "failed" | "flaky" | "skipped";
  failure: string | null;
}

/** A case's current flake score. Not dated: it is a score over a rolling window. */
export interface EngineFlakeScore {
  case_key: string;
  score: number;
  state: string;
}

/** One stage's time in a loop. */
export interface EngineLoopStage {
  key: string;
  attempts: number;
  seconds: number;
}

/** One loop's stage timings and transcript statistics — never its transcript. */
export interface EngineLoop {
  run_id: string;
  day: IsoDay;
  status: string;
  stages: EngineLoopStage[];
  events: number;
  event_bytes: number;
}

/** A build's ccache summary. */
export interface EngineCacheStat {
  build_id: string;
  day: IsoDay;
  hits: number;
  misses: number;
}

/** A waiver written on one of the repository's loops. */
export interface EngineWaiver {
  waiver_id: string;
  run_id: string;
  day: IsoDay;
  case_keys: string[];
  reason: string;
}

/** One day of a rolled-up metric. */
export interface EngineSeriesPoint {
  day: IsoDay;
  dimension: string;
  value: number;
  samples: number[];
}

/** One reading of a rig's telemetry — the shape AJ.4 (#266) must produce. */
export interface EngineRigTelemetry {
  runner_id: string;
  day: IsoDay;
  metric: string;
  value: number;
}

/**
 * The corpus, as `POST /v0/analysis/runs` reads it. `null` is an **absent** source — the
 * engine skips any analyzer that requires it — and `[]` a present one in which nothing happened.
 */
export interface EngineCorpus {
  repo_ref: string;
  window: { from: IsoDay; to: IsoDay };
  builds: EngineBuildSample[] | null;
  events: EngineCandidateEvent[] | null;
  log_tails: EngineLogTail[] | null;
  tests: EngineTestCase[] | null;
  flakes: EngineFlakeScore[] | null;
  loops: EngineLoop[] | null;
  cache: EngineCacheStat[] | null;
  waivers: EngineWaiver[] | null;
  series: Record<string, EngineSeriesPoint[]> | null;
  rig_telemetry: EngineRigTelemetry[] | null;
}

/** The body of `POST /v0/analysis/runs`. */
export interface EngineAnalysisRequest {
  run_id: string;
  corpus: EngineCorpus;
  /** What is left of the run's compute ceiling, in seconds; the engine stops analyzers there. */
  compute_ceiling_seconds: number | null;
}

// ---------------------------------------------------------------------------------------------
// The event stream.
// ---------------------------------------------------------------------------------------------

/** How one analyzer's part of a run ended — the harness's vocabulary (#511). */
export const ANALYZER_OUTCOMES = [
  "completed",
  "skipped",
  "failed",
  "timed_out",
  "memory_exceeded",
  "not_run",
] as const;

/** One of {@link ANALYZER_OUTCOMES}. */
export type AnalyzerOutcomeStatus = (typeof ANALYZER_OUTCOMES)[number];

/**
 * A finding as the engine emitted it — a row of `analysis_findings` in all but its run. Only the
 * analyzer and version are read here; the rest is the database's to check (see the header).
 */
export const engineFindingSchema = z
  .object({
    analyzer: z.string(),
    analyzer_version: z.number().int(),
    finding_type: z.string(),
    subject_key: z.string(),
    data: z.unknown(),
    evidence_refs: z.unknown(),
    confidence: z.number(),
    confidence_basis: z.unknown(),
  })
  .passthrough();

/** A finding, as {@link engineFindingSchema} reads it. */
export type EngineFinding = z.infer<typeof engineFindingSchema>;

/** One analyzer's outcome, in this service's names. */
export interface AnalyzerOutcome {
  analyzer: string;
  version: number;
  status: AnalyzerOutcomeStatus;
  findings: EngineFinding[];
  reason: string | null;
  elapsedSeconds: number;
}

/** One line of the run's stream, in this service's names. */
export type AnalysisEvent =
  | { event: "started"; analyzer: string; version: number }
  | { event: "outcome"; outcome: AnalyzerOutcome }
  | { event: "report"; budgetExceeded: boolean; failed: string[] };

/** One line of the stream, parsed and translated. */
export const analysisEventSchema: z.ZodType<AnalysisEvent> = z.union([
  z
    .object({ event: z.literal("started"), analyzer: z.string(), version: z.number().int() })
    .transform((line) => ({
      event: "started" as const,
      analyzer: line.analyzer,
      version: line.version,
    })),
  z
    .object({
      event: z.literal("outcome"),
      outcome: z.object({
        analyzer: z.string(),
        version: z.number().int(),
        status: z.enum(ANALYZER_OUTCOMES),
        findings: z.array(engineFindingSchema).default([]),
        reason: z.string().nullable().optional(),
        elapsed_seconds: z.number().min(0).default(0),
      }),
    })
    .transform((line) => ({
      event: "outcome" as const,
      outcome: {
        analyzer: line.outcome.analyzer,
        version: line.outcome.version,
        status: line.outcome.status,
        findings: line.outcome.findings,
        reason: line.outcome.reason ?? null,
        elapsedSeconds: line.outcome.elapsed_seconds,
      },
    })),
  z
    .object({
      event: z.literal("report"),
      budget_exceeded: z.boolean(),
      failed: z.array(z.string()).default([]),
    })
    .transform((line) => ({
      event: "report" as const,
      budgetExceeded: line.budget_exceeded,
      failed: line.failed,
    })),
]);

/**
 * Split a byte stream into its lines, as they arrive.
 *
 * A line may straddle any number of chunks, and a multi-byte character the boundary between two;
 * the decoder is streaming for that reason. Blank lines are skipped. A last line without its
 * newline is still a line.
 *
 * @param body - The response body — or any sequence of byte chunks.
 * @returns Each non-blank line, without its newline, as soon as it is whole.
 */
export async function* ndjsonLines(
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });

    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line !== "") {
        yield line;
      }
      newline = pending.indexOf("\n");
    }
  }

  pending += decoder.decode();
  if (pending.trim() !== "") {
    yield pending.trim();
  }
}
