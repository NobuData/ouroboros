/**
 * What brings an investigation back after an engine restart: a resume pass (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * Every `OURO_RESEARCH_INVESTIGATION_TICK_MS` (jittered; `0` off; never at boot) the pass
 * re-submits each running investigation whose checkpoint has stopped moving, and fails the
 * ones that have run out of attempts — see `InvestigationDispatchService.resume`.
 */

import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import type { InvestigationDispatchService } from "./investigation-dispatch.service";

export class InvestigationLoopScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(InvestigationLoopScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private pass: Promise<number> | undefined;

  /**
   * @param dispatch - Resumes stalled investigations.
   * @param tickMs - Milliseconds between passes; `0` is off.
   * @param random - The jitter's source.
   */
  constructor(
    private readonly dispatch: InvestigationDispatchService,
    private readonly tickMs: number,
    private readonly random?: () => number,
  ) {}

  /** Book the first pass — a jittered tick away. */
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
   * One resume pass. A pass called while one runs joins it.
   *
   * @returns How many stalled investigations were looked at.
   */
  async tick(): Promise<number> {
    if (this.pass !== undefined) return this.pass;
    this.pass = this.dispatch.resume().catch((error: unknown) => {
      this.logger.error(
        "Stalled investigations could not be read; trying again next tick.",
        describeForLog(error),
      );
      return 0;
    });
    try {
      return await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

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
