/**
 * In-memory stand-ins for the orchestrator's collaborators (#510): a run store that behaves like
 * `analysis_runs` — the one-running guard, terminal statuses frozen, phases recorded — and an
 * engine that streams scripted events.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import type { AnalysisPhase } from "../db/schema";
import type {
  AnalysisEvent,
  AnalyzerSet,
  EngineAnalysisRequest,
  EngineFinding,
} from "../engine/engine.analysis";
import type { RunProgress } from "./analysis.progress";
import type {
  AnalysisRunRow,
  AnalysisScheduleRow,
  CountedBuild,
  InsertedRun,
  NewRun,
  RunEnding,
  WeeklySchedule,
} from "./analysis.repository";
import type { CorpusManifest } from "./corpus/corpus.manifest";

/** The analyzer set the fake engine reports. */
export const ANALYZER_SET: AnalyzerSet = {
  label: "deterministic analyzers v1",
  analyzers: [
    { id: "cache_window", version: 1, kind: "deterministic" },
    { id: "change_point", version: 1, kind: "deterministic" },
    { id: "log_signature", version: 1, kind: "deterministic" },
  ],
};

/**
 * A finding as the engine would emit one.
 *
 * @param analyzer - Which analyzer.
 * @param subject - Its subject key.
 * @returns The finding.
 */
export function finding(analyzer: string, subject: string): EngineFinding {
  return {
    analyzer,
    analyzer_version: 1,
    finding_type: "change_point",
    subject_key: subject,
    data: {},
    evidence_refs: [{ kind: "build", id: "b0000000-0000-4000-8000-000000000001" }],
    confidence: 80,
    confidence_basis: { method: "test", sample_size: 1, effect_size: 1, stability: 1 },
  };
}

/** Every write the fake run store saw, in order. */
export type RunWrite =
  | { kind: "insert"; id: string }
  | { kind: "analyzing"; id: string; manifest: CorpusManifest }
  | { kind: "progress"; id: string; progress: RunProgress; phase?: AnalysisPhase }
  | { kind: "findings"; id: string; analyzer: string; count: number }
  | { kind: "finish"; id: string; ending: RunEnding };

/** A run store with `analysis_runs`' rules and none of its SQL. */
export class FakeRunStore {
  readonly rows = new Map<string, AnalysisRunRow>();
  readonly writes: RunWrite[] = [];
  readonly findings: EngineFinding[] = [];
  schedules: AnalysisScheduleRow[] = [];
  /** Analyzers whose findings the "database" refuses. */
  refuse = new Set<string>();
  private sequence = 0;

  schedule(organizationId: string, repoRef: string): Promise<AnalysisScheduleRow | undefined> {
    return Promise.resolve(
      this.schedules.find(
        (row) => row.organization_id === organizationId && row.repo_ref === repoRef,
      ),
    );
  }

  insertRun(run: NewRun): Promise<InsertedRun> {
    const running = [...this.rows.values()].find(
      (row) =>
        row.organization_id === run.organizationId &&
        row.repo_ref === run.repoRef &&
        row.status === "running",
    );
    if (running !== undefined) {
      return Promise.resolve({ started: false, running });
    }

    this.sequence += 1;
    const id = `a0000000-0000-4000-8000-${this.sequence.toString().padStart(12, "0")}`;
    const row: AnalysisRunRow = {
      id,
      organization_id: run.organizationId,
      repo_ref: run.repoRef,
      trigger: run.trigger,
      schedule_id: run.scheduleId,
      status: "running",
      corpus_manifest: null,
      analyzer_set: run.analyzerSet,
      started_at: new Date("2026-08-08T13:00:00Z"),
      finished_at: null,
      compute_seconds: 0,
      llm_cost_cents: null,
      confidence_note: null,
      failure_reason: null,
      created_at: new Date("2026-08-08T13:00:00Z"),
      phase: "assembling",
      progress: run.progress,
    };
    this.rows.set(id, row);
    this.writes.push({ kind: "insert", id });

    return Promise.resolve({ started: true, run: { ...row } });
  }

  running(organizationId: string, repoRef: string): Promise<AnalysisRunRow | undefined> {
    return Promise.resolve(
      [...this.rows.values()].find(
        (row) =>
          row.organization_id === organizationId &&
          row.repo_ref === repoRef &&
          row.status === "running",
      ),
    );
  }

  run(organizationId: string, id: string): Promise<AnalysisRunRow | undefined> {
    const row = this.rows.get(id);
    return Promise.resolve(row?.organization_id === organizationId ? row : undefined);
  }

  latest(organizationId: string, repoRef: string): Promise<AnalysisRunRow | undefined> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.organization_id === organizationId && row.repo_ref === repoRef)
        .at(-1),
    );
  }

  analyzing(id: string, manifest: CorpusManifest): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== "running") {
      return Promise.resolve(false);
    }
    row.corpus_manifest = manifest;
    row.phase = "analyzing";
    this.writes.push({ kind: "analyzing", id, manifest });
    return Promise.resolve(true);
  }

  progress(id: string, progress: RunProgress, phase?: AnalysisPhase): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== "running") {
      return Promise.resolve(false);
    }
    row.progress = progress;
    if (phase !== undefined) {
      row.phase = phase;
    }
    this.writes.push({ kind: "progress", id, progress, ...(phase === undefined ? {} : { phase }) });
    return Promise.resolve(true);
  }

  writeFindings(
    run: Pick<AnalysisRunRow, "id">,
    findings: readonly EngineFinding[],
  ): Promise<number> {
    if (findings.length === 0) {
      return Promise.resolve(0);
    }
    const analyzer = findings[0].analyzer;
    if (this.refuse.has(analyzer)) {
      return Promise.reject(
        Object.assign(new Error("refused"), {
          code: "23514",
          constraint: "analysis_findings_evidence_resolves",
        }),
      );
    }
    this.findings.push(...findings);
    this.writes.push({ kind: "findings", id: run.id, analyzer, count: findings.length });
    return Promise.resolve(findings.length);
  }

  finish(id: string, ending: RunEnding): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== "running") {
      return Promise.resolve(false);
    }
    row.status = ending.status;
    if (ending.phase !== null) row.phase = ending.phase;
    if (ending.manifest !== null) row.corpus_manifest = ending.manifest;
    if (ending.progress !== null) row.progress = ending.progress;
    row.finished_at = new Date("2026-08-08T13:41:00Z");
    row.compute_seconds = ending.computeSeconds;
    row.confidence_note = ending.confidenceNote;
    row.failure_reason = ending.failureReason;
    this.writes.push({ kind: "finish", id, ending });
    return Promise.resolve(true);
  }

  jobRepo(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  countBuild(): Promise<CountedBuild | undefined> {
    return Promise.resolve(undefined);
  }

  rearm(): Promise<void> {
    return Promise.resolve();
  }

  weeklySchedules(): Promise<WeeklySchedule[]> {
    return Promise.resolve([]);
  }

  reapStale(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/** An engine whose stream is a script. */
export class FakeEngine {
  /** Every analysis request it was sent. */
  readonly requests: { request: EngineAnalysisRequest; deadlineMs: number }[] = [];
  /** The events it streams, in order. */
  script: AnalysisEvent[] = [];
  /** Thrown after the script, to model a stream that broke off. */
  breakWith?: Error;
  /** Thrown by `analyzerSet`, to model an engine that is down. */
  setFailure?: Error;
  /** Called between events, so a case can move the clock mid-stream. */
  between?: (event: AnalysisEvent) => void;

  analyzerSet(): Promise<AnalyzerSet> {
    return this.setFailure === undefined
      ? Promise.resolve(ANALYZER_SET)
      : Promise.reject(this.setFailure);
  }

  async analyze(
    request: EngineAnalysisRequest,
    deadlineMs: number,
    onEvent: (event: AnalysisEvent) => Promise<void>,
  ): Promise<void> {
    this.requests.push({ request, deadlineMs });
    for (const event of this.script) {
      this.between?.(event);
      await onEvent(event);
    }
    if (this.breakWith !== undefined) {
      throw this.breakWith;
    }
  }
}

/**
 * The complete stream for {@link ANALYZER_SET}: each analyzer started and completed with the given
 * findings, then a report.
 *
 * @param findings - Findings per analyzer id.
 * @param budgetExceeded - The report's flag.
 * @returns The script.
 */
export function completeScript(
  findings: Record<string, EngineFinding[]> = {},
  budgetExceeded = false,
): AnalysisEvent[] {
  return [
    ...ANALYZER_SET.analyzers.flatMap((analyzer): AnalysisEvent[] => [
      { event: "started", analyzer: analyzer.id, version: 1 },
      {
        event: "outcome",
        outcome: {
          analyzer: analyzer.id,
          version: 1,
          status: "completed",
          findings: findings[analyzer.id] ?? [],
          reason: null,
          elapsedSeconds: 1,
        },
      },
    ]),
    { event: "report", budgetExceeded, failed: [] },
  ];
}
