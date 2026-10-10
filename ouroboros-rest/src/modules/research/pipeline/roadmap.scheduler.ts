/**
 * The roadmap pipeline's clock (CM.5, [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * One pass runs the drift check over every document that has somewhere to be projected and is
 * not already known to have drifted: a pending projection is tried again, an open pull request
 * is followed, and the document is compared with the tracker and the repository's file.
 *
 * Every pass is jittered, including the first, so replicas do not tick together; a pass already
 * running is not started twice. `OURO_RESEARCH_ROADMAP_TICK_MS=0` books none — the route still
 * checks on demand.
 */

import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import type { DriftPassSummary, RoadmapDriftService } from "./roadmap.drift.service";

/** A pass that did nothing. */
const NOTHING: DriftPassSummary = Object.freeze({ checked: 0, drifted: 0, raised: 0 });

export class RoadmapScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RoadmapScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private running: Promise<DriftPassSummary> | undefined;

  /**
   * @param drift - The drift check.
   * @param tickMs - Milliseconds between passes; `0` never books one.
   * @param random - The jitter's randomness; a test fixes it.
   */
  constructor(
    private readonly drift: Pick<RoadmapDriftService, "pass">,
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
   * @returns What the pass did; zeros when it could not run.
   */
  async tick(): Promise<DriftPassSummary> {
    if (this.running !== undefined) return this.running;

    this.running = this.drift.pass().catch((error: unknown) => {
      this.logger.error(
        "The roadmap drift check could not run its pass; trying again next tick.",
        describeForLog(error),
      );

      return NOTHING;
    });

    try {
      return await this.running;
    } finally {
      this.running = undefined;
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
