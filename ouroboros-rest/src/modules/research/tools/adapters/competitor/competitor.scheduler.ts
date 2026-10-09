/**
 * When the competitor tracker checks its watches (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Each watch keeps its own schedule — `next_check_at`, its cadence with ±25 % jitter after each
 * check (a back-off after a failure) — so the scheduler is only a ticker: every
 * `OURO_RESEARCH_WATCH_TICK_MS` (itself jittered) it **claims** at most `OURO_RESEARCH_WATCH_BATCH`
 * due watches and checks them one at a time.
 *
 * **No stampede on restart.** Nothing runs at boot — the first tick is a jittered interval away —
 * and the schedule is stored, so a restarted service finds only the watches that were due anyway.
 * New watches are due at once, and the batch bounds how many a tick takes. Claiming moves a
 * watch's `next_check_at` to the end of a lease, so two replicas never check one watch together
 * and a replica that dies mid-check leaves its watches due again when the lease lapses.
 *
 * The timer is unreferenced, so a suite that built an application still exits; `0` turns it off.
 */

import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { describeForLog } from "../../../../errors/failure";
import { jittered } from "../../../../scheduling/cadence";
import type { ClaimedWatch } from "../../../competitors/competitors.repository";
import type { CheckResult } from "./competitor.snapshotter";

/** How long a claim holds a watch — longer than any check takes, short enough to recover. */
export const CLAIM_LEASE_MS = 15 * 60 * 1000;

/** What the scheduler needs. */
export interface WatchSchedulerDependencies {
  /** Claim the due watches. */
  claim(now: Date, limit: number, leaseUntil: Date): Promise<ClaimedWatch[]>;
  /** Check one. */
  check(watch: ClaimedWatch, now: Date): Promise<CheckResult>;
  /** Milliseconds between ticks; 0 is off. */
  readonly tickMs: number;
  /** Watches per tick. */
  readonly batch: number;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export class CompetitorWatchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CompetitorWatchScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private pass: Promise<number> | undefined;

  /** @param deps - The claim, the check, and the cadence. */
  constructor(private readonly deps: WatchSchedulerDependencies) {}

  /** Book the first tick — a jittered interval away, never at boot. */
  onApplicationBootstrap(): void {
    this.book();
  }

  /** Stop ticking. */
  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * One tick: claim what is due and check it. A tick called while one runs joins it.
   *
   * @returns How many watches were checked.
   */
  async tick(): Promise<number> {
    if (this.pass !== undefined) return this.pass;

    this.pass = this.run();
    try {
      return await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

  private async run(): Promise<number> {
    const now = this.now();
    let claimed: ClaimedWatch[];

    try {
      claimed = await this.deps.claim(
        now,
        this.deps.batch,
        new Date(now.getTime() + CLAIM_LEASE_MS),
      );
    } catch (error) {
      this.logger.error(
        "Competitor watches could not be claimed; trying again next tick.",
        describeForLog(error),
      );
      return 0;
    }

    let checked = 0;
    for (const watch of claimed) {
      if (this.stopped) break;
      try {
        await this.deps.check(watch, this.now());
        checked += 1;
      } catch (error) {
        // The check could not be recorded; its claim lapses and the watch is due again then.
        this.logger.error(
          `Competitor watch ${watch.id} could not be checked.`,
          describeForLog(error),
        );
      }
    }
    return checked;
  }

  private book(): void {
    if (this.stopped || this.deps.tickMs <= 0) return;

    this.timer = setTimeout(
      () => {
        void this.tick().finally(() => {
          this.book();
        });
      },
      jittered(this.deps.tickMs, this.deps.random),
    );
    this.timer.unref();
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
