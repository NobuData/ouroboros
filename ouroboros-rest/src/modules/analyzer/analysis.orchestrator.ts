/**
 * The Build Analyzer's run orchestrator — the one path every trigger takes (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), decisions **A2** and **A7**).
 *
 * ```
 * manual · weekly · every-N ─▶ start ─▶ guard (insert) ─┬─▶ 409, naming the running run
 *                                                       └─▶ assembling ─▶ analyzing ─▶ composing ─▶ terminal
 * ```
 *
 * {@link AnalysisOrchestrator.start} does what a caller waits for — the repository, the budget,
 * the analyzer set, the guarded insert — and returns the new run. Everything after runs in the
 * background, and every step is written to the run row as it happens, so `GET` on the run is the
 * progress API:
 *
 *   1. **assembling** — the corpus is read within the run's budgets (`corpus.assembler.ts`). The
 *      manifest is stored as soon as it exists.
 *   2. **analyzing** — the corpus goes to the engine (`EngineClient.analyze`); each analyzer's
 *      start and end tick its entry in `progress`, and a completed analyzer's findings are written
 *      **as it completes**, so a run that stops later keeps them.
 *   3. **composing** — the run's outcome is decided and its confidence note computed. (BV.4's
 *      suggestion composer, #513, attaches here.)
 *
 * **Terminal states are honest about why.** `complete` — every analyzer had its turn (one that
 * failed on its own is recorded as failed in `progress`; BV.2's isolation). `budget_exceeded` — the
 * compute ceiling stopped the run during assembly or analysis; the findings of the analyzers that
 * finished are **kept**, and the manifest and the reason name the ones that did not run. `failed` —
 * the run itself broke (the engine unreachable, its stream cut off, assembly erroring), with the
 * reason.
 *
 * **On-tenant.** The corpus is handed to `EngineClient` and nothing else: that client's base URL is
 * the deployment's own engine (`OURO_ENGINE_URL`), and no other code path here makes a network
 * call. `docs/SECURITY_MODEL.md` § Build Analyzer records the rule.
 */

import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";

import type { AnalysisTrigger } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import type { AnalysisEvent, AnalyzerSet } from "../engine/engine.analysis";
import { describeForLog } from "../errors/failure";
import { isDatabaseFailure } from "../tenancy/constraints";
import { analysisAlreadyRunning, analysisRepositoryNotFound } from "./analysis.errors";
import {
  analyzerEnded,
  analyzerStarted,
  analyzerSummary,
  pendingProgress,
  remainingNotRun,
  type RunProgress,
} from "./analysis.progress";
import { AnalysisRepository, type AnalysisRunRow } from "./analysis.repository";
import { AssemblyOverrun, CorpusAssembler } from "./corpus/corpus.assembler";
import {
  confidenceNote,
  corpusWindow,
  DEFAULT_BUDGET,
  type CorpusBudget,
  type CorpusManifest,
} from "./corpus/corpus.manifest";
import { CorpusRepository, type CorpusScope } from "./corpus/corpus.repository";

/** The clock the orchestrator reads, bound by name so a suite can move it. */
export const ANALYSIS_CLOCK = Symbol("ANALYSIS_CLOCK");

/**
 * How long past the compute ceiling the engine call may run before it is aborted: the time for
 * the engine to notice its ceiling, stop the analyzer it is in and write its report.
 */
export const DISPATCH_MARGIN_MS = 60_000;

/** The reasons a run records, as constants so the UI and the tests can rely on them. */
export const RUN_REASONS = {
  assemblyOverrun:
    "The compute ceiling was reached while the corpus was being assembled; no analyzer ran.",
  ceilingBeforeDispatch: "The compute ceiling was reached before the analyzers could start.",
  engineUnavailable: "The analysis engine could not be reached, or its answer broke off.",
  noReport: "The analysis engine's stream ended without its report.",
  internalError: "The run stopped on an internal error; the service log has the cause.",
  serviceStopped: "The service stopped before the run finished.",
  ceilingReached: "the run's compute ceiling was reached",
  unreported: "the engine did not report it",
} as const;

/** What starting a run needs. */
export interface StartRequest {
  organizationId: string;
  repoRef: string;
  trigger: AnalysisTrigger;
  /** The schedule that fired it, for scheduled triggers. */
  scheduleId?: string | null;
}

/** How the dispatch went. */
interface Dispatch {
  progress: RunProgress;
  report: { budgetExceeded: boolean } | undefined;
  failure: string | undefined;
}

@Injectable()
export class AnalysisOrchestrator implements OnApplicationShutdown {
  /** Where each run's outcome and every failure is logged. */
  private readonly logger = new Logger(AnalysisOrchestrator.name);

  /** The runs this process is executing, by id — to await in tests and to fail on shutdown. */
  private readonly inFlight = new Map<string, Promise<void>>();

  /**
   * @param runs - The run records.
   * @param corpus - The corpus reads, for resolving the repository.
   * @param assembler - Corpus assembly.
   * @param engine - The engine — the only place a corpus is sent.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly runs: AnalysisRepository,
    private readonly corpus: CorpusRepository,
    private readonly assembler: CorpusAssembler,
    private readonly engine: EngineClient,
    @Optional() @Inject(ANALYSIS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Start an analysis of one repository — or be told one is already running.
   *
   * @param request - The workspace, the repository and what triggered it.
   * @returns The new run, `running` in `assembling`. Its execution continues in the background.
   * @throws {NotFoundError} `analysis_repository_not_found` for a repository the workspace lacks.
   * @throws {UpstreamError} `engine_unavailable` when the analyzer set cannot be read.
   * @throws {ConflictError} `analysis_already_running`, naming the run that is.
   */
  async start(request: StartRequest): Promise<AnalysisRunRow> {
    const repoId = await this.corpus.repository(request.organizationId, request.repoRef);
    if (repoId === undefined) {
      throw analysisRepositoryNotFound(request.repoRef);
    }

    const schedule = await this.runs.schedule(request.organizationId, request.repoRef);
    const budget: CorpusBudget =
      schedule === undefined
        ? DEFAULT_BUDGET
        : {
            maxBuilds: schedule.max_builds,
            maxLogLines: Number(schedule.max_log_lines),
            computeCeilingSeconds: schedule.compute_ceiling_seconds,
          };

    // Checked before the engine is asked anything, so a refused start costs one read. The insert
    // below is still what decides: two starts that both pass this check meet at the index.
    const already = await this.runs.running(request.organizationId, request.repoRef);
    if (already !== undefined) {
      throw analysisAlreadyRunning(request.repoRef, already);
    }

    const analyzerSet: AnalyzerSet = await this.engine.analyzerSet();
    const inserted = await this.runs.insertRun({
      organizationId: request.organizationId,
      repoRef: request.repoRef,
      trigger: request.trigger,
      // V080: the schedule that *triggered* it — a manual run borrows only its budget.
      scheduleId:
        request.trigger === "manual" ? null : (request.scheduleId ?? schedule?.id ?? null),
      analyzerSet,
      progress: pendingProgress(analyzerSet),
    });

    if (!inserted.started) {
      throw analysisAlreadyRunning(request.repoRef, inserted.running);
    }

    const run = inserted.run;
    const scope: CorpusScope = {
      organizationId: request.organizationId,
      repoRef: request.repoRef,
      repoId,
    };
    const execution = this.execute(run, scope, budget, this.clock()).finally(() => {
      this.inFlight.delete(run.id);
    });
    this.inFlight.set(run.id, execution);

    return run;
  }

  /**
   * Wait for every run this process is executing to end. For tests and orderly shutdown.
   *
   * @returns When none is left.
   */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  /**
   * Fail the runs this process was executing — they cannot finish once it is gone, and left
   * `running` they would hold the concurrent-run guard shut until the reaper found them.
   *
   * @returns When each has been marked.
   */
  async onApplicationShutdown(): Promise<void> {
    const ids = [...this.inFlight.keys()];

    await Promise.allSettled(
      ids.map((id) =>
        this.runs.finish(id, {
          status: "failed",
          phase: null,
          manifest: null,
          progress: null,
          computeSeconds: 0,
          confidenceNote: null,
          failureReason: RUN_REASONS.serviceStopped,
        }),
      ),
    );
  }

  /**
   * Run one analysis to its end. Never rejects: every failure becomes the run's terminal state.
   *
   * @param run - The run, just inserted.
   * @param scope - Its repository.
   * @param budget - Its caps.
   * @param startedMs - When it started, on {@link clock}.
   * @returns When the run has ended.
   */
  private async execute(
    run: AnalysisRunRow,
    scope: CorpusScope,
    budget: CorpusBudget,
    startedMs: number,
  ): Promise<void> {
    const deadlineMs = startedMs + budget.computeCeilingSeconds * 1000;
    const elapsed = (): number => Math.max(0, Math.round((this.clock() - startedMs) / 1000));
    const window = corpusWindow(run.started_at);
    let progress = pendingProgress(run.analyzer_set as AnalyzerSet);

    try {
      let assembled;
      try {
        assembled = await this.assembler.assemble(scope, window, budget, {
          expired: () => this.clock() >= deadlineMs,
        });
      } catch (error) {
        if (error instanceof AssemblyOverrun) {
          progress = remainingNotRun(progress, RUN_REASONS.ceilingReached);
          await this.end(run, {
            status: "budget_exceeded",
            phase: "assembling",
            manifest: { ...error.manifest, analyzers: analyzerSummary(progress) },
            progress,
            computeSeconds: elapsed(),
            confidenceNote: null,
            failureReason: RUN_REASONS.assemblyOverrun,
          });
          return;
        }
        throw error;
      }

      if (!(await this.runs.analyzing(run.id, assembled.manifest))) {
        return;
      }

      const remainingSeconds = Math.floor((deadlineMs - this.clock()) / 1000);
      if (remainingSeconds <= 0) {
        progress = remainingNotRun(progress, RUN_REASONS.ceilingReached);
        await this.end(run, {
          status: "budget_exceeded",
          phase: "analyzing",
          manifest: { ...assembled.manifest, analyzers: analyzerSummary(progress) },
          progress,
          computeSeconds: elapsed(),
          confidenceNote: null,
          failureReason: RUN_REASONS.ceilingBeforeDispatch,
        });
        return;
      }

      const dispatch = await this.dispatch(run, assembled.corpus, remainingSeconds, progress);
      progress = dispatch.progress;
      await this.runs.progress(run.id, progress, "composing");

      await this.compose(run, assembled.manifest, dispatch, budget, elapsed(), {
        builds: assembled.counts.builds,
        daysWithBuilds: assembled.counts.daysWithBuilds,
      });
    } catch (error) {
      this.logger.error(
        `Analysis ${run.id} of ${run.repo_ref} could not be completed.`,
        describeForLog(error),
      );
      await this.end(run, {
        status: "failed",
        phase: null,
        manifest: null,
        progress: remainingNotRun(progress, RUN_REASONS.internalError),
        computeSeconds: elapsed(),
        confidenceNote: null,
        failureReason: RUN_REASONS.internalError,
      }).catch((cause: unknown) => {
        this.logger.error(`Analysis ${run.id} could not be marked failed.`, describeForLog(cause));
      });
    }
  }

  /**
   * Send the corpus to the engine and follow its stream, writing progress and findings as they
   * arrive.
   *
   * @param run - The run.
   * @param corpus - The assembled corpus.
   * @param remainingSeconds - What is left of the compute ceiling.
   * @param initial - Progress so far.
   * @returns The final progress, the report (if one came) and the failure (if the call broke).
   */
  private async dispatch(
    run: AnalysisRunRow,
    corpus: Parameters<EngineClient["analyze"]>[0]["corpus"],
    remainingSeconds: number,
    initial: RunProgress,
  ): Promise<Dispatch> {
    const state: Dispatch = { progress: initial, report: undefined, failure: undefined };

    const onEvent = async (event: AnalysisEvent): Promise<void> => {
      switch (event.event) {
        case "started":
          state.progress = analyzerStarted(state.progress, event.analyzer, event.version);
          break;
        case "outcome":
          state.progress = await this.recordOutcome(run, state.progress, event.outcome);
          break;
        case "report":
          state.report = { budgetExceeded: event.budgetExceeded };
          return;
      }
      await this.runs.progress(run.id, state.progress);
    };

    try {
      await this.engine.analyze(
        { run_id: run.id, corpus, compute_ceiling_seconds: remainingSeconds },
        remainingSeconds * 1000 + DISPATCH_MARGIN_MS,
        onEvent,
      );
    } catch (error) {
      this.logger.error(`Analysis ${run.id}: the engine call failed.`, describeForLog(error));
      state.failure = RUN_REASONS.engineUnavailable;
    }

    if (state.failure === undefined && state.report === undefined) {
      state.failure = RUN_REASONS.noReport;
    }

    return state;
  }

  /**
   * One analyzer's outcome: its findings written, its entry ticked.
   *
   * A completed analyzer whose findings the database refuses is recorded as **failed**, with the
   * refusal's constraint as its reason, and the run goes on — the same isolation BV.2 gives an
   * analyzer that crashed.
   *
   * @param run - The run.
   * @param progress - Progress so far.
   * @param outcome - The engine's outcome.
   * @returns The new progress.
   */
  private async recordOutcome(
    run: AnalysisRunRow,
    progress: RunProgress,
    outcome: Extract<AnalysisEvent, { event: "outcome" }>["outcome"],
  ): Promise<RunProgress> {
    if (outcome.status !== "completed") {
      return analyzerEnded(progress, outcome, 0);
    }

    try {
      const written = await this.runs.writeFindings(run, outcome.findings);
      return analyzerEnded(progress, outcome, written);
    } catch (error) {
      this.logger.error(
        `Analysis ${run.id}: ${outcome.analyzer}'s findings were refused.`,
        describeForLog(error),
      );
      const constraint =
        isDatabaseFailure(error) && error.constraint !== undefined
          ? error.constraint
          : "a database rule";
      return analyzerEnded(
        progress,
        { ...outcome, status: "failed", reason: `its findings were refused by ${constraint}` },
        0,
      );
    }
  }

  /**
   * Decide how the run ended, and end it.
   *
   * @param run - The run.
   * @param manifest - What assembly read.
   * @param dispatch - How the engine call went.
   * @param budget - The run's caps, for the reason.
   * @param computeSeconds - Time used.
   * @param stability - What the confidence note reads.
   * @returns When ended.
   */
  private async compose(
    run: AnalysisRunRow,
    manifest: CorpusManifest,
    dispatch: Dispatch,
    budget: CorpusBudget,
    computeSeconds: number,
    stability: { builds: number; daysWithBuilds: number },
  ): Promise<void> {
    if (dispatch.failure !== undefined) {
      const progress = remainingNotRun(dispatch.progress, dispatch.failure);
      await this.end(run, {
        status: "failed",
        phase: "composing",
        manifest: { ...manifest, analyzers: analyzerSummary(progress) },
        progress,
        computeSeconds,
        confidenceNote: null,
        failureReason: dispatch.failure,
      });
      return;
    }

    const stoppedEarly = dispatch.report?.budgetExceeded === true;
    const progress = remainingNotRun(
      dispatch.progress,
      stoppedEarly ? RUN_REASONS.ceilingReached : RUN_REASONS.unreported,
    );
    const summary = analyzerSummary(progress);
    const note = confidenceNote({ window: manifest.window, ...stability });

    if (stoppedEarly) {
      const stopped = [...summary.not_run, ...timedOutAtCeiling(progress)];
      await this.end(run, {
        status: "budget_exceeded",
        phase: "composing",
        manifest: { ...manifest, analyzers: summary },
        progress,
        computeSeconds,
        confidenceNote: note,
        failureReason:
          `The compute ceiling of ${String(budget.computeCeilingSeconds)} s was reached. ` +
          `Kept the findings of ${String(summary.completed.length)} analyzer(s); ` +
          `did not finish: ${stopped.join(", ") || "none"}.`,
      });
      return;
    }

    await this.end(run, {
      status: "complete",
      phase: "composing",
      manifest: { ...manifest, analyzers: summary },
      progress,
      computeSeconds,
      confidenceNote: note,
      failureReason: null,
    });
  }

  /**
   * Write a run's ending and say so in the log.
   *
   * @param run - The run.
   * @param ending - How it ended.
   * @returns When written.
   */
  private async end(
    run: AnalysisRunRow,
    ending: Parameters<AnalysisRepository["finish"]>[1],
  ): Promise<void> {
    const ended = await this.runs.finish(run.id, ending);

    if (ended) {
      this.logger.log(
        `Analysis ${run.id} of ${run.repo_ref} (${run.trigger}) ended ${ending.status}` +
          (ending.failureReason === null ? "." : `: ${ending.failureReason}`),
      );
    }
  }
}

/**
 * The analyzers the ceiling cut off mid-run — `timed_out` with the engine's ceiling reason.
 *
 * @param progress - The final progress.
 * @returns Their ids.
 */
function timedOutAtCeiling(progress: RunProgress): string[] {
  return progress.analyzers
    .filter((entry) => entry.status === "timed_out" && /ceiling/.test(entry.reason ?? ""))
    .map((entry) => entry.id);
}
