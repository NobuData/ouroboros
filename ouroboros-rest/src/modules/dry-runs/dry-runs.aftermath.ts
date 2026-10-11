/**
 * What happens once a dry run has ended in the record (CD.5,
 * [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * ```
 * run ended ─▶ ended()    the rule pack files its suggestions      (awaited, before `done`)
 *           └▶ debrief()  whoever registered is told, e.g. the     (not awaited, after `done`)
 *                         copilot conversation the run came from
 * ```
 *
 * Two steps, because they cost differently. The rules are arithmetic over rows already written,
 * so they finish before `done` is emitted and the card can read its callouts as soon as it
 * hears the run ended. The debrief is a model exchange — slow, and allowed to fail — so it runs
 * after `done` and nobody waits for it.
 *
 * **The registry is what keeps the module graph a tree.** `CopilotModule` imports this module
 * (for the edge-case picker); this module cannot import the copilot back. So the copilot
 * registers a debriefer here at start-up, and the runner never learns who is listening.
 *
 * Nothing here can fail a dry run: the run is already recorded.
 */

import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

import type { DryRun } from "../db/schema";
import { describeForLog } from "../errors/failure";
import { DryRunSuggestionsService } from "./suggestions.service";

/** Somebody to tell that a dry run ended. */
export type DryRunDebriefer = (run: DryRun) => Promise<void>;

@Injectable()
export class DryRunAftermath implements OnModuleDestroy {
  private readonly logger = new Logger(DryRunAftermath.name);

  private readonly debriefers: DryRunDebriefer[] = [];

  /** Debriefs still running — awaited at shutdown, and by tests. */
  private readonly pending = new Set<Promise<void>>();

  /** @param suggestions - The rule pack's filing. */
  constructor(private readonly suggestions: DryRunSuggestionsService) {}

  /** Let the debriefs in flight finish before the pool closes. */
  async onModuleDestroy(): Promise<void> {
    await this.settled();
  }

  /**
   * Register somebody to be told when a dry run ends.
   *
   * @param debriefer - Called once per ended run; its rejection is logged, never propagated.
   */
  register(debriefer: DryRunDebriefer): void {
    this.debriefers.push(debriefer);
  }

  /**
   * File the rule pack's suggestions for a run that has just ended.
   *
   * @param run - The dry run, as it ended.
   * @returns When the suggestions are filed (or could not be — which is logged, not thrown).
   */
  async ended(run: DryRun): Promise<void> {
    await this.suggestions.file(run);
  }

  /**
   * Tell every registered debriefer, without waiting.
   *
   * @param run - The dry run, as it ended.
   */
  debrief(run: DryRun): void {
    for (const debriefer of this.debriefers) {
      const task = debriefer(run)
        .catch((error: unknown) => {
          this.logger.error(`dry run ${run.id} could not be debriefed`, describeForLog(error));
        })
        .finally(() => {
          this.pending.delete(task);
        });
      this.pending.add(task);
    }
  }

  /**
   * Wait for every debrief in flight.
   *
   * @returns When none is running.
   */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
