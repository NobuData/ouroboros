/**
 * When each class is next swept, and what its last sweep removed (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * **Changing retention deletes nothing at the moment of saving.** It changes what the *next* sweep
 * considers expired. So the card has to say when that is, or a user who sets 7 days and still
 * sees week-old data concludes the setting is broken. Each sweeper books its timer here as it
 * books it with Nest, and reports its tombstone counts when a run finishes; the service reads
 * both into the card.
 *
 * This process's view: in a deployment of several REST replicas each one sweeps on its own timer,
 * and the soonest of them is what actually runs. The card's answer is "no later than", which is
 * the honest reading of one replica's timer.
 */

import { Injectable } from "@nestjs/common";

import type { DataClass } from "./retention.policy";

/** What one sweep run removed. */
export interface SweepRecord {
  /** When the run finished. */
  readonly at: Date;
  /** Rows or objects tombstoned — jobs' logs, artifacts, runs' transcripts, audit rows. */
  readonly removed: number;
}

/** A class's sweep, as far as this process knows. */
export interface SweepStatus {
  /** When the next sweep is booked, or `null` when nothing sweeps this class in this process. */
  readonly nextAt: Date | null;
  /** The last sweep that ran here, or `null` before the first. */
  readonly last: SweepRecord | null;
}

@Injectable()
export class RetentionSchedule {
  private readonly next = new Map<DataClass, Date>();
  private readonly last = new Map<DataClass, SweepRecord>();

  /**
   * A sweeper booked its next run.
   *
   * @param dataClass - The class it sweeps.
   * @param at - When the timer fires.
   */
  booked(dataClass: DataClass, at: Date): void {
    this.next.set(dataClass, at);
  }

  /**
   * A sweeper stopped (application shutdown): nothing is booked for its class any more.
   *
   * @param dataClass - The class it swept.
   */
  stopped(dataClass: DataClass): void {
    this.next.delete(dataClass);
  }

  /**
   * A sweep run finished.
   *
   * @param dataClass - The class it swept.
   * @param at - When.
   * @param removed - How many rows or objects it tombstoned.
   */
  swept(dataClass: DataClass, at: Date, removed: number): void {
    this.last.set(dataClass, { at, removed });
  }

  /**
   * A class's sweep status.
   *
   * @param dataClass - The class.
   * @returns When it is next swept and what the last sweep removed.
   */
  status(dataClass: DataClass): SweepStatus {
    return { nextAt: this.next.get(dataClass) ?? null, last: this.last.get(dataClass) ?? null };
  }
}
