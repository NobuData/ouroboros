/**
 * One night of re-estimation — what the Backlog Health card's footnote promises, done once.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)), decision **N9**: *"Estimator
 * re-runs nightly on unsized issues"* is a claim about a scheduled job, so it is one.
 *
 * ```
 * claim the night ──(another replica has it)──▶ stand down
 *      │
 *      ▼
 * open + unsized tickets, bounded, shared across workspaces
 *      │
 *      ▼
 * EstimationOrchestrator.enqueueTicket(each) ── INTAKE-L.3 (#107), the one sizer
 *      │
 *      ▼
 * record: succeeded | failed, and per-workspace found · queued · in flight
 * ```
 *
 * **This class sizes nothing.** It chooses tickets and hands them to INTAKE-L.3's orchestrator — the
 * formalized nightly sweep that ticket noted but did not schedule — which claims, calls the engine,
 * applies the floor and stores the estimate exactly as it does for an issue or a draft. There is no
 * second estimation path to drift from the first, and `planning.module.spec.ts` asserts it
 * structurally.
 *
 * **A run succeeds when its batch is queued**, not when every estimate is stored. The estimates
 * finish over the following minutes, each in its own terminal status on its own ticket — and a job
 * that held its run open for the length of the batch would report `running` for as long as the
 * engine was slow, which is not what the tooltip is asking.
 */

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { describeForLog } from "../errors/failure";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import type { NightlySlot } from "../scheduling/cadence";
import {
  ReestimationRepository,
  type RunCounts,
  type UnsizedTicketRow,
} from "./reestimation.repository";

/** How one night's run ended, for the scheduler's log and the suites. */
export type ReestimationOutcome =
  /** Another process already ran this night; nothing was selected or queued. */
  | { readonly kind: "skipped"; readonly night: string }
  /** The batch was selected and handed to the orchestrator. */
  | {
      readonly kind: "succeeded";
      readonly night: string;
      readonly runId: string;
      readonly counts: readonly RunCounts[];
    }
  /** The run could not select or queue its batch; the run is recorded as failed. */
  | { readonly kind: "failed"; readonly night: string; readonly runId: string };

@Injectable()
export class ReestimationJob {
  /** Where a run that did something, or failed, is reported. */
  private readonly logger = new Logger(ReestimationJob.name);

  /**
   * @param runs - The night claim, the batch read and the run record.
   * @param orchestrator - INTAKE-L.3's orchestrator — the one sizer, exported by `EstimationModule`.
   * @param config - The batch bound.
   */
  constructor(
    private readonly runs: ReestimationRepository,
    private readonly orchestrator: EstimationOrchestrator,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Run one night.
   *
   * @param slot - The night this run belongs to.
   * @returns How it ended. Never rejects for a failure inside the run — that is recorded as
   *   `failed`; it rejects only when the night itself could not be claimed, which means the
   *   database is unreachable and there is nowhere to record anything.
   */
  async run(slot: NightlySlot): Promise<ReestimationOutcome> {
    const batchLimit = this.config.reestimationBatch;
    const runId = await this.runs.startRun(slot.night, batchLimit);

    if (runId === undefined) {
      return { kind: "skipped", night: slot.night };
    }

    try {
      const tickets = await this.runs.unsizedTickets(batchLimit);
      const counts = this.dispatch(tickets);

      await this.runs.finishRun(runId, "succeeded", counts);

      this.announce(slot.night, tickets.length, counts);

      return { kind: "succeeded", night: slot.night, runId, counts };
    } catch (error) {
      this.logger.error(`Nightly re-estimation for ${slot.night} failed`, describeForLog(error));

      try {
        await this.runs.finishRun(runId, "failed", []);
      } catch (recordError) {
        // The run stays `running`, which is what the tooltip will say; the next night is unaffected.
        this.logger.error(
          `Could not record the nightly re-estimation for ${slot.night} as failed`,
          describeForLog(recordError),
        );
      }

      return { kind: "failed", night: slot.night, runId };
    }
  }

  /**
   * Hand every selected ticket to the orchestrator, and count what happened per workspace.
   *
   * @param tickets - The batch, already bounded.
   * @returns One entry per workspace the batch touched, in first-seen order.
   */
  private dispatch(tickets: readonly UnsizedTicketRow[]): RunCounts[] {
    const byWorkspace = new Map<string, { found: number; queued: number; inFlight: number }>();

    for (const ticket of tickets) {
      const count = byWorkspace.get(ticket.organizationId) ?? { found: 0, queued: 0, inFlight: 0 };

      count.found += 1;

      if (this.orchestrator.enqueueTicket(ticket.ticketId)) {
        count.queued += 1;
      } else {
        count.inFlight += 1;
      }

      byWorkspace.set(ticket.organizationId, count);
    }

    return [...byWorkspace].map(([organizationId, count]) => ({ organizationId, ...count }));
  }

  /**
   * Say what a run did, when it did anything.
   *
   * @param night - The night.
   * @param selected - How many tickets the batch held.
   * @param counts - Per workspace.
   */
  private announce(night: string, selected: number, counts: readonly RunCounts[]): void {
    if (selected === 0) {
      return;
    }

    const queued = counts.reduce((sum, count) => sum + count.queued, 0);

    this.logger.log(
      `Nightly re-estimation for ${night}: queued ${String(queued)} of ${String(selected)} ` +
        `unsized ticket(s) across ${String(counts.length)} workspace(s)` +
        `${selected === this.config.reestimationBatch ? " — the batch bound was reached" : ""}.`,
    );
  }
}
