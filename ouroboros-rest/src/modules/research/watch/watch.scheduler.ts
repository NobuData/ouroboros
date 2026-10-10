/**
 * The regression watch's clock (CM.4, [#623](https://github.com/NobuData/ouroboros/issues/623)).
 *
 * One pass does two things:
 *
 *   1. **the nightly comparison** — for each workspace that holds a baseline and has not been
 *      compared since the start of the current UTC day. Once a day, however short the tick is;
 *   2. **one step for every open watch item** — start or settle its bisect, open its forensics
 *      investigation, draft its fix, follow the fix to its merge (`watch.chain.ts`).
 *
 * Both are idempotent, so a replica that runs the pass at the same moment as another, or a pass
 * that is repeated after a crash, changes nothing twice. A workspace or an item that fails is
 * logged and does not stop the rest.
 */

import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import type { RegressionWatchChain } from "./watch.chain";
import type { WatchStore } from "./watch.repository";
import { startOfUtcDay, type RegressionWatchService } from "./watch.service";

/** The most open items one pass advances. */
export const PASS_BATCH = 200;

/** What one pass did. */
export interface PassSummary {
  /** Workspaces whose nightly comparison ran. */
  readonly compared: number;
  /** Open items looked at. */
  readonly items: number;
  /** Items that moved to another status. */
  readonly moved: number;
}

/**
 * One pass of the watch.
 *
 * @param store - The watch's tables.
 * @param watch - The comparison.
 * @param chain - The chain.
 * @param now - The clock.
 * @param logger - Where a failure is named.
 * @returns What the pass did.
 */
export async function runPass(
  store: Pick<WatchStore, "workspacesDue" | "openItems">,
  watch: Pick<RegressionWatchService, "compare">,
  chain: Pick<RegressionWatchChain, "advance">,
  now: Date,
  logger: Pick<Logger, "error">,
): Promise<PassSummary> {
  let compared = 0;
  for (const organizationId of await store.workspacesDue(startOfUtcDay(now))) {
    try {
      await watch.compare(organizationId, now);
      compared += 1;
    } catch (error) {
      logger.error(
        `The nightly comparison of ${organizationId} failed; trying again next pass.`,
        describeForLog(error),
      );
    }
  }

  const items = await store.openItems(PASS_BATCH);
  let moved = 0;
  for (const item of items) {
    try {
      const outcome = await chain.advance(item);
      if ("moved" in outcome) moved += 1;
    } catch (error) {
      logger.error(
        `Watch item ${item.id} could not be advanced; trying again next pass.`,
        describeForLog(error),
      );
    }
  }

  return { compared, items: items.length, moved };
}

export class RegressionWatchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RegressionWatchScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private pass: Promise<PassSummary> | undefined;

  /**
   * @param store - The watch's tables.
   * @param watch - The comparison.
   * @param chain - The chain.
   * @param tickMs - Milliseconds between passes; `0` never books one.
   * @param random - The jitter's randomness; a test fixes it.
   */
  constructor(
    private readonly store: Pick<WatchStore, "workspacesDue" | "openItems">,
    private readonly watch: Pick<RegressionWatchService, "compare">,
    private readonly chain: Pick<RegressionWatchChain, "advance">,
    private readonly tickMs: number,
    private readonly random?: () => number,
  ) {}

  /** Book the first pass. */
  onApplicationBootstrap(): void {
    this.book();
  }

  /** Stop booking passes. */
  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Run one pass, unless one is already running — then answer that one.
   *
   * @param now - The clock.
   * @returns What the pass did; zeros when it could not start.
   */
  async tick(now: Date = new Date()): Promise<PassSummary> {
    if (this.pass !== undefined) return this.pass;
    this.pass = runPass(this.store, this.watch, this.chain, now, this.logger).catch(
      (error: unknown) => {
        this.logger.error(
          "The regression watch could not run its pass; trying again next tick.",
          describeForLog(error),
        );
        return { compared: 0, items: 0, moved: 0 };
      },
    );
    try {
      return await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

  /** Book the next pass, jittered so replicas do not tick together. */
  private book(): void {
    if (this.stopped || this.tickMs <= 0) return;
    this.timer = setTimeout(
      () => {
        void this.tick().finally(() => {
          this.book();
        });
      },
      jittered(this.tickMs, this.random),
    );
    this.timer.unref();
  }
}
