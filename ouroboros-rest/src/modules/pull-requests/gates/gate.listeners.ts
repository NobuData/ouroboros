/**
 * Who hears that a PR's gates were evaluated — the seam the merge executor (AX.4,
 * [#360](https://github.com/NobuData/ouroboros/issues/360)) listens on.
 *
 * AX.4's executor is *event-driven*: an armed plan fires when the last required gate flips green,
 * and disarms when a gate goes red or the head moves. The event is the gate engine's evaluation.
 * But the executor lives in `PullRequestsModule`, which imports `GatesModule` — so the engine
 * cannot depend on the executor without a cycle. This registry inverts it: `GatesModule` provides
 * and exports {@link GateListeners}, the executor registers itself at module init, and the engine
 * tells whoever registered.
 *
 * ```
 * GateEngineService.notify ─▶ evaluate (one transaction, committed)
 *                          ─▶ GateListeners.emit(evaluated) ─▶ MergeExecutor.gateEvaluated
 * ```
 *
 * **After commit, and never failing the engine.** `emit` runs after the evaluation's transaction
 * has committed, so a listener reads what the engine wrote; a listener that throws is logged and
 * the rest still hear. A listener must return quickly — the engine's emitter (a build finishing, a
 * test report parsing) is waiting — so one with slow work schedules it rather than awaiting it.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { PullRequestState } from "../../db/schema";

/** What a listener is told about one evaluation. */
export interface GateEvaluated {
  /** The PR. */
  readonly prId: string;
  /** Its workspace. */
  readonly organizationId: string;
  /** The revision judged, or null when the PR has none yet. */
  readonly revisionId: string | null;
  /** The PR's state after the evaluation. */
  readonly state: PullRequestState;
  /** Whether every required gate is satisfied on the revision. */
  readonly mergeReady: boolean;
  /** How many required gates are red on the revision. */
  readonly redCount: number;
}

/** One listener. */
export interface GateEvaluationListener {
  /**
   * Hear one evaluation. Must not block — schedule slow work.
   *
   * @param evaluated - What was evaluated and where it landed.
   */
  gateEvaluated(evaluated: GateEvaluated): void;
}

/** The registry — see this file's header. */
@Injectable()
export class GateListeners {
  private readonly logger = new Logger(GateListeners.name);

  private readonly listeners = new Set<GateEvaluationListener>();

  /**
   * Register a listener.
   *
   * @param listener - Who wants to hear.
   * @returns A function that unregisters it.
   */
  add(listener: GateEvaluationListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Tell every listener. A listener that throws is logged; the others still hear.
   *
   * @param evaluated - The evaluation.
   */
  emit(evaluated: GateEvaluated): void {
    for (const listener of this.listeners) {
      try {
        listener.gateEvaluated(evaluated);
      } catch (error) {
        this.logger.error(
          `A gate listener failed for pr ${evaluated.prId}.`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
