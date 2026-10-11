/**
 * A dry run in flight: the harness's stream relayed, recorded and ended (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * ```
 * launch ─▶ engine POST /v0/dry-runs (NDJSON) ─┬─ stage_started   ─▶ subscribers
 *                                              ├─ stage_finished  ─▶ dry_run_stages row ─▶ subscribers
 *                                              ├─ guard_blocked   ─▶ subscribers
 *                                              └─ done            ─▶ rows · artifacts · totals · guard audit
 *                                                                    ─▶ dry_runs ends ─▶ `done` to subscribers
 * ```
 *
 * **The run outlives the request that started it.** `POST …/dry-runs` answers as soon as the run
 * is dispatched; the page follows it on `GET …/events`, and `/ouro dry-run` (#537) can start one
 * and link to the page. So the run is held here, in the process, with every event it has
 * produced — a subscriber that arrives late is replayed the stream from the top.
 *
 * **Each row is recorded as it finishes**, not at the end: a cancelled, budget-stopped or broken
 * run keeps the rows it reached, which is what *partial results retained* means.
 *
 * **How a run ends** — {@link endingOf}:
 *
 *   * the harness's own `done` decides, with one rule laid over it: **a populated guard audit
 *     fails the run**, whatever status came with it. A dry run that had to block a write is a
 *     dry run whose result is not to be trusted, and that is enforced here as well as in the
 *     harness so that neither side can quietly stop;
 *   * a stream that ended without a `done` is `cancelled` when somebody cancelled it, and
 *     `failed` otherwise.
 *
 * A process that stops in an orderly way ends the runs it holds (`onModuleDestroy`). A run whose
 * process died is not here to be cancelled; {@link DryRunRunner.cancel} ends it in
 * the record directly, and `dry-runs.service.ts` reaps one that outlived the harness deadline.
 */

import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

import type { DryRun, DryRunGuardAuditEntry } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import type {
  EngineDryRunGuardEntry,
  EngineDryRunRequest,
  EngineDryRunResult,
} from "../engine/engine.dryruns";
import { UpstreamError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { DryRunAftermath } from "./dry-runs.aftermath";
import type { DryRunBudget } from "./dry-runs.budget";
import { DryRunRecords } from "./dry-runs.records";
import { DryRunsRepository, type DryRunEnding } from "./dry-runs.repository";
import { streamedStage } from "./dry-runs.resources";
import type { DryRunStreamEvent } from "./dry-runs.stream";

/** Why a run that broke off is recorded as failed. */
export const HARNESS_STOPPED = "The dry-run harness stopped answering before the run finished.";

/** Why a run whose result could not be stored is recorded as failed. */
export const RESULT_UNRECORDED = "The dry run's result could not be recorded.";

/** One run this process is holding. */
interface LiveRun {
  /** Aborts the harness's stream — the cancel button. */
  readonly abort: AbortController;
  /** Whether somebody cancelled it. */
  cancelled: boolean;
  /** Every event so far, in order — what a late subscriber is replayed. */
  readonly events: DryRunStreamEvent[];
  /** Subscribers waiting for the next event. */
  readonly waiters: Set<() => void>;
  /** Settles when the run has been ended in the record. */
  finished: Promise<void>;
  /** Set when the run was let go without a `done` — its record could not be written. */
  released: boolean;
}

/**
 * The guard audit as V111 stores it.
 *
 * @param entries - The harness's entries.
 * @returns `{guard, call, count, stage_key?}` each — `stage_key` omitted when there is none.
 */
function auditRows(entries: readonly EngineDryRunGuardEntry[]): DryRunGuardAuditEntry[] {
  return entries.map((entry) => ({
    guard: entry.guard,
    call: entry.call,
    count: entry.count,
    ...(entry.stageKey === null ? {} : { stage_key: entry.stageKey }),
  }));
}

/**
 * How a dry run ends, from what the harness said — or did not say.
 *
 * @param result - The harness's `done`, or `undefined` when the stream ended without one.
 * @param cancelled - Whether somebody cancelled the run.
 * @returns The ending to record.
 */
export function endingOf(result: EngineDryRunResult | undefined, cancelled: boolean): DryRunEnding {
  if (result === undefined) {
    return {
      status: cancelled ? "cancelled" : "failed",
      failureReason: cancelled ? null : HARNESS_STOPPED,
      durationMs: null,
      costCents: null,
      tokens: null,
      guardAudit: [],
    };
  }

  const guardAudit = auditRows(result.guardAudit);
  const blocked = guardAudit.reduce((total, entry) => total + entry.count, 0);
  const totals = {
    durationMs: result.durationMs,
    costCents: result.costCents,
    // Null when nothing was metered — V111's rule for `dry_runs.tokens`.
    tokens: result.tokens > 0 ? result.tokens : null,
    guardAudit,
  };

  if (blocked > 0) {
    // The rule, enforced here whatever the harness reported: a guard that had to hold fails
    // the run.
    const reason = `The tool boundary refused ${String(blocked)} call${blocked === 1 ? "" : "s"}; a dry run whose guards had to hold is not trusted.`;

    return {
      ...totals,
      status: "failed",
      failureReason:
        result.status === "failed" && result.failureReason !== null ? result.failureReason : reason,
    };
  }

  if (result.status === "complete") {
    return { ...totals, status: "complete", failureReason: null };
  }

  return {
    ...totals,
    status: result.status,
    failureReason:
      result.failureReason ??
      (result.status === "budget_stopped"
        ? "The dry run reached its budget."
        : "The dry run failed."),
  };
}

@Injectable()
export class DryRunRunner implements OnModuleDestroy {
  private readonly logger = new Logger(DryRunRunner.name);

  /** The runs this process is holding, by `dry_runs.id`. */
  private readonly live = new Map<string, LiveRun>();

  /**
   * @param engine - The typed engine client.
   * @param dryRuns - The statements.
   * @param records - A dry run read back whole.
   */
  constructor(
    private readonly engine: EngineClient,
    private readonly dryRuns: DryRunsRepository,
    private readonly records: DryRunRecords,
    private readonly aftermath: DryRunAftermath,
  ) {}

  /**
   * Stop every run this process is holding, when the process is stopping.
   *
   * A run cannot outlive the process that relays it, so each is closed and recorded `failed` —
   * with the rows it reached — rather than left `running` for the next start to wait out.
   *
   * @returns When every held run has been ended in the record.
   */
  async onModuleDestroy(): Promise<void> {
    const held = [...this.live.values()];
    for (const live of held) live.abort.abort();
    await Promise.all(held.map((live) => live.finished));
  }

  /**
   * Dispatch a dry run to the harness and return at once; the run goes on in the background.
   *
   * @param run - The row, `running`.
   * @param request - What the harness is sent.
   * @param budget - The budget, for the `accepted` event.
   * @returns When the run is registered and its `accepted` event is recorded.
   */
  async launch(run: DryRun, request: EngineDryRunRequest, budget: DryRunBudget): Promise<void> {
    const live: LiveRun = {
      abort: new AbortController(),
      cancelled: false,
      events: [],
      waiters: new Set(),
      finished: Promise.resolve(),
      released: false,
    };
    this.live.set(run.id, live);
    this.emit(live, { kind: "accepted", dryRun: await this.records.resource(run, budget) });

    live.finished = this.execute(live, run, request)
      .catch((error: unknown) => {
        // The record could not be ended or read back (the database went away). Subscribers
        // are released; the run stays `running` in the record until it is cancelled or reaped.
        this.logger.error(`dry run ${run.id} could not be ended`, describeForLog(error));
        live.released = true;
        live.abort.abort();
        for (const wake of live.waiters) wake();
      })
      .finally(() => {
        this.live.delete(run.id);
      });
  }

  /**
   * Whether this process is holding a run.
   *
   * @param dryRunId - The dry run.
   * @returns `true` while it is in flight here.
   */
  isLive(dryRunId: string): boolean {
    return this.live.has(dryRunId);
  }

  /**
   * Cancel a running dry run. The rows it reached are kept.
   *
   * @param run - The row, `running`.
   * @returns The row as it ended — `cancelled`, unless the run finished first.
   */
  async cancel(run: DryRun): Promise<DryRun> {
    const live = this.live.get(run.id);

    if (live !== undefined) {
      live.cancelled = true;
      live.abort.abort();
      await live.finished;
    }

    // Not held here (this process restarted, or another holds it), or already ended above:
    // `finish` only ends a run that is still running, and answers with the row as it stands.
    return (await this.dryRuns.finish(run.id, endingOf(undefined, true))) ?? run;
  }

  /**
   * Wait for a run this process is holding to end. For the suites, and for a graceful stop.
   *
   * @param dryRunId - The dry run.
   * @returns When it has ended, or at once when it is not held here.
   */
  async settled(dryRunId: string): Promise<void> {
    await this.live.get(dryRunId)?.finished;
  }

  /**
   * Follow a run this process is holding: every event so far, then each as it happens, ending
   * after `done`.
   *
   * @param dryRunId - The dry run.
   * @param signal - Ends the subscription early — the client went away.
   * @yields The events, in order.
   * @returns `false` when the run is not held here (the caller reads the record instead).
   */
  async *follow(
    dryRunId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<DryRunStreamEvent, boolean> {
    const live = this.live.get(dryRunId);
    if (live === undefined) return false;

    for (let index = 0; ;) {
      while (index < live.events.length) {
        const event = live.events[index];
        index += 1;
        yield event;
        if (event.kind === "done") return true;
      }
      if (signal?.aborted === true || live.released) return true;

      await new Promise<void>((resolve) => {
        live.waiters.add(resolve);
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }

  /**
   * Record one event and wake whoever is waiting for it.
   *
   * @param live - The run.
   * @param event - The event.
   */
  private emit(live: LiveRun, event: DryRunStreamEvent): void {
    live.events.push(event);
    const waiting = [...live.waiters];
    live.waiters.clear();
    for (const wake of waiting) wake();
  }

  /**
   * Relay the harness's stream, record it, and end the run.
   *
   * Whatever goes wrong with the harness becomes how the run ended; it rejects only when the
   * record itself cannot be written.
   *
   * @param live - The run's in-process state.
   * @param run - The row.
   * @param request - What the harness is sent.
   * @returns When the run has been ended in the record and `done` emitted.
   */
  private async execute(live: LiveRun, run: DryRun, request: EngineDryRunRequest): Promise<void> {
    let result: EngineDryRunResult | undefined;
    let ending: DryRunEnding;

    try {
      for await (const event of this.engine.dryRun(request, live.abort.signal)) {
        switch (event.kind) {
          case "stage_started":
            this.emit(live, event);
            break;
          case "stage_finished":
            await this.dryRuns.insertStage(run, event.stage);
            this.emit(live, { kind: "stage_finished", stage: streamedStage(event.stage) });
            break;
          case "guard_blocked":
            this.emit(live, event);
            break;
          default:
            result = event.result;
        }
      }

      if (result !== undefined) {
        // The final result repeats every row; the ones already recorded are left as they are.
        for (const stage of result.stages) await this.dryRuns.insertStage(run, stage);
        await this.dryRuns.insertArtifacts(run, result.artifacts);
      }
      ending = endingOf(result, live.cancelled);
    } catch (error) {
      // Nobody is reading the harness any more: close its stream, whatever broke.
      live.abort.abort();

      if (live.cancelled) {
        ending = endingOf(undefined, true);
      } else {
        this.logger.error(`dry run ${run.id} broke off`, describeForLog(error));
        // The engine's own failures are `UpstreamError`s; anything else broke while a row,
        // an artifact or the result was being recorded.
        ending =
          error instanceof UpstreamError
            ? endingOf(undefined, false)
            : { ...endingOf(result, false), status: "failed", failureReason: RESULT_UNRECORDED };
      }
    }

    const ended = (await this.dryRuns.finish(run.id, ending)) ?? run;
    // The rule pack's suggestions are filed before `done`, so the card reads them as soon as it
    // hears the run ended; the copilot's debrief is a model exchange, and nobody waits for it.
    await this.aftermath.ended(ended);
    this.emit(live, { kind: "done", dryRun: await this.records.resource(ended) });
    this.aftermath.debrief(ended);
  }
}
